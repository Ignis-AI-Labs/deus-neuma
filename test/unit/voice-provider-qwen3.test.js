/**
 * Qwen3 adapter seam (B-21 / FR-28) — hermetic lane.
 *
 *   - buildQwen3Request: the binding MODE-BRANCH RULE (pure) — clone carries
 *     {text, ref_audio_b64} from the inline sealed clip, design carries
 *     {text, description, seed} and NEVER a ref; the four shapes the sidecar
 *     400s (description+ref, neither, design-without-seed, voice id) are
 *     never emitted
 *   - seed integer-validation at the builder (0..2³¹−1, the sidecar's
 *     pydantic bounds)
 *   - registration: needsInlineRef via the EXISTING _withInlineRef seam —
 *     no new ref mechanism
 *   - Parler registered-unlisted: adapter + defaults stay registered, but
 *     ENGINE_MODES lists it no more — qwen3 VoiceDesign is the DESIGN
 *     successor
 *
 * All functions under test are pure or frozen registry views — no mocks, no
 * network, no sidecar (the live suite is Wave-3's).
 */

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildQwen3Request, qwen3Adapter } from '../../backend/services/voice/providers/qwen3.js';
import { adapters } from '../../backend/services/voice/providers/index.js';
import { getEngineModes } from '../../core/voice/voice-forge.js';

const REF_B64 = 'UklGRg=='; // stands in for the sealed seed.wav, base64
const DESIGN_DNA = { engine: { description: 'a warm, unhurried voice', voiceSeed: 42 } };

describe('buildQwen3Request — clone branch (exact body)', () => {
  test('clone carries exactly { text, ref_audio_b64 } from the inline sealed clip', () => {
    const body = buildQwen3Request({ text: 'hello', voiceDNA: { _inlineRefAudio: REF_B64 } });
    expect(body).toEqual({ text: 'hello', ref_audio_b64: REF_B64 });
  });

  test('clone never carries description or voice — the sidecar 400s both', () => {
    const body = buildQwen3Request({ text: 'hi', voiceDNA: { _inlineRefAudio: REF_B64 } });
    expect(body).not.toHaveProperty('description');
    expect(body).not.toHaveProperty('voice');
    expect(body).not.toHaveProperty('ref_path');
  });

  test('an integer voiceSeed rides clone turns; null/undefined omits the key', () => {
    const withSeed = buildQwen3Request({
      text: 'hi',
      voiceDNA: { _inlineRefAudio: REF_B64, engine: { voiceSeed: 7 } },
    });
    expect(withSeed.seed).toBe(7);
    const noSeed = buildQwen3Request({
      text: 'hi',
      voiceDNA: { _inlineRefAudio: REF_B64, engine: { voiceSeed: null } },
    });
    expect(noSeed).not.toHaveProperty('seed');
  });

  test('clone without the inline ref THROWS — the neither-shape is never emitted', () => {
    // The Base model serves no preset voices: no ref means no voice at all,
    // so the builder refuses instead of letting the sidecar 400.
    expect(() => buildQwen3Request({ text: 'hi', voiceDNA: {} }))
      .toThrow(/requires the sealed reference clip/);
    expect(() => buildQwen3Request({ text: 'hi', voiceDNA: { _inlineRefAudio: '' } }))
      .toThrow(/requires the sealed reference clip/);
    expect(() => buildQwen3Request({ text: 'hi' }))
      .toThrow(/requires the sealed reference clip/);
  });
});

describe('buildQwen3Request — design branch (exact body)', () => {
  test('design carries exactly { text, description, seed }', () => {
    expect(buildQwen3Request({ text: 'hello', voiceDNA: DESIGN_DNA }))
      .toEqual({ text: 'hello', description: 'a warm, unhurried voice', seed: 42 });
  });

  test('design NEVER forces a ref — even when _inlineRefAudio is attached', () => {
    // A design-forged voice also carries seed.refHash (source: synthesized),
    // so the ref slot can be populated on the DNA; the description+ref shape
    // is one of the four the sidecar 400s. The branch is description-first.
    const body = buildQwen3Request({
      text: 'hi',
      voiceDNA: { ...DESIGN_DNA, _inlineRefAudio: REF_B64 },
    });
    expect(body).toEqual({ text: 'hi', description: 'a warm, unhurried voice', seed: 42 });
    expect(body).not.toHaveProperty('ref_audio_b64');
  });

  test('design without a seed THROWS — the design-without-seed shape is never emitted', () => {
    const dna = { engine: { description: 'a warm, unhurried voice' } };
    expect(() => buildQwen3Request({ text: 'hi', voiceDNA: dna }))
      .toThrow(/design mode requires an integer seed/);
    expect(() => buildQwen3Request({ text: 'hi', voiceDNA: { engine: { ...dna.engine, voiceSeed: null } } }))
      .toThrow(/design mode requires an integer seed/);
  });
});

describe('buildQwen3Request — seed integer-validation (sidecar pydantic bounds)', () => {
  test('boundary integers 0 and 2³¹−1 pass', () => {
    const mk = (voiceSeed) => ({ engine: { description: 'a voice for seeds', voiceSeed } });
    expect(buildQwen3Request({ text: 'hi', voiceDNA: mk(0) }).seed).toBe(0);
    expect(buildQwen3Request({ text: 'hi', voiceDNA: mk(2 ** 31 - 1) }).seed).toBe(2 ** 31 - 1);
  });

  test('non-integers, out-of-range, and string seeds throw in both modes', () => {
    const mk = (voiceSeed) => ({ engine: { description: 'a voice for seeds', voiceSeed } });
    for (const bad of [-1, 2 ** 31, 1.5, '42', NaN]) {
      expect(() => buildQwen3Request({ text: 'hi', voiceDNA: mk(bad) }), `design seed ${bad}`)
        .toThrow(/integer seed/);
      expect(() => buildQwen3Request({
        text: 'hi',
        voiceDNA: { _inlineRefAudio: REF_B64, engine: { voiceSeed: bad } },
      }), `clone seed ${bad}`).toThrow(/integer/);
    }
  });
});

describe('qwen3 registration — existing needsInlineRef seam, no new mechanism', () => {
  test('registered beside kyutai with the inline-ref flag and no embedding flag', () => {
    expect(adapters.qwen3).toBe(qwen3Adapter);
    expect(adapters.qwen3.needsInlineRef).toBe(true);
    expect(adapters.qwen3.needsInlineEmbedding).toBeFalsy();
  });

  test('qwen3 rides the shared 24 kHz PCM reader; the five original adapters still do not', () => {
    const src = (f) =>
      readFileSync(new URL(`../../backend/services/voice/providers/${f}`, import.meta.url), 'utf8');
    expect(src('qwen3.js')).toMatch(/from '\.\/_pcm-stream\.js'/);
    for (const f of ['zonos.js', 'kokoro.js', 'parler.js', 'cartesia.js', 'elevenlabs.js']) {
      expect(src(f)).not.toMatch(/_pcm-stream/);
    }
  });
});

describe('Parler registered-unlisted (B-21 one-liner)', () => {
  test('parler stays REGISTERED — its adapter resolves (WP7 retires it)', () => {
    expect(adapters.parler).toBeTruthy();
  });

  test('parler is UNLISTED from the forge catalog; qwen3 succeeds it in DESIGN', () => {
    expect(getEngineModes('parler')).toEqual([]);
    expect(getEngineModes('qwen3')).toEqual(['clone', 'design']);
  });
});
