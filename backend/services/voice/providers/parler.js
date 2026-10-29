// Parler adapter — Apache-2.0 local text-described voice design.
//
// The 'design from scratch' path for the Voice Forge ceremony. User writes a
// prose description ([…]), Parler synthesizes that voice, the witness iterates on
// the description, then seals it into Voice DNA with the seed that lets the
// exact voice be regenerated on any machine.
//
// Talks to the Python sidecar at voice-engines/parler/server.py.
// Reference: https://github.com/huggingface/parler-tts
//
// Sidecar API:
//   GET  /health      → { ok, model, device, sample_rate }
//   POST /synthesize  → streamed PCM (~44.1kHz mono s16le)
//     body: { text, description, seed?, language? }
//     resp: chunked binary PCM
//
// Voice DNA wiring:
//   - voiceDNA.engine.description → prose voice description (REQUIRED for Parler)
//   - voiceDNA.engine.voiceSeed   → integer seed for deterministic regeneration
//   Both fields are Parler-specific; cloning engines ignore them.

import { createLogger } from '../../logger.js';
import { sidecarFetch } from '../sidecar-trust.js';
const log = createLogger('Voice.Parler');

const DEFAULT_SAMPLE_RATE = 44100;
const CHUNK_BYTES = 4096;

// pure — build the JSON request body for the sidecar
const buildParlerRequest = ({ text, voiceDNA, config }) => {
  const description = voiceDNA?.engine?.description || config.description;
  if (!description) {
    throw new Error('parler synthesize requires a voice description — set voiceDNA.engine.description or provider config.description');
  }
  const body = {
    text,
    description,
  };
  if (voiceDNA?.engine?.voiceSeed !== undefined && voiceDNA?.engine?.voiceSeed !== null) {
    body.seed = voiceDNA.engine.voiceSeed;
  }
  return body;
};

// pure — read format metadata from response headers
const readFormatFromHeaders = (response) => ({
  sampleRate: Number(response.headers.get('x-audio-sample-rate') || DEFAULT_SAMPLE_RATE),
  channels: Number(response.headers.get('x-audio-channels') || 1),
  format: response.headers.get('x-audio-format') || 'pcm_s16le',
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

export const parlerAdapter = {
  async *synthesize({ text, voiceDNA, signal, config }) {
    const body = buildParlerRequest({ text, voiceDNA, config });
    const url = `${config.endpoint.replace(/\/$/, '')}/synthesize`;
    log.debug('synthesize → parler', { chars: text.length, hasSeed: body.seed !== undefined });

    const response = await sidecarFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`parler synthesize failed (${response.status}): ${errText.slice(0, 200)}`);
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
      return { ok: true, latencyMs: Math.round(performance.now() - t0), device: data.device };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },
};
