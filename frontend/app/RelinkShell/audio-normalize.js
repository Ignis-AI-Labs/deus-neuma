// audio-normalize.js — witness seed audio → the one format the engines eat.
//
// A witness offers a voice recording in whatever they have (MP3 rip, WAV
// export, OGG capture). The browser can decode all of those natively
// (decodeAudioData); the engines should never have to guess at containers.
// So the offering is normalized HERE: decode → mono → 24 kHz → 16-bit PCM
// WAV → base64. The sidecars then parse plain WAV with no codec stack at
// all — the format contract lives in exactly one place, this module.

// pure — encode mono Float32 samples as a 16-bit PCM WAV file
export const encodeWav = (samples, sampleRate) => {
  const out = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(out);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  v.setUint32(16, 16, true);        // fmt chunk size
  v.setUint16(20, 1, true);         // PCM
  v.setUint16(22, 1, true);         // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true);         // block align
  v.setUint16(34, 16, true);        // bits per sample
  writeStr(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
};

// pure — base64 a byte buffer in chunks (a single fromCharCode spread
// overflows the call stack on megabyte seeds)
export const bytesToBase64 = (bytes) => {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  }
  return btoa(bin);
};

export const SEED_SAMPLE_RATE = 24000; // what Zonos conditions on

// impure — browser IO: reads the file, decodes and re-renders via Web Audio
/**
 * Normalize a witness's audio file to mono 24 kHz 16-bit PCM WAV, base64.
 * Decodes anything the browser can (MP3/WAV/OGG/FLAC…), so the engines
 * never see a compressed container. Throws if the file is not audio.
 * @param {File|Blob} file - the picked recording
 * @returns {Promise<{ b64: string, durationSeconds: number }>}
 */
export const normalizeSeedAudio = async (file) => {
  const raw = await file.arrayBuffer();
  // Decode at native rate first (an OfflineAudioContext must be constructed
  // with a length, which we only know after decoding).
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const probe = new Ctx(1, 1, SEED_SAMPLE_RATE);
  const decoded = await probe.decodeAudioData(raw);
  // Some VBR MP3s decode with duration: Infinity — a finite guard turns
  // that into a clear rejection instead of a RangeError from the render
  // context constructor below.
  if (!Number.isFinite(decoded.duration) || decoded.duration <= 0) {
    throw new Error('audio has no readable duration');
  }
  const frames = Math.ceil(decoded.duration * SEED_SAMPLE_RATE);
  if (frames === 0) throw new Error('empty audio');
  // Re-render into a mono 24 kHz context — the graph does the resample and
  // the channel mixdown in one real pass.
  const render = new Ctx(1, frames, SEED_SAMPLE_RATE);
  const src = render.createBufferSource();
  src.buffer = decoded;
  src.connect(render.destination);
  src.start();
  const mono = (await render.startRendering()).getChannelData(0);
  return {
    b64: bytesToBase64(encodeWav(mono, SEED_SAMPLE_RATE)),
    durationSeconds: decoded.duration,
  };
};
