/**
 * Seed-audio normalization (audio-normalize.js) — pure parts, real math.
 * The full browser path (decodeAudioData/OfflineAudioContext) is exercised
 * in test/e2e/voice-forge.spec.js CLONE mode; the encoded WAV's parseability
 * by the actual zonos sidecar parser is part of that same run.
 */

import { describe, test, expect } from 'vitest';
import { encodeWav, bytesToBase64, SEED_SAMPLE_RATE } from '../../frontend/app/RelinkShell/audio-normalize.js';

const readStr = (v, off, len) =>
  String.fromCharCode(...Array.from({ length: len }, (_, i) => v.getUint8(off + i)));

describe('encodeWav — 16-bit PCM mono WAV layout', () => {
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 2, -2]); // incl. clipping inputs
  const buf = encodeWav(samples, SEED_SAMPLE_RATE);
  const v = new DataView(buf);

  test('the header is a standards-correct RIFF/WAVE fmt+data pair', () => {
    expect(readStr(v, 0, 4)).toBe('RIFF');
    expect(readStr(v, 8, 4)).toBe('WAVE');
    expect(readStr(v, 12, 4)).toBe('fmt ');
    expect(v.getUint32(16, true)).toBe(16);       // PCM fmt chunk
    expect(v.getUint16(20, true)).toBe(1);        // linear PCM
    expect(v.getUint16(22, true)).toBe(1);        // mono
    expect(v.getUint32(24, true)).toBe(SEED_SAMPLE_RATE);
    expect(v.getUint16(34, true)).toBe(16);       // bits per sample
    expect(readStr(v, 36, 4)).toBe('data');
    expect(v.getUint32(40, true)).toBe(samples.length * 2);
    expect(v.getUint32(4, true)).toBe(buf.byteLength - 8);
  });

  test('samples round-trip as int16, out-of-range input clips instead of wrapping', () => {
    const out = Array.from({ length: samples.length }, (_, i) => v.getInt16(44 + i * 2, true));
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(Math.trunc(0.5 * 0x7fff));  // setInt16 truncates toward zero
    expect(out[2]).toBe(-0.5 * 0x8000);             // exact: -16384
    expect(out[3]).toBe(0x7fff);   // 1 → full scale
    expect(out[4]).toBe(-0x8000);  // -1 → full scale
    expect(out[5]).toBe(0x7fff);   // 2 clips, does not wrap negative
    expect(out[6]).toBe(-0x8000);  // -2 clips, does not wrap positive
  });
});

describe('bytesToBase64 — chunked, megabyte-safe', () => {
  test('matches the reference encoding on a seed-sized buffer', () => {
    const big = new Uint8Array(3 * 1024 * 1024);
    for (let i = 0; i < big.length; i++) big[i] = i % 251;
    // A single String.fromCharCode(...big) would overflow the call stack —
    // this proves the chunked path both survives and encodes correctly.
    expect(bytesToBase64(big)).toBe(Buffer.from(big).toString('base64'));
  });

  test('empty input → empty string', () => {
    expect(bytesToBase64(new Uint8Array(0))).toBe('');
  });
});
