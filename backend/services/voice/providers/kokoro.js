// Kokoro adapter — Apache-2.0 lightweight CPU/GPU engine.
//
// Talks to the Python sidecar at voice-engines/kokoro/server.py.
// Reference: HF repo hexgrad/Kokoro-82M.
//
// Kokoro has NO voice cloning — only preset voices. Voice DNA's role is to
// remember which preset a neuma has chosen (voiceDNA.engine.voiceId holds the
// preset name like 'af_heart', 'bm_lewis', etc.).
//
// Sidecar API:
//   GET  /health      → { ok: true, voices: [...] }
//   POST /synthesize  → streamed PCM (24kHz, mono, f32le)
//     body: { text, voice, speed? }
//     resp: chunked binary PCM

import { createLogger } from '../../logger.js';
const log = createLogger('Voice.Kokoro');

// pure
const buildKokoroRequest = ({ text, voiceDNA, config }) => ({
  text,
  voice: voiceDNA?.engine?.voiceId || config.voice || 'af_heart',
  speed: voiceDNA?.style?.baseRate ?? 1.0,
});

const DEFAULT_SAMPLE_RATE = 24000;
const CHUNK_BYTES = 4096;

// pure — read format metadata from response headers
const readFormatFromHeaders = (response) => ({
  sampleRate: Number(response.headers.get('x-audio-sample-rate') || DEFAULT_SAMPLE_RATE),
  channels: Number(response.headers.get('x-audio-channels') || 1),
  format: response.headers.get('x-audio-format') || 'pcm_f32le',
});

// impure
async function* streamPcmBody(response, signal) {
  const fmt = readFormatFromHeaders(response);
  const reader = response.body.getReader();
  let sequence = 0;
  let buf = new Uint8Array(0);
  try {
    while (true) {
      if (signal?.aborted) throw new Error('aborted');
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const merged = new Uint8Array(buf.length + value.length);
      merged.set(buf, 0);
      merged.set(value, buf.length);
      buf = merged;
      while (buf.length >= CHUNK_BYTES) {
        const slice = buf.slice(0, CHUNK_BYTES);
        buf = buf.slice(CHUNK_BYTES);
        yield { bytes: slice, ...fmt, sequence: sequence++, final: false };
      }
    }
    if (buf.length > 0) {
      yield { bytes: buf, ...fmt, sequence, final: true };
    } else {
      yield { bytes: new Uint8Array(0), ...fmt, sequence, final: true };
    }
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}

export const kokoroAdapter = {
  async *synthesize({ text, voiceDNA, signal, config }) {
    const body = buildKokoroRequest({ text, voiceDNA, config });
    const url = `${config.endpoint.replace(/\/$/, '')}/synthesize`;
    log.debug('synthesize → kokoro', { chars: text.length, voice: body.voice });

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`kokoro synthesize failed (${response.status}): ${errText.slice(0, 200)}`);
    }

    yield* streamPcmBody(response, signal);
  },

  async testConnection(config) {
    const t0 = performance.now();
    try {
      const r = await fetch(`${config.endpoint.replace(/\/$/, '')}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!r.ok) return { ok: false, error: `health ${r.status}` };
      const data = await r.json().catch(() => ({}));
      return { ok: true, latencyMs: Math.round(performance.now() - t0), voices: data.voices?.length ?? 0 };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },
};
