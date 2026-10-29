// Zonos adapter — Apache-2.0 local voice cloning engine.
//
// Talks to the Python sidecar at voice-engines/zonos/server.py.
// Reference: HF repo Zyphra/Zonos-v0.1-transformer.
//
// Sidecar API:
//   GET  /health      → { ok: true, model: 'zonos-v0.1', device: 'cuda' }
//   POST /synthesize  → streamed PCM (24kHz, mono, s16le)
//     body: { text, ref_audio_b64?, ref_text?, language?, emotion?, speed?, pitch? }
//     resp: chunked binary PCM (no headers) OR { error } JSON on failure
//
// Voice DNA wiring:
//   - voiceDNA.engine.voiceId === null → use default voice preset
//   - voiceDNA.seed.refHash present    → server loads seed.wav from workspace
//   - voiceDNA.engine.embeddingRef     → server loads embedding from workspace
//   In v1 the route layer streams the seed audio inline as ref_audio_b64.

import { createLogger } from '../../logger.js';
import { sidecarFetch } from '../sidecar-trust.js';
const log = createLogger('Voice.Zonos');

// Neuma emotion vocabulary (core/runtime/emotion-detector.js) → the sidecar's
// Zonos conditioning slots (happiness/sadness/disgust/fear/surprise/anger/
// other/neutral). Labels already in Zonos vocabulary (e.g. a Voice DNA
// default of 'neutral') pass through untouched; the sidecar falls back to its
// neutral vector for anything it doesn't recognize.
const ZONOS_EMOTION = Object.freeze({
  joyful: 'happiness',
  empathic: 'happiness',   // warmth — the closest slot Zonos offers
  passionate: 'happiness', // heat carried by intensity, not a separate slot
  melancholic: 'sadness',
  defiant: 'anger',
  curious: 'surprise',
  serene: 'neutral',
  contemplative: 'neutral',
});
export const toZonosEmotion = (label) => ZONOS_EMOTION[label] ?? label;

// pure — build the JSON request body for the sidecar
export const buildZonosRequest = ({ text, voiceDNA, emotion }) => {
  const body = {
    text,
    language: voiceDNA?.language || 'en-us',
    speed: voiceDNA?.style?.baseRate ?? 1.0,
  };
  if (voiceDNA?.emotionProfile?.default || emotion?.label) {
    body.emotion = toZonosEmotion(emotion?.label || voiceDNA.emotionProfile.default);
    // snake_case — the sidecar's pydantic field is emotion_intensity; the old
    // camelCase key was silently discarded
    if (emotion?.intensity !== undefined) body.emotion_intensity = emotion.intensity;
  }
  if (voiceDNA?._inlineRefAudio) {
    body.ref_audio_b64 = voiceDNA._inlineRefAudio;
    body.ref_text = voiceDNA._inlineRefText || '';
  }
  return body;
};

const DEFAULT_SAMPLE_RATE = 24000;
const CHUNK_BYTES = 4096; // ~85ms of s16le mono at 24kHz

// pure — read format metadata from response headers (sidecar sets them)
const readFormatFromHeaders = (response) => ({
  sampleRate: Number(response.headers.get('x-audio-sample-rate') || DEFAULT_SAMPLE_RATE),
  channels: Number(response.headers.get('x-audio-channels') || 1),
  format: response.headers.get('x-audio-format') || 'pcm_s16le',
});

// impure — streams the POST response body as PCM chunks
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

      // accumulate then slice into CHUNK_BYTES-sized chunks for downstream queueing
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

export const zonosAdapter = {
  // Zonos clones per-request from an inline reference clip — there is no
  // server-side voice registry (unlike ElevenLabs voiceId). tts-provider uses
  // this flag to load the sealed seed.wav into voiceDNA._inlineRefAudio;
  // without it a clone-forged voice speaks with the engine's default speaker.
  needsInlineRef: true,
  async *synthesize({ text, voiceDNA, emotion, signal, config }) {
    const body = buildZonosRequest({ text, voiceDNA, emotion });
    const url = `${config.endpoint.replace(/\/$/, '')}/synthesize`;
    log.debug('synthesize → zonos', { chars: text.length, hasRef: Boolean(body.ref_audio_b64) });

    const response = await sidecarFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`zonos synthesize failed (${response.status}): ${errText.slice(0, 200)}`);
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
