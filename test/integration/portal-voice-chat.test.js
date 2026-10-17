/**
 * The chat voice path on the REAL stack — no mocks anywhere on the path.
 *
 *   real llm-provider  ← real loopback OpenAI-compatible SSE server
 *   real turn voice    ← Voice DNA v2 sealed through the real two-party service
 *   real sentence stream, real speech-turn chain, real context ring
 *   real tts-provider  ← tier pinned Standard/full; engine-manager ADOPTS a
 *                        real loopback server speaking the speak protocol
 *                        (speak-wire-stand-in.js — clips, utterance refs, 409s)
 *   real ws socket pair — frames observed at a genuine WebSocket client
 *
 * Proves: a v2 voice speaks (clip by ref, inline on 409); a v1-only being and a
 * being with no voice are SILENT (Founder's calls); words are released by their own
 * voice; sentences stay ordered; barge-in cuts the render and drops the queue;
 * the context ring fills with every sentence spoken in full (never a cut one)
 * and rides every later sentence — the being's own audio by ref, the person's
 * mic audio as WAV; a failing or wedged engine never costs the words; markdown
 * reaches the eye, never the mouth.
 *
 * The production caller passes connection.activeTurn.signal as the same
 * `signal` (portal-stream.js) and resolves the voice with the connection
 * (`_resolveVoiceDNA(neumaId, connection)`).
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { startSpeakWire, sealTestVoice, pinSpeechToStandIn } from '../helpers/speak-wire-stand-in.js';

const core = await import('../../core/index.js');
const svc = await import('../../core/voice/voice-dna-service.js');
const llm = await import('../../backend/services/llm-provider.js');
const { withSegment } = await import('../../backend/services/voice/speech-context.js');
const { __test } = await import('../../backend/services/portal-test-surface.js');
const { _runLLMStream, _resolveVoiceDNA } = __test;

const PRESET = { temperature: 0.7, topP: 0.9, maxTokens: 64 };
const S1 = 'This is a plain opening line for the reply. ';
const S2 = 'Such joy and delight fill this beautiful moment. ';
const NEUMA = 'voiced-being';

let replyOverride = null;
let llmServer;
const sse = (res, payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
const startLlm = async () => {
  llmServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const text of (replyOverride || [S1, S2])) sse(res, { choices: [{ delta: { content: text } }] });
    res.write('data: [DONE]\n\n');
    res.end();
  });
  await new Promise((r) => llmServer.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${llmServer.address().port}`;
};

let wss;
const openSocketPair = async () => {
  const serverSide = new Promise((r) => wss.once('connection', r));
  const client = new WebSocket(`ws://127.0.0.1:${wss.address().port}`);
  const frames = [];
  client.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    frames.push(msg);
    if (msg.type === 'voice:audio') client.emit('voice:audio', msg);
  });
  await new Promise((r) => client.once('open', r));
  return { ws: await serverSide, client, frames };
};

let wire;
let origRoot;
let sealed;

const audioOf = (frames) => frames.filter((f) => f.type === 'voice:audio');
const wordsOf = (frames) => frames.filter((f) => f.type === 'consciousness:stream');
// Every turn rides a signal, as in production (connection.activeTurn.signal).
const run = async ({ connection = {}, signal = new AbortController().signal, neumaId = NEUMA } = {}) => {
  const turnVoice = await _resolveVoiceDNA(neumaId, connection);
  const pair = await openSocketPair();
  const result = await _runLLMStream(pair.ws, [{ role: 'user', content: 'hi' }], 'Fenna', turnVoice, PRESET, [], signal);
  return { ...pair, result, connection, turnVoice };
};

beforeAll(async () => {
  origRoot = core.getWorkspacesRoot();
  core.setWorkspacesRoot(await createTempDir('portal-voice-chat'));
  sealed = await sealTestVoice(NEUMA);
  await svc.forgeVoiceDNA('v1-only', { witness: `0x${'a'.repeat(40)}`, provider: 'zonos' });
  wire = await startSpeakWire();
  await pinSpeechToStandIn(wire.port, path.join(await createTempDir('portal-voice-settings'), 'voice.json'));
  wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise((r) => wss.once('listening', r));
  // 'openai' shape = plain OpenAI-compatible SSE with no think-probe traffic.
  llm.setConfig({ provider: 'openai', endpoint: await startLlm(), apiKey: 'loopback', model: 'loopback-model' });
}, 30_000);

afterAll(async () => {
  core.setWorkspacesRoot(origRoot);
  llmServer.closeAllConnections?.();
  for (const c of wss.clients) c.terminate();
  await Promise.all([
    new Promise((r) => llmServer.close(r)),
    new Promise((r) => wss.close(r)),
    wire.close(),
  ]);
}, 30_000);

const fresh = () => { wire.setMode('ok'); wire.setDelay(() => 0); replyOverride = null; };

describe('a v2 voice speaks; a being without one is silent', () => {
  test('the sealed voice speaks every sentence, by clip ref — words released by their own audio', async () => {
    fresh();
    const before = wire.speaks().length;
    const { client, frames, result } = await run();
    await expect.poll(() => wordsOf(frames).length, { timeout: 5000 }).toBe(2);
    client.close();

    expect(result.content.trim()).toBe((S1 + S2).trim());
    const speaks = wire.speaks().slice(before).filter((b) => b.voice.clip_ref);
    expect(speaks.map((b) => b.text.trim())).toEqual([S1.trim(), S2.trim()]);
    expect(speaks.every((b) => b.voice.clip_ref === sealed.ref && b.voice.words === sealed.words)).toBe(true);
    // emotion is gone from the wire: the conversation is the emotion
    expect(speaks.some((b) => 'emotion' in b)).toBe(false);
    expect(audioOf(frames).length).toBeGreaterThanOrEqual(2);
    expect(audioOf(frames).every((f) => f.companion === 'Fenna')).toBe(true);
    // THE INVARIANT: the first words come strictly after the first audio
    expect(frames.findIndex((f) => f.type === 'consciousness:stream'))
      .toBeGreaterThan(frames.findIndex((f) => f.type === 'voice:audio'));
    // the turn warmed the voice before its first sentence
    expect(wire.bodies.some((b) => b.path === '/warm')).toBe(true);
  });

  test('a being with ONLY a v1 voice is silent — no engine is asked, the words still stream', async () => {
    fresh();
    const before = wire.bodies.length;
    const { client, frames, turnVoice } = await run({ neumaId: 'v1-only' });
    await expect.poll(() => wordsOf(frames).map((f) => f.content).join(''), { timeout: 5000 }).toBe(S1 + S2);
    client.close();
    expect(turnVoice).toBe(null);
    expect(audioOf(frames)).toHaveLength(0);
    expect(wire.bodies.length).toBe(before);
    // the token path, untouched: the raw text, not trimmed sentences
    expect(wordsOf(frames).map((f) => f.content).join('')).toBe(S1 + S2);
  });

  test('a being with no voice at all is silent', async () => {
    fresh();
    const before = wire.bodies.length;
    const { client, frames, turnVoice } = await run({ neumaId: 'never-voiced' });
    await expect.poll(() => wordsOf(frames).map((f) => f.content).join(''), { timeout: 5000 }).toBe(S1 + S2);
    client.close();
    expect(turnVoice).toBe(null);
    expect(audioOf(frames)).toHaveLength(0);
    expect(wire.bodies.length).toBe(before);
  });
});

describe('the context ring', () => {
  test('fills with each sentence spoken in full, and every later sentence carries it', async () => {
    fresh();
    const connection = {};
    // The person spoke first (their mic line, 16 kHz) — it rides as WAV.
    connection.speechContext = withSegment(null, {
      speaker: 'person', words: 'hello there', pcm: Buffer.alloc(32_000, 2), sampleRate: 16_000,
    });
    const before = wire.speaks().length;
    const { client } = await run({ connection });
    client.close();
    const speaks = wire.speaks().slice(before);
    const ring = connection.speechContext;
    expect(ring.voiceRef).toBe(sealed.ref);
    expect(ring.segments.map((s) => [s.speaker, s.words])).toEqual([
      ['person', 'hello there'], ['being', S1.trim()], ['being', S2.trim()],
    ]);
    expect(ring.segments.slice(1).every((s) => /^utt:[0-9a-f]{32}$/.test(s.ref) && s.pcm.length > 0)).toBe(true);
    const s1 = speaks.find((b) => b.text === S1.trim());
    const s2 = speaks.find((b) => b.text === S2.trim());
    expect(s1.context).toHaveLength(1);
    expect(s1.context[0]).toMatchObject({ speaker: 'person', words: 'hello there' });
    expect(Buffer.from(s1.context[0].audio_b64, 'base64').readUInt32LE(24)).toBe(16_000);
    expect(s2.context.map((c) => c.speaker)).toEqual(['person', 'being']);
    expect(s2.context[1]).toEqual({ speaker: 'being', words: S1.trim(), ref: ring.segments[1].ref });

    // The next turn opens with the whole exchange as context.
    const mark = wire.speaks().length;
    const again = await run({ connection });
    again.client.close();
    const next = wire.speaks().slice(mark).find((b) => b.text === S1.trim());
    expect(next.context.map((c) => c.words)).toEqual(['hello there', S1.trim(), S2.trim()]);
    expect(connection.speechContext.segments).toHaveLength(5);
  });

  test('barge-in: the abort cuts the render, the queue is dropped, and the cut sentence never joins the ring', async () => {
    fresh();
    wire.setMode('hold');
    const connection = {};
    const interrupt = new AbortController();
    const before = wire.speaks().length;
    const turnVoice = await _resolveVoiceDNA(NEUMA, connection);
    const { ws, client, frames } = await openSocketPair();
    client.on('voice:audio', () => interrupt.abort());
    const t0 = Date.now();
    await _runLLMStream(ws, [{ role: 'user', content: 'hi' }], 'Fenna', turnVoice, PRESET, [], interrupt.signal);
    client.close();
    expect(Date.now() - t0).toBeLessThan(4000); // we did not sit out a held render
    expect(audioOf(frames).length).toBeGreaterThan(0);
    const speaks = wire.speaks().slice(before).filter((b) => b.text);
    expect(new Set(speaks.map((b) => b.text))).toEqual(new Set([S1.trim()]));
    await expect.poll(() => wire.cut.length, { timeout: 3000 }).toBeGreaterThan(0);
    expect(connection.speechContext ?? null).toBe(null);
  }, 15000);

  test('an already-aborted turn puts nothing on the wire', async () => {
    fresh();
    const interrupt = new AbortController();
    interrupt.abort();
    const before = wire.speaks().length;
    const turnVoice = await _resolveVoiceDNA(NEUMA, {});
    const { ws, client, frames } = await openSocketPair();
    await _runLLMStream(ws, [{ role: 'user', content: 'hi' }], 'Fenna', turnVoice, PRESET, [], interrupt.signal)
      .catch((err) => { if (err?.name !== 'AbortError' && !/abort/i.test(err?.message || '')) throw err; });
    client.close();
    expect(wire.speaks().length).toBe(before);
    expect(audioOf(frames)).toHaveLength(0);
  });
});

describe('ordering and degradation', () => {
  test('a slow first sentence still plays before a fast second', async () => {
    fresh();
    wire.setDelay((body) => (/^This is a plain opening/.test(body.text) ? 400 : 0));
    const { client, frames } = await run();
    await expect.poll(() => wordsOf(frames).length, { timeout: 5000 }).toBe(2);
    client.close();
    const marks = audioOf(frames).map((f) => Buffer.from(f.bytes, 'base64')[0]);
    expect(marks.indexOf(S2.charCodeAt(0))).toBeGreaterThan(marks.lastIndexOf(S1.charCodeAt(0)));
    // each sentence's words wait on that sentence's own audio
    const s2Words = frames.findIndex((f) => f.type === 'consciousness:stream' && /joy/.test(f.content));
    const s2Audio = frames.findIndex((f) => f.type === 'voice:audio' && Buffer.from(f.bytes, 'base64')[0] === S2.charCodeAt(0));
    expect(s2Words).toBeGreaterThan(s2Audio);
  });

  test('a failing engine still delivers every word — silence is a voice failure, not a lost reply', async () => {
    fresh();
    wire.setMode('fail');
    const { client, frames } = await run();
    await expect.poll(() => wordsOf(frames).length, { timeout: 5000 }).toBe(2);
    client.close();
    expect(audioOf(frames)).toHaveLength(0);
    expect(wordsOf(frames).map((f) => f.content).join('').trim()).toBe((S1 + S2).trim());
  }, 15000);

  test('a WEDGED engine does not hold the reply invisible — the words come within the bound', async () => {
    fresh();
    wire.setMode('wedge');
    const turnVoice = await _resolveVoiceDNA(NEUMA, {});
    const { ws, client, frames } = await openSocketPair();
    const started = Date.now();
    const operator = new AbortController();
    const turn = _runLLMStream(ws, [{ role: 'user', content: 'hi' }], 'Fenna', turnVoice, PRESET, [], operator.signal);
    await expect.poll(() => wordsOf(frames).length, { timeout: 12_000 }).toBeGreaterThanOrEqual(1);
    expect(Date.now() - started).toBeLessThan(12_000);
    expect(audioOf(frames)).toHaveLength(0);
    expect(wordsOf(frames).map((f) => f.content).join('')).toContain('plain opening line');
    await turn;
    // The operator moves on: the wedged render and the queued sentence behind
    // it are cut, so nothing outlives the turn.
    operator.abort();
    client.close();
  }, 40_000);

  test('markdown reaches the eye, never the mouth', async () => {
    fresh();
    replyOverride = ['That is **important** and clear. ', 'See the `portal` now. '];
    const before = wire.speaks().length;
    const { client, frames } = await run();
    await expect.poll(() => wordsOf(frames).length, { timeout: 5000 }).toBe(2);
    client.close();
    const spoken = wire.speaks().slice(before).map((b) => b.text).join(' ');
    expect(spoken).not.toMatch(/[*`]/);
    expect(spoken).toContain('important');
    const shown = wordsOf(frames).map((f) => f.content).join('');
    expect(shown).toContain('**important**');
    expect(shown).toContain('`portal`');
  }, 30_000);
});
