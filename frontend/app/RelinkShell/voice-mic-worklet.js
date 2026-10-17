// voice-mic-worklet.js — the AudioWorklet PCM pump for a live voice sitting
// (THE SPEECH SYSTEM, Phase A / F-01).
//
// The worklet itself is deliberately dumb: it accumulates raw captured
// samples at the AudioContext's native rate and posts ~100 ms Float32 chunks
// to the page. Everything with a decision in it — downsampling to 16 kHz,
// framing to 1600-sample (100 ms) frames, s16le packing, base64 — lives in
// the pure page-side functions below, where the suite can prove it without
// a browser.
//
// NEVER zero-fill: a partial frame is HELD, not padded (the portal's replay
// defence dedupes byte-identical frames, and fabricated silence is a lie
// about what the mic heard). Real mic noise flows; invented bytes never do.
//
// Echo discipline is upstream and unchanged: getUserMedia with AEC+NS+AGC
// (use-live-voice.js) is the only echo control in this path.

// The processor ships as a real same-origin ASSET. `?url` is the explicit
// form: a bare `new URL('./x.js', import.meta.url)` gets resolved as a MODULE
// by the bundler and no asset is emitted at all (verified — dist carried no
// worklet file). This emits the file and hands back its served path.
import workletAssetUrl from './voice-mic-worklet-processor.js?url';

/** Samples per emitted PCM frame: 100 ms at 16 kHz — the portal's cadence. */
export const PCM_FRAME_SAMPLES = 1600;

/** The wire rate the whisper sidecar's /stream lane expects. */
export const PCM_SAMPLE_RATE = 16000;

/**
 * The registered processor name. The processor lives in its own asset file
 * (voice-mic-worklet-processor.js) and repeats this literal, because a
 * worklet's global scope cannot import from the page — voice-mic-worklet.test.js
 * asserts the two still agree.
 */
export const WORKLET_NAME = 'neuma-pcm-pump';


/**
 * Downsample a Float32 chunk to 16 kHz with a box average over each output
 * window (adequate for the speech band, and honest — no invented content).
 * Passthrough (a copy) when the source is already 16 kHz. Pure.
 * @param {Float32Array} samples - captured samples at inputRate
 * @param {number} inputRate - the AudioContext's native rate
 * @returns {Float32Array} samples at 16 kHz
 */
export const downsampleTo16k = (samples, inputRate) => {
  if (!samples || samples.length === 0) return new Float32Array(0);
  if (inputRate === PCM_SAMPLE_RATE) return samples.slice();
  const ratio = inputRate / PCM_SAMPLE_RATE;
  const outLength = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j];
    out[i] = sum / (end - start);
  }
  return out;
};

/**
 * Pack Float32 samples in [-1, 1] into little-endian 16-bit PCM bytes.
 * Out-of-range samples clamp — a hot mic distorts, it never wraps. Pure.
 * @param {Float32Array} samples
 * @returns {Uint8Array} 2 bytes per sample, s16le
 */
export const floatToS16le = (samples) => {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
};

/**
 * A frame accumulator: push 16 kHz samples, get back only COMPLETE
 * 100 ms frames; the remainder is held for the next push. Stateful but
 * side-effect-free (tool-stream-filter precedent) — same inputs, same frames.
 * @param {number} [frameSamples] - samples per frame (default: 100 ms @ 16 kHz)
 * @returns {{ push: (samples: Float32Array) => Float32Array[], pendingCount: () => number }}
 */
export const createPcmFramer = (frameSamples = PCM_FRAME_SAMPLES) => {
  let pending = new Float32Array(0);
  return {
    push(samples) {
      if (!samples || samples.length === 0) return [];
      const merged = new Float32Array(pending.length + samples.length);
      merged.set(pending);
      merged.set(samples, pending.length);
      const frames = [];
      let offset = 0;
      while (merged.length - offset >= frameSamples) {
        frames.push(merged.slice(offset, offset + frameSamples));
        offset += frameSamples;
      }
      pending = merged.slice(offset);
      return frames;
    },
    pendingCount: () => pending.length,
  };
};

/**
 * Base64-encode bytes for the voice:mic_pcm JSON frame. Chunked so large
 * buffers never hit argument limits. Pure (btoa is a deterministic builtin).
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export const bytesToBase64 = (bytes) => {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
};

/**
 * The worklet module's URL — a REAL same-origin asset, emitted by the bundler
 * from the `new URL(..., import.meta.url)` reference below.
 *
 * This returned a `blob:` URL until 2026-08-01, and the desk's CSP
 * (`script-src 'self'`, security-headers.js) refuses blob: scripts — an
 * AudioWorklet module IS a script. Chromium answered every addModule with
 * `AbortError: The user aborted a request`, use-live-voice.js caught it and
 * tore the mic down, so a voice sitting opened the mic for an instant, closed
 * it, and sat there listening to nothing. Proven against the real desk origin.
 *
 * Same-origin keeps `script-src 'self'` intact — the alternative fix was to
 * allow blob: scripts, loosening the one directive that matters most.
 *
 * Browser-only by construction; the bundler emits the file and rewrites the
 * import to its served path at build time, and serves it directly in dev.
 * @returns {string}
 */
export const createWorkletUrl = () => workletAssetUrl;
