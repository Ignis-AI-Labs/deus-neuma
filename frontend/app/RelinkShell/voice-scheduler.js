// voice-scheduler.js — the shared decode + playback-schedule core for streamed
// voice audio.
//
// Extracted from voice-sink.js so a second producer (the forge streaming
// preview in voice-client.js) schedules raw PCM chunks through the same Web
// Audio pipeline the chat voice uses: raw/encoded decode, and gapless
// back-to-back scheduling through a single ordered promise chain. voice-sink.js
// keeps the WS-frame concerns (frame shape, base64 payloads); this module owns
// the audio core both producers share.
//
// Ordering: chunks are processed through a single promise chain, so even an
// encoded chunk that decodes asynchronously can never overtake an earlier one.
//
// impure — owns an AudioContext and schedules playback. The context factory is
// injectable so the scheduling logic can be unit-tested without real Web Audio.

// pure — decode a base64 string to bytes. Empty/invalid → empty.
export const base64ToBytes = (b64) => {
  if (typeof b64 !== 'string' || b64.length === 0) return new Uint8Array(0);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

// pure — make one Float32Array per channel.
const makeChannels = (channels, frames) =>
  Array.from({ length: channels }, () => new Float32Array(frames));

// pure — deinterleave raw PCM bytes into per-channel Float32 in [-1, 1].
// Supports pcm_s16le (the local-engine default) and pcm_f32le. Bytes that do
// not divide evenly are truncated to whole frames.
export const pcmToFloat32Channels = (bytes, channels = 1, format = 'pcm_s16le') => {
  const ch = Math.max(1, channels | 0);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (format === 'pcm_f32le') {
    const frames = Math.floor(bytes.byteLength / 4 / ch);
    const out = makeChannels(ch, frames);
    for (let f = 0; f < frames; f++)
      for (let c = 0; c < ch; c++)
        out[c][f] = view.getFloat32((f * ch + c) * 4, true);
    return out;
  }
  // default: pcm_s16le
  const frames = Math.floor(bytes.byteLength / 2 / ch);
  const out = makeChannels(ch, frames);
  for (let f = 0; f < frames; f++)
    for (let c = 0; c < ch; c++)
      out[c][f] = view.getInt16((f * ch + c) * 2, true) / 32768;
  return out;
};

// The formats decoded by hand into Float32 channels; anything else (wav/mp3/
// opus from a cloud engine) falls through to the browser's decodeAudioData.
export const RAW_FORMATS = new Set(['pcm_s16le', 'pcm_f32le']);

/**
 * Create a voice scheduler.
 *
 * @param {Object} [opts]
 * @param {() => AudioContext} [opts.createContext] - context factory (tests inject a fake)
 * @param {boolean} [opts.enabled=true] - start enabled
 * @returns {{
 *   pushChunk: (bytes: Uint8Array, meta?: Object) => void,
 *   interrupt: () => void,
 *   resume: () => void,
 *   setEnabled: (on: boolean) => boolean,
 *   isEnabled: () => boolean,
 *   isSupported: () => boolean,
 *   idle: () => Promise<void>,
 *   dispose: () => void,
 * }}
 */
export const createVoiceScheduler = ({ createContext, enabled = true } = {}) => {
  const makeCtx = createContext
    || (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)
      ? () => new (window.AudioContext || window.webkitAudioContext)()
      : null);
  const supported = !!makeCtx;

  let ctx = null;
  let nextStartTime = 0;        // the Web Audio timestamp the next buffer starts at
  let chain = Promise.resolve(); // ordered decode+schedule queue
  let on = !!enabled;
  const active = new Set();      // live BufferSources, so we can cut them off

  const ensureCtx = () => {
    if (ctx) return ctx;
    ctx = makeCtx();
    nextStartTime = ctx.currentTime || 0;
    return ctx;
  };

  // impure — stop everything sounding now and re-baseline the cursor.
  const stopAll = () => {
    for (const src of active) {
      try { src.stop(); } catch { /* already ended */ }
    }
    active.clear();
    if (ctx) nextStartTime = ctx.currentTime || 0;
  };

  // impure — turn chunk bytes into an AudioBuffer (null if it yields no audio).
  const decodeChunk = async (bytes, meta) => {
    const format = (meta.format || 'pcm_s16le').toLowerCase();
    const sampleRate = meta.sampleRate || 24000;
    const channels = Math.max(1, (meta.channels | 0) || 1);
    if (RAW_FORMATS.has(format)) {
      const data = pcmToFloat32Channels(bytes, channels, format);
      const frames = data[0] ? data[0].length : 0;
      if (frames === 0) return null;
      const buf = ctx.createBuffer(channels, frames, sampleRate);
      for (let c = 0; c < channels; c++) buf.copyToChannel(data[c], c);
      return buf;
    }
    // Encoded (wav/mp3/opus, e.g. a cloud engine) — hand to the browser
    // decoder. Copy to a fresh ArrayBuffer; decodeAudioData detaches its input.
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return ctx.decodeAudioData(ab);
  };

  // impure — schedule a decoded buffer gaplessly after whatever is already queued.
  const schedule = (buffer) => {
    if (!on || !buffer) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime || 0, nextStartTime);
    src.start(startAt);
    nextStartTime = startAt + buffer.duration;
    active.add(src);
    src.onended = () => active.delete(src);
  };

  return {
    // Queue raw audio bytes ({format, sampleRate, channels}) for in-order playback.
    pushChunk(bytes, meta = {}) {
      if (!supported || !on || !bytes || bytes.byteLength === 0) return;
      ensureCtx();
      chain = chain.then(async () => {
        if (!on) return;                 // re-check: the witness may have muted mid-turn
        schedule(await decodeChunk(bytes, meta));
      }).catch((err) => {
        // A single bad chunk must never wedge the queue.
        console.warn('[voice-scheduler] chunk dropped:', err?.message || err);
      });
    },

    // Cut off anything currently speaking — used for barge-in when the witness
    // sends a new message before the neuma finishes.
    interrupt() { stopAll(); },

    // Resume the context on a user gesture (autoplay policy). Audio only
    // arrives after the witness acts, so this is always gesture-backed.
    resume() {
      if (!supported || !on) return;
      try {
        ensureCtx();
        if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      } catch { /* best effort */ }
    },

    setEnabled(next) {
      on = !!next;
      if (!on) stopAll();
      return on;
    },
    isEnabled() { return on; },
    isSupported() { return supported; },

    // Resolves when the queued chunks have finished decoding + scheduling (NOT
    // when they finish playing). For graceful teardown and deterministic tests.
    idle() { return chain; },

    dispose() {
      // Terminal: nothing queued after dispose may ever sound (a stream that
      // outlives its teardown must not resurrect the context).
      on = false;
      stopAll();
      if (ctx) {
        try { if (ctx.close) ctx.close(); } catch { /* best effort */ }
        ctx = null;
      }
      chain = Promise.resolve();
    },
  };
};
