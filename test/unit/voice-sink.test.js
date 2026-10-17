/* global btoa */
// Pure PCM conversion; actual browser scheduling lives in voice-sink-browser.test.js.
import { describe, test, expect } from 'vitest';
import { base64ToBytes, pcmToFloat32Channels } from '../../frontend/app/RelinkShell/voice-sink.js';

describe('voice-sink pure helpers', () => {
  test('base64ToBytes round-trips and tolerates empty/garbage', () => {
    const bytes = new Uint8Array([0, 127, 255, 64]);
    const b64 = btoa(String.fromCharCode(...bytes));
    expect(Array.from(base64ToBytes(b64))).toEqual([0, 127, 255, 64]);
    expect(base64ToBytes('').byteLength).toBe(0);
    expect(base64ToBytes(null).byteLength).toBe(0);
  });

  test('pcmToFloat32Channels (s16le) maps the full range into [-1, 1]', () => {
    const buf = new ArrayBuffer(6);
    const dv = new DataView(buf);
    dv.setInt16(0, 0, true);
    dv.setInt16(2, 32767, true);
    dv.setInt16(4, -32768, true);
    const [mono] = pcmToFloat32Channels(new Uint8Array(buf), 1, 'pcm_s16le');
    expect(mono.length).toBe(3);
    expect(mono[0]).toBe(0);
    expect(mono[1]).toBeCloseTo(0.99997, 4);
    expect(mono[2]).toBe(-1);
  });

  test('pcmToFloat32Channels deinterleaves stereo', () => {
    const buf = new ArrayBuffer(8); // 2 frames x 2 channels x 2 bytes
    const dv = new DataView(buf);
    dv.setInt16(0, 32767, true);  // f0 L
    dv.setInt16(2, -32768, true); // f0 R
    dv.setInt16(4, 32767, true);  // f1 L
    dv.setInt16(6, -32768, true); // f1 R
    const [left, right] = pcmToFloat32Channels(new Uint8Array(buf), 2, 'pcm_s16le');
    expect(left[0]).toBeCloseTo(1, 3);
    expect(left[1]).toBeCloseTo(1, 3);
    expect(right[0]).toBe(-1);
    expect(right[1]).toBe(-1);
  });

  test('pcmToFloat32Channels (f32le) passes samples through', () => {
    const buf = new ArrayBuffer(8);
    const dv = new DataView(buf);
    dv.setFloat32(0, 0.5, true);
    dv.setFloat32(4, -0.25, true);
    const [mono] = pcmToFloat32Channels(new Uint8Array(buf), 1, 'pcm_f32le');
    expect(mono[0]).toBeCloseTo(0.5, 6);
    expect(mono[1]).toBeCloseTo(-0.25, 6);
  });
});
