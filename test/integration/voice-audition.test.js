/**
 * THE AUDITION — the forge's HEAR step over a REAL portal socket (RULE 0, no
 * mocks anywhere on the path):
 *
 *   real signed-wallet session token → real WebSocket pair → the real portal
 *   dispatcher (handlePortalMessage → handleVoiceFrame → runAudition)
 *   real forge session store (core/voice/forge-session.js) with a pinned take
 *   real resolveTurnVoice → createSpeechTurn → synthesize-emit → tts-provider
 *   → engine-manager ADOPTS a real loopback server speaking the speak
 *   protocol (speak-wire-stand-in.js: clips by ref, 409 → inline, utterance
 *   refs) — the tier pinned Standard/full, so no real engine ever launches.
 *
 * Proves: the guardian hears voice:audio frames in the pinned voice and then
 * voice:audition_done — the sample in the being's own name, or the person's
 * line; nothing is posted as a reply and nothing lands on the being's disk;
 * a non-guardian, an unknown session, a bad line and VOX off are refused in
 * plain words with no engine asked; a barge-in cuts the audition (done,
 * interrupted); a failing engine answers voice:audition_error.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ethers } from 'ethers';
import { createBindingIsolationKit } from '../helpers/binding-isolation-kit.js';
import { startSpeakWire, sineWav, pinSpeechToStandIn } from '../helpers/speak-wire-stand-in.js';
import {
  createForgeSession, endForgeSession, putForgeSession, withTakes,
} from '../../core/voice/forge-session.js';
import workspace from '../../core/workspace/neuma-workspace.js';

const LANE = 'audition-keir';
const WORDS = 'Hello, it is good to finally meet you.';
const NAME = 'HarnessFixture'; // the kit binds its companion under this name

let kit;
let wire;
let clipRef;

// impure — a forge for the kit's lane, owned by `wallet`, with one pinned take.
const openForge = (wallet) => {
  const wav = sineWav(3.5, 220);
  const ref = `sha256:${createHash('sha256').update(wav).digest('hex')}`;
  const session = createForgeSession({ id: randomUUID(), neumaId: LANE, wallet, now: Date.now() });
  const next = withTakes(session, [{ ref, wav, words: WORDS, sampleRate: 8000, seconds: 3.5, door: 'upload' }], Date.now());
  if (!next.ok) throw new Error(next.error);
  putForgeSession(next.session);
  return { sessionId: next.session.id, ref };
};

const send = (frame) => kit.client.send(JSON.stringify({ ...frame, messageId: randomUUID() }));

// impure — wait for the first frame at or after `from` matching `pred`.
const frameAfter = async (from, pred, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = kit.frames.slice(from).find(pred);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`no matching frame within ${timeoutMs} ms; saw ${kit.frames.slice(from).map((f) => f.type).join(', ')}`);
};
const closing = (from, sessionId) => frameAfter(from, (f) => (f.type === 'voice:audition_done' || f.type === 'voice:audition_error') && f.sessionId === sessionId);

// impure — every file under the lane with its size and mtime: the audition must move none.
const laneSnapshot = async () => {
  const root = workspace.pathFor(LANE);
  const out = [];
  const walk = async (dir) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else {
        const st = await fs.stat(full);
        out.push(`${path.relative(root, full)}:${st.size}:${st.mtimeMs}`);
      }
    }
  };
  await walk(root);
  return out.sort();
};

beforeAll(async () => {
  kit = await createBindingIsolationKit(LANE);
  wire = await startSpeakWire();
  await pinSpeechToStandIn(wire.port, path.join(kit.root, 'voice-settings.json'));
  ({ ref: clipRef } = openForge(kit.connection.walletAddress));
}, 30_000);

afterAll(async () => {
  await kit?.close();
  await wire?.close();
}, 30_000);

describe('the guardian hears the pinned voice through the chat speech path', () => {
  test('the sample in the being\'s own name: voice:audio frames, then done — never a reply, never on disk', async () => {
    wire.setMode('ok');
    const { sessionId } = openForge(kit.connection.walletAddress);
    const before = await laneSnapshot();
    const mark = kit.frames.length;
    const speakMark = wire.speaks().length;

    send({ type: 'voice:audition', sessionId });
    const done = await closing(mark, sessionId);

    expect(done).toEqual({ type: 'voice:audition_done', sessionId });
    const frames = kit.frames.slice(mark);
    const audio = frames.filter((f) => f.type === 'voice:audio');
    expect(audio.length).toBeGreaterThanOrEqual(2);
    expect(audio.every((f) => /^audition-[0-9a-f-]{36}$/.test(f.turnId) && f.companion === NAME)).toBe(true);
    // Heard, not posted: no reply words reach the desk.
    expect(frames.filter((f) => f.type === 'consciousness:stream')).toEqual([]);

    const speaks = wire.speaks().slice(speakMark);
    const text = [...new Set(speaks.map((b) => b.text))].join(' ');
    expect(text).toContain(`Hello, I'm ${NAME}.`);
    expect(text).toContain('This is how I might sound when we talk.');
    // Every sentence in the pinned take's voice: its words, its clip.
    expect(speaks.every((b) => b.voice.words === WORDS)).toBe(true);
    expect(speaks.some((b) => b.voice.clip_ref === clipRef || b.voice.clip_b64)).toBe(true);
    expect(await laneSnapshot()).toEqual(before);
  });

  test('the person\'s own line is the line spoken', async () => {
    wire.setMode('ok');
    const { sessionId } = openForge(kit.connection.walletAddress);
    const mark = kit.frames.length;
    const speakMark = wire.speaks().length;
    send({ type: 'voice:audition', sessionId, line: '  Say this exact line, please.  ' });
    expect((await closing(mark, sessionId)).type).toBe('voice:audition_done');
    expect([...new Set(wire.speaks().slice(speakMark).map((b) => b.text))]).toEqual(['Say this exact line, please.']);
  });
});

describe('refusals, in plain words, with no engine asked', () => {
  const refused = async (frame, match) => {
    const mark = kit.frames.length;
    const bodies = wire.bodies.length;
    send({ type: 'voice:audition', ...frame });
    const out = await frameAfter(mark, (f) => f.type === 'voice:audition_error');
    expect(out.error).toMatch(match);
    expect(kit.frames.slice(mark).filter((f) => f.type === 'voice:audio')).toEqual([]);
    expect(wire.bodies.length).toBe(bodies);
    return out;
  };

  test('a forge started by another wallet is not this portal\'s to hear', async () => {
    const stranger = ethers.Wallet.createRandom().address;
    const { sessionId } = openForge(stranger);
    const out = await refused({ sessionId }, /not open .*not yours/);
    expect(out.sessionId).toBe(sessionId);
    // Restore the guardian's own forge for the tests that follow.
    openForge(kit.connection.walletAddress);
  });

  test('an unknown or ended session, a missing id, and a line that is not text', async () => {
    const { sessionId } = openForge(kit.connection.walletAddress);
    endForgeSession(sessionId);
    await refused({ sessionId }, /not open/);
    await refused({}, /names no forge session/);
    const live = openForge(kit.connection.walletAddress);
    await refused({ sessionId: live.sessionId, line: 42 }, /must be text/);
    await refused({ sessionId: live.sessionId, line: 'x'.repeat(501) }, /at most 500/);
  });

  test('VOX off refuses the audition', async () => {
    const { sessionId } = openForge(kit.connection.walletAddress);
    const pref = async (enabled) => {
      const mark = kit.frames.length;
      send({ type: 'voice:pref', enabled });
      await frameAfter(mark, (f) => f.type === 'voice:pref' && f.enabled === enabled);
    };
    await pref(false);
    await refused({ sessionId }, /VOX/);
    await pref(true);
  });
});

describe('the portal\'s voice controls hold', () => {
  test('a barge-in cuts the audition mid-sentence: done, interrupted; the stream is cut at the engine', async () => {
    wire.setMode('hold');
    const { sessionId } = openForge(kit.connection.walletAddress);
    const mark = kit.frames.length;
    const cutBefore = wire.cut.length;
    send({ type: 'voice:audition', sessionId });
    await frameAfter(mark, (f) => f.type === 'voice:audio');
    send({ type: 'voice:speech_start' });
    expect(await closing(mark, sessionId)).toEqual({ type: 'voice:audition_done', sessionId, interrupted: true });
    await expect.poll(() => wire.cut.length, { timeout: 5000 }).toBeGreaterThan(cutBefore);
    wire.setMode('ok');
  });

  test('a failing engine answers voice:audition_error with the reason', async () => {
    wire.setMode('fail');
    const { sessionId } = openForge(kit.connection.walletAddress);
    const mark = kit.frames.length;
    send({ type: 'voice:audition', sessionId });
    const out = await closing(mark, sessionId);
    expect(out.type).toBe('voice:audition_error');
    expect(out.error).toMatch(/^the voice could not speak: /);
    wire.setMode('ok');
  });
});
