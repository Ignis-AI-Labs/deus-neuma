// voice-client.js — voice-layer helpers kept from the retired forge desk client.
//
// The desk's forge REST calls live in voice-forge/forge-client.js. What stays
// here has no equivalent on the live voice path yet: reading a raw-PCM HTTP
// body into a voice scheduler while it streams, wrapping raw PCM as WAV, and
// the voice designer's seed bounds and batch-wait estimate.

import { createVoiceScheduler } from './voice-scheduler.js';

// pure — the audio metadata a raw-PCM response carries in X-Audio-* headers
// (the local engine sidecars' contract, read server-side by
// backend/services/voice/providers/_pcm-stream.js).
const previewMeta = (res) => ({
  format: res.headers.get('x-audio-format') || 'pcm_s16le',
  sampleRate: Number(res.headers.get('x-audio-sample-rate') || 24000),
  channels: Number(res.headers.get('x-audio-channels') || 1),
  contentType: res.headers.get('content-type') || 'audio/raw',
});

// --- Design mode (qwen3 VoiceDesign) — the designer sidecar's contract ---

// pure — the qwen3 sidecar's measured batch cost for design generation
// (wave-1 sidecar contract: design TTFB ≈ 0.0485 s/char, rounded up to 0.05).
// Batch, not streaming: first audio lands only after the full render.
export const DESIGN_WAIT_SECONDS_PER_CHAR = 0.05;

// pure — honest wait estimate in whole seconds (ceil, floor 1) for a design
// preview of `chars` characters. The label this feeds must never promise an
// instant first frame.
export const estimateDesignWait = (chars) =>
  Math.max(1, Math.ceil(Math.max(0, Number(chars) || 0) * DESIGN_WAIT_SECONDS_PER_CHAR));

// pure — design seed bounds from the sidecar contract: integer 0..2³¹−1.
export const DESIGN_SEED_MAX = 2 ** 31 - 1;

// pure — normalize any input into a valid design seed.
export const normalizeDesignSeed = (seed) => {
  const n = Math.floor(Number(seed));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, DESIGN_SEED_MAX);
};

// pure — REROLL bump: the next seed, wrapping at the contract bound.
export const bumpDesignSeed = (seed) => (normalizeDesignSeed(seed) + 1) % (DESIGN_SEED_MAX + 1);

// impure — read a raw-PCM preview stream: whole sample frames are scheduled
// as they arrive (first audio starts while the body is still streaming) and
// every byte accumulates into the returned take. Bytes are carried across
// reads until they fill a whole frame, so a sample the transport splits is
// never played torn; a trailing partial frame stays in the take but is not
// scheduled (the same truncation pcmToFloat32Channels applies).
export const readPcmStream = async (body, { format, sampleRate, channels, scheduler }) => {
  if (!body || typeof body.getReader !== 'function') throw new Error('preview stream unreadable');
  const frameBytes = ((format || '').toLowerCase() === 'pcm_f32le' ? 4 : 2) * Math.max(1, (channels | 0) || 1);
  const meta = { format, sampleRate, channels };
  const reader = body.getReader();
  const chunks = [];
  let carry = new Uint8Array(0);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.byteLength === 0) continue;
    chunks.push(value);
    const merged = new Uint8Array(carry.length + value.length);
    merged.set(carry, 0);
    merged.set(value, carry.length);
    const whole = merged.length - (merged.length % frameBytes);
    if (whole > 0 && scheduler) scheduler.pushChunk(merged.subarray(0, whole), meta);
    carry = merged.slice(whole);
  }
  if (scheduler) await scheduler.idle();
  const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let off = 0;
  for (const c of chunks) { bytes.set(c, off); off += c.length; }
  return bytes;
};

// impure — branch a preview Response by content-type. Cloud mp3 honestly keeps
// the whole-take blob path (NFR-6: decodeAudioData / the <audio> element
// handles mp3 — it is never fake-streamed as PCM); raw PCM streams into a
// voice scheduler while the body is still arriving.
export const readPreviewResponse = async (res, { createContext, onScheduler, shouldAbort } = {}) => {
  const meta = previewMeta(res);
  if (meta.contentType.includes('mpeg') || meta.contentType.includes('mp3') || !res.body) {
    const blob = await res.blob();
    return { blob, ...meta, streamed: false, scheduler: null };
  }
  const scheduler = createVoiceScheduler({ createContext });
  if (shouldAbort?.()) {
    // Cancel landed before publish — dispose terminally so the draining body
    // never sounds a single chunk from this take.
    scheduler.dispose();
  } else {
    // Gesture-backed: every preview starts from a click, so resume immediately.
    // And publish the scheduler BEFORE the first chunk lands — a cancel/
    // teardown mid-stream must be able to interrupt the audio that is
    // actually sounding, not wait for the body to drain.
    scheduler.resume();
    if (onScheduler) onScheduler(scheduler);
  }
  const pcmBytes = await readPcmStream(res.body, { ...meta, scheduler });
  // `streamed` means actually heard live: unsupported Web Audio falls back to
  // whole-take playback (the player autoplays, exactly like the mp3 path).
  return { blob: new Blob([pcmBytes], { type: meta.contentType }), ...meta, streamed: scheduler.isSupported(), scheduler };
};

// pure — wrap raw PCM bytes in a WAV container so <audio> can play it.
// Mirrors the test-harness wrapping. Returns a Blob (audio/wav).
export const pcmToWavBlob = (pcmBytes, { sampleRate = 24000, channels = 1, bytesPerSample = 2 }) => {
  const dataLen = pcmBytes.byteLength;
  const buffer = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buffer);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataLen, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);                                 // fmt sub-chunk size (4-byte field)
  view.setUint16(20, 1, true);                                  // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeStr(36, 'data');
  view.setUint32(40, dataLen, true);
  new Uint8Array(buffer, 44).set(new Uint8Array(pcmBytes));
  return new Blob([view], { type: 'audio/wav' });
};
