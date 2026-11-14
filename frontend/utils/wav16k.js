// wav16k — recorded speech as 16 kHz mono 16-bit WAV, the one format the processor speech engine
// reads (whisper.cpp has no decoder of its own; backend/routes/stt-routes.js answers STT_WANTS_WAV).

/**
 * Mono samples (-1..1) as a 16-bit PCM WAV file. Pure.
 * @param {Float32Array} samples
 * @param {number} [rate]
 * @returns {ArrayBuffer}
 */
export const encodeWav16 = (samples, rate = 16000) => {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const text = (at, s) => { for (let i = 0; i < s.length; i += 1) v.setUint8(at + i, s.charCodeAt(i)); };
  text(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE');
  text(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  text(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
};

/** Every channel averaged into one. Pure. @param {Float32Array[]} channels */
export const mixDown = (channels) => {
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (const ch of channels) for (let i = 0; i < out.length; i += 1) out[i] += ch[i] / channels.length;
  return out;
};

/**
 * A recorded blob (webm, ogg, wav…) as 16 kHz mono WAV: the browser decodes it and resamples on the
 * way in (an OfflineAudioContext at 16 kHz). impure (Web Audio)
 * @param {Blob} blob
 * @returns {Promise<Blob>}
 */
export const toWav16k = async (blob) => {
  const ctx = new OfflineAudioContext(1, 1, 16000);
  const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
  const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
  return new Blob([encodeWav16(mixDown(channels), audio.sampleRate)], { type: 'audio/wav' });
};
