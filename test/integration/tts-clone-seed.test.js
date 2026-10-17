/**
 * A sealed Voice DNA v2 actually reaches the sidecar — the clip travels the
 * REAL synthesis stack (the v2 successor of the v1 seed.wav regression: […] — every layer worked, but the clip never
 * reached the engine).
 *
 * Real: a Voice DNA v2 sealed through the real two-party service on a real
 * encrypted temp workspace; the real tts-provider (tier → engine-manager
 * ADOPTING a running sidecar → the speak adapter); real HTTP over loopback to
 * a real server speaking the speak protocol's wire (speak-wire-stand-in.js,
 * which holds clips and utterances exactly as the protocol says and answers
 * 409 unknown_ref for what it does not hold). No mocks anywhere on the path.
 *
 * Proves:
 *   1. The voice travels by clip_ref first; on 409 the clip is read from the
 *      being's custody and resent as clip_b64 — the bytes the guardian sealed.
 *   2. Once held, later sentences travel by ref only.
 *   3. A sidecar that forgot (restart / LRU) is recovered the same way, and a
 *      context ref it forgot is resent inline as WAV.
 *   4. Every chunk carries the sidecar's X-Utterance-Ref.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';
import { startSpeakWire, sealTestVoice, pinSpeechToStandIn } from '../helpers/speak-wire-stand-in.js';

const core = await import('../../core/index.js');
const svc = await import('../../core/voice/voice-dna-service.js');
const tts = await import('../../backend/services/tts-provider.js');
const { withSegment, emptyContext } = await import('../../backend/services/voice/speech-context.js');

const NEUMA = 'clip-voice';
let wire;
let origRoot;
let sealed;
let voice;

const drain = async (opts) => {
  const chunks = [];
  for await (const chunk of tts.synthesize({ text: 'Speak as yourself.', voice, ...opts })) chunks.push(chunk);
  return chunks;
};

beforeAll(async () => {
  origRoot = core.getWorkspacesRoot();
  core.setWorkspacesRoot(await createTempDir('tts-clip-ref'));
  sealed = await sealTestVoice(NEUMA);
  const { dna } = await svc.readVoice(NEUMA);
  voice = { ref: dna.clip.ref, words: dna.words, loadClip: () => svc.readVoiceClip(NEUMA, dna.clip.ref) };
  wire = await startSpeakWire();
  await pinSpeechToStandIn(wire.port, path.join(await createTempDir('tts-clip-ref-settings'), 'voice.json'));
}, 30_000);

afterAll(async () => {
  core.setWorkspacesRoot(origRoot);
  await wire?.close();
});

describe('a sealed v2 voice through the real synthesis stack', () => {
  test('clip_ref first; on 409 the sealed clip is resent inline, byte for byte', async () => {
    const chunks = await drain();
    const speaks = wire.speaks();
    expect(speaks).toHaveLength(2);
    expect(speaks[0].voice).toEqual({ clip_ref: sealed.ref, words: sealed.words });
    expect(speaks[1].voice.clip_ref).toBeUndefined();
    expect(Buffer.from(speaks[1].voice.clip_b64, 'base64').equals(sealed.clip)).toBe(true);
    expect(speaks[1].text).toBe('Speak as yourself.');
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => /^utt:[0-9a-f]{32}$/.test(c.utteranceRef))).toBe(true);
    expect(chunks.at(-1).final).toBe(true);
    expect(chunks[0]).toMatchObject({ format: 'pcm_s16le', sampleRate: 24_000, channels: 1 });
  });

  test('once the sidecar holds the clip, the next sentence travels by ref alone', async () => {
    const before = wire.speaks().length;
    await drain();
    const after = wire.speaks().slice(before);
    expect(after).toHaveLength(1);
    expect(after[0].voice).toEqual({ clip_ref: sealed.ref, words: sealed.words });
  });

  test('a sidecar that forgot (restart) recovers the clip and the context inline', async () => {
    const first = await drain();
    const ring = withSegment(emptyContext(), {
      speaker: 'being', words: 'Speak as yourself.', pcm: Buffer.alloc(48_000, 1), sampleRate: 24_000,
      ref: first[0].utteranceRef,
    }, sealed.ref);
    wire.forget();
    const before = wire.speaks().length;
    await drain({ context: ring.segments });
    const tries = wire.speaks().slice(before);
    // ref → 409 (clip) → clip inline, context ref → 409 (utterance) → context inline → 200
    expect(tries).toHaveLength(3);
    expect(tries[0].context).toEqual([{ speaker: 'being', words: 'Speak as yourself.', ref: first[0].utteranceRef }]);
    expect(tries[1].voice.clip_b64).toBeDefined();
    expect(tries[2].context[0].ref).toBeUndefined();
    expect(Buffer.from(tries[2].context[0].audio_b64, 'base64').toString('latin1', 0, 4)).toBe('RIFF');
  });
});
