/**
 * Kyutai adapter seam (FR-16/FR-17/FR-18) — hermetic lane.
 *
 *   - buildKyutaiRequest: exact body per conditioning state (pure)
 *   - classifyKyutaiError: the warn-and-fallback decision table (pure)
 *   - _pcm-stream: uniform AudioChunks from REAL web Response objects (real
 *     body streams, real headers — no mock anywhere)
 *   - isLoopbackBind: the engine-manager non-loopback refuse guard
 *   - FR-16 structure: ONLY the new PCM adapters import _pcm-stream.js
 *
 * All functions under test are pure or fed real objects — no mocks.
 */

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildKyutaiRequest, classifyKyutaiError, kyutaiAdapter } from '../../backend/services/voice/providers/kyutai.js';
import { readFormatFromHeaders, streamPcmBody } from '../../backend/services/voice/providers/_pcm-stream.js';
import { adapters } from '../../backend/services/voice/providers/index.js';
import { isLoopbackBind } from '../../backend/services/voice/engine-manager.js';

describe('buildKyutaiRequest — exact body per conditioning state', () => {
  test('a bare turn sends text + the baked cfg_coef only', () => {
    expect(buildKyutaiRequest({ text: 'hello' })).toEqual({ text: 'hello', cfg_coef: 2.0 });
  });

  test('engine.voiceId maps to voice; absent voiceId omits the key (any id ≠ baked 409s)', () => {
    const body = buildKyutaiRequest({
      text: 'hi',
      voiceDNA: { engine: { voiceId: 'voice-donations/James.wav.1e68beda@240.safetensors' } },
    });
    expect(body.voice).toBe('voice-donations/James.wav.1e68beda@240.safetensors');
    expect(buildKyutaiRequest({ text: 'hi', voiceDNA: { engine: { voiceId: null } } }))
      .not.toHaveProperty('voice');
  });

  test('an attached inline embedding rides as embedding_b64 and supersedes the bare ref', () => {
    const body = buildKyutaiRequest({
      text: 'hi',
      voiceDNA: { engine: { embeddingRef: 'sha256:ab' }, _inlineEmbedding: 'QUJD' },
    });
    expect(body.embedding_b64).toBe('QUJD');
    expect(body).not.toHaveProperty('embedding_ref');
  });

  test('embeddingRef without inline bytes is sent as the embedding_ref assertion', () => {
    const body = buildKyutaiRequest({
      text: 'hi',
      voiceDNA: { engine: { embeddingRef: 'sha256:cd' } },
    });
    expect(body.embedding_ref).toBe('sha256:cd');
    expect(body).not.toHaveProperty('embedding_b64');
  });

  test('engine.cfgCoef passes through; null/undefined falls back to the baked 2.0', () => {
    expect(buildKyutaiRequest({ text: 'hi', voiceDNA: { engine: { cfgCoef: 1.5 } } }).cfg_coef).toBe(1.5);
    expect(buildKyutaiRequest({ text: 'hi', voiceDNA: { engine: { cfgCoef: null } } }).cfg_coef).toBe(2.0);
  });

  test('emotion is accepted and deliberately dropped — no emotion field is ever built', () => {
    const body = buildKyutaiRequest({
      text: 'hi',
      voiceDNA: { emotionProfile: { default: 'serene' } },
      emotion: { label: 'joyful', intensity: 0.9 },
    });
    expect(body).toEqual({ text: 'hi', cfg_coef: 2.0 });
  });
});

describe('classifyKyutaiError — the warn-and-fallback decision table', () => {
  test('409 conditioning mismatch is a fallback trigger, NOT an engine failure', () => {
    expect(classifyKyutaiError(409)).toBe('fallback-baked');
  });

  test('every other sidecar error status throws per the shared adapter contract', () => {
    for (const status of [400, 422, 500, 503]) {
      expect(classifyKyutaiError(status)).toBe('throw');
    }
  });
});

describe('_pcm-stream — uniform AudioChunks from real Response bodies', () => {
  const pcmResponse = (bytes, headers = {}) =>
    new Response(bytes, {
      status: 200,
      headers: {
        'x-audio-format': 'pcm_s16le',
        'x-audio-sample-rate': '24000',
        'x-audio-channels': '1',
        ...headers,
      },
    });

  const drain = async (gen) => {
    const out = [];
    for await (const chunk of gen) out.push(chunk);
    return out;
  };

  test('a 9000-byte body slices into 4096/4096/808 with sequence + final only on the last', async () => {
    const chunks = await drain(streamPcmBody(pcmResponse(new Uint8Array(9000).fill(1))));
    expect(chunks.map((c) => c.bytes.length)).toEqual([4096, 4096, 808]);
    expect(chunks.map((c) => c.sequence)).toEqual([0, 1, 2]);
    expect(chunks.map((c) => c.final)).toEqual([false, false, true]);
    for (const c of chunks) {
      expect(c.sampleRate).toBe(24000);
      expect(c.channels).toBe(1);
      expect(c.format).toBe('pcm_s16le');
    }
  });

  test('a body of exact slice multiples still ends with an explicit empty final chunk', async () => {
    const chunks = await drain(streamPcmBody(pcmResponse(new Uint8Array(8192))));
    expect(chunks.map((c) => c.bytes.length)).toEqual([4096, 4096, 0]);
    expect(chunks.at(-1).final).toBe(true);
  });

  test("the sidecar's 3840 B frames are re-sliced to the uniform 4096 B across frame boundaries", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(3840).fill(2));
        controller.enqueue(new Uint8Array(3840).fill(3));
        controller.close();
      },
    });
    const chunks = await drain(streamPcmBody(pcmResponse(stream)));
    expect(chunks.map((c) => c.bytes.length)).toEqual([4096, 3584]);
    expect(chunks[0].bytes[0]).toBe(2);
    expect(chunks[0].bytes[4095]).toBe(3); // frame boundary crossed mid-slice
  });

  test('format metadata comes from headers when present, 24kHz/pcm_s16le/1 defaults when absent', async () => {
    expect(readFormatFromHeaders(pcmResponse(new Uint8Array(0)))).toEqual({
      sampleRate: 24000, channels: 1, format: 'pcm_s16le',
    });
    const noHeaders = await drain(streamPcmBody(new Response(new Uint8Array(10))));
    expect(noHeaders.at(-1).sampleRate).toBe(24000);
    expect(noHeaders.at(-1).format).toBe('pcm_s16le');
    const odd = await drain(streamPcmBody(pcmResponse(new Uint8Array(10), { 'x-audio-sample-rate': '16000' })));
    expect(odd.at(-1).sampleRate).toBe(16000);
  });

  test('a pre-aborted signal aborts the stream', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(drain(streamPcmBody(pcmResponse(new Uint8Array(9000)), ac.signal)))
      .rejects.toThrow('aborted');
  });
});

describe('adapter registration', () => {
  test('kyutai is registered with the embedding capability flag and no inline-ref flag', () => {
    expect(adapters.kyutai).toBe(kyutaiAdapter);
    expect(adapters.kyutai.needsInlineEmbedding).toBe(true);
    expect(adapters.kyutai.needsInlineRef).toBeFalsy();
  });

  test('FR-16 structure: ONLY the new PCM adapters import _pcm-stream.js', () => {
    const src = (f) =>
      readFileSync(new URL(`../../backend/services/voice/providers/${f}`, import.meta.url), 'utf8');
    for (const f of ['zonos.js', 'kokoro.js', 'parler.js', 'cartesia.js', 'elevenlabs.js']) {
      expect(src(f)).not.toMatch(/_pcm-stream/);
    }
    expect(src('kyutai.js')).toMatch(/from '\.\/_pcm-stream\.js'/);
  });
});

describe('isLoopbackBind — the engine-manager bind guard (FR-18)', () => {
  test('loopback spellings are allowed', () => {
    for (const host of ['127.0.0.1', 'localhost', '::1', '[::1]']) {
      expect(isLoopbackBind(host)).toBe(true);
    }
  });

  test('wildcard, LAN, and empty binds are refused', () => {
    for (const host of ['0.0.0.0', '::', '192.168.1.10', '10.0.0.5', '', undefined]) {
      expect(isLoopbackBind(host)).toBe(false);
    }
  });
});
