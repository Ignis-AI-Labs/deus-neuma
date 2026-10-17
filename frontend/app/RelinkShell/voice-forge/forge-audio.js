// forge-audio.js — the RECORD door's sample math. Pure.
//
// The recorder (use-forge-recorder.js) captures through the ONE mic worklet
// (voice-mic-worklet.js — the same AudioWorklet pump the live voice sitting
// uses) at the context's native rate. Here: the live level for the meter, the
// chunks joined, and the WAV the forge's record door receives. The backend
// trims to the best 10–30 s of speech and resamples (forge-doors.js), so the
// browser sends what the mic heard, untouched.

import { bytesToBase64, floatToS16le } from '../voice-mic-worklet.js';

// Talk about this long: the forge keeps the best 10–30 s of speech.
export const RECORD_TARGET_SECONDS = 20;
// A recording stops by itself here so a forgotten mic never runs on.
export const RECORD_MAX_SECONDS = 45;
// The meter's floor: quieter than this reads as silence.
const METER_FLOOR_DB = -60;

/**
 * The level of a chunk for the meter, 0 (silence) to 1 (full scale), on a
 * decibel scale so speech moves the bar the way the ear hears it. Pure.
 * @param {Float32Array} samples
 */
export const meterLevelOf = (samples) => {
  if (!samples?.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / samples.length);
  if (rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  return Math.max(0, Math.min(1, (db - METER_FLOOR_DB) / -METER_FLOOR_DB));
};

/**
 * Join captured chunks into one buffer. Pure.
 * @param {Float32Array[]} chunks
 */
export const joinChunks = (chunks) => {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
};

/**
 * Mono Float32 samples as a 16-bit PCM WAV file. Pure.
 * @param {Float32Array} samples
 * @param {number} sampleRate
 * @returns {Uint8Array}
 */
export const wavOf = (samples, sampleRate) => {
  const pcm = floatToS16le(samples);
  const out = new Uint8Array(44 + pcm.length);
  const v = new DataView(out.buffer);
  const ascii = (offset, s) => { for (let i = 0; i < s.length; i++) out[offset + i] = s.charCodeAt(i); };
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + pcm.length, true);
  ascii(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  ascii(36, 'data');
  v.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
};

/**
 * A finished recording as the record door's body field. Pure.
 * @param {Float32Array[]} chunks
 * @param {number} sampleRate
 * @returns {{audioB64: string, seconds: number}}
 */
export const recordingOf = (chunks, sampleRate) => {
  const samples = joinChunks(chunks);
  return { audioB64: bytesToBase64(wavOf(samples, sampleRate)), seconds: samples.length / sampleRate };
};
