/**
 * voice-mic-worklet.js — the pure PCM pipeline behind the streaming mic lane
 * (SPEECH SYSTEM, F-01). No DOM, no AudioContext: the worklet source string
 * is asserted as text, and every decision (downsample math, 100 ms framing,
 * s16le packing, base64) runs on real sample arrays.
 *
 * The NEVER-ZERO-FILL law is pinned explicitly: a partial frame is HELD, not
 * padded — the portal's replay defence dedupes byte-identical frames, and
 * fabricated silence would lie about what the mic heard.
 */

import { describe, expect, test } from 'vitest';
import { readFileSync } from 'fs';
import {
  PCM_FRAME_SAMPLES, PCM_SAMPLE_RATE, WORKLET_NAME,
  downsampleTo16k, floatToS16le, createPcmFramer, bytesToBase64,
} from '../../frontend/app/RelinkShell/voice-mic-worklet.js';

// The processor is a REAL asset now, not a string constant — so read the real
// file. It cannot be imported: AudioWorkletProcessor/registerProcessor exist
// only in a worklet's global scope, and importing it here would throw.
const PROCESSOR_PATH = 'frontend/app/RelinkShell/voice-mic-worklet-processor.js';
const processorSource = readFileSync(PROCESSOR_PATH, 'utf8');

const constant = (value, n) => new Float32Array(n).fill(value);

describe('voice-mic-worklet — the pure PCM pipeline', () => {
  test('the frame contract: 100 ms at 16 kHz is 1600 samples / 3200 bytes', () => {
    expect(PCM_SAMPLE_RATE).toBe(16000);
    expect(PCM_FRAME_SAMPLES).toBe(1600); // the portal's paced cadence (test fixture: 3200-byte chunks)
    expect(floatToS16le(constant(0, PCM_FRAME_SAMPLES)).byteLength).toBe(3200);
  });

  test('the worklet asset registers the agreed processor and posts no padding', () => {
    expect(processorSource).toContain(`registerProcessor('${WORKLET_NAME}'`);
    expect(processorSource).toContain('AudioWorkletProcessor');
    // Real samples only: the buffer is sized to exactly the chunk and only
    // full chunks are posted — no fill(0), no zero-padding path.
    expect(processorSource).not.toContain('fill(0');
  });

  // THE REGRESSION THIS EXISTS FOR (2026-08-01): the processor was handed to
  // addModule() as a `blob:` URL. The desk's CSP carries `script-src 'self'`
  // and an AudioWorklet module IS a script, so Chromium refused it with
  // `AbortError: The user aborted a request` — the mic opened for an instant,
  // the catch tore it down, voice:mic_open never went out, and a voice sitting
  // listened to nothing. It must stay a same-origin ASSET, so that the CSP's
  // most important directive never has to be widened to blob:.
  test('the worklet loads as a same-origin asset, never a blob: script', async () => {
    const pageSource = readFileSync('frontend/app/RelinkShell/voice-mic-worklet.js', 'utf8');
    expect(pageSource).not.toContain('createObjectURL');
    expect(pageSource).toContain("./voice-mic-worklet-processor.js?url");

    // And the CSP that made this necessary still forbids blob: scripts — if
    // that ever changes this test should be revisited, not silently passed.
    const { CSP_DIRECTIVES } = await import('../../backend/services/security-headers.js');
    // (INFRA-012, df038f100, admitted ONE exact inline first-paint script by
    // its sha256 — a hash admits those bytes only, never blob: or data:)
    const scriptSrc = CSP_DIRECTIVES.find((d) => d.startsWith('script-src'));
    expect(scriptSrc.split(/\s+/).slice(1).every((s) => s === "'self'" || /^'sha256-[A-Za-z0-9+/=]+'$/.test(s))).toBe(true);
    expect(scriptSrc).not.toMatch(/blob:|data:|unsafe-inline|unsafe-eval/);

    // THE THIRD LEG: `?url` alone is not enough. Vite inlines assets under
    // 4 KB as `data:` URLs, and a data: script is refused by that same
    // directive — the first attempt at this fix built green and would have
    // failed identically in Founder's hands. The build must force this one asset
    // out to a real file.
    const viteConfig = readFileSync('vite.config.js', 'utf8');
    expect(viteConfig).toContain('assetsInlineLimit');
    expect(viteConfig).toContain('voice-mic-worklet-processor');
  });

  test('downsampleTo16k: 48 kHz → 16 kHz is a clean 3:1 box average', () => {
    // 90 native samples → 30 output samples; each output is the mean of its 3.
    const native = new Float32Array(90);
    for (let i = 0; i < 90; i++) native[i] = i % 3 === 0 ? 0.9 : 0;
    const out = downsampleTo16k(native, 48000);
    expect(out.length).toBe(30);
    expect(out[0]).toBeCloseTo(0.3, 6); // (0.9 + 0 + 0) / 3
    expect(out[29]).toBeCloseTo(0.3, 6);
  });

  test('downsampleTo16k: 16 kHz input passes through (a copy, not the same array)', () => {
    const input = constant(0.5, 100);
    const out = downsampleTo16k(input, 16000);
    expect(out).not.toBe(input);
    expect(Array.from(out)).toEqual(Array.from(input));
    expect(downsampleTo16k(new Float32Array(0), 48000).length).toBe(0);
  });

  test('downsampleTo16k: 44.1 kHz honors the true ratio (no drift assumption)', () => {
    const out = downsampleTo16k(constant(1, 4410), 44100);
    expect(out.length).toBe(1600); // exactly one 100 ms frame from 100 ms of audio
    expect(out[0]).toBeCloseTo(1, 6);
  });

  test('floatToS16le packs little-endian and clamps instead of wrapping', () => {
    const bytes = floatToS16le(new Float32Array([0, 1, -1, 2, -2]));
    const view = new DataView(bytes.buffer);
    expect(view.getInt16(0, true)).toBe(0);
    expect(view.getInt16(2, true)).toBe(32767);   // full-scale positive
    expect(view.getInt16(4, true)).toBe(-32768);  // full-scale negative
    expect(view.getInt16(6, true)).toBe(32767);   // hot signal clamps high
    expect(view.getInt16(8, true)).toBe(-32768);  // hot signal clamps low
  });

  test('the framer emits only COMPLETE 100 ms frames and holds the rest (never zero-fills)', () => {
    const framer = createPcmFramer();
    // 1599 samples: nothing may leave — a padded frame would be invented silence.
    expect(framer.push(constant(0.1, PCM_FRAME_SAMPLES - 1))).toEqual([]);
    expect(framer.pendingCount()).toBe(PCM_FRAME_SAMPLES - 1);
    // One more sample completes exactly one frame.
    const frames = framer.push(constant(0.2, 1));
    expect(frames).toHaveLength(1);
    expect(frames[0].length).toBe(PCM_FRAME_SAMPLES);
    expect(frames[0][0]).toBeCloseTo(0.1, 6); // the held samples lead the frame
    expect(frames[0][PCM_FRAME_SAMPLES - 1]).toBeCloseTo(0.2, 6);
    expect(framer.pendingCount()).toBe(0);
  });

  test('the framer splits oversized chunks into whole frames in order', () => {
    const framer = createPcmFramer();
    const frames = framer.push(constant(0.5, PCM_FRAME_SAMPLES * 2 + 400));
    expect(frames).toHaveLength(2);
    expect(framer.pendingCount()).toBe(400);
    // The held tail joins the next push's frame BEFORE its newer samples.
    const [next] = framer.push(constant(0.7, PCM_FRAME_SAMPLES - 400));
    expect(next.length).toBe(PCM_FRAME_SAMPLES);
    expect(next[0]).toBeCloseTo(0.5, 6);
    expect(next[PCM_FRAME_SAMPLES - 1]).toBeCloseTo(0.7, 6);
    expect(framer.push(null)).toEqual([]);
  });

  test('bytesToBase64 round-trips real s16le bytes through the wire shape', () => {
    const bytes = floatToS16le(new Float32Array([0.25, -0.5, 0.999]));
    const b64 = bytesToBase64(bytes);
    expect(typeof b64).toBe('string');
    // The portal decodes with Buffer.from(pcm, 'base64') — prove the exact inverse.
    const back = Buffer.from(b64, 'base64');
    expect(Buffer.compare(back, Buffer.from(bytes))).toBe(0);
  });

  test('cadence math: one second of 48 kHz mic yields ten 3200-byte wire frames', () => {
    const framer = createPcmFramer();
    // Ten worklet chunks of 100 ms at 48 kHz (4800 samples each).
    let wireFrames = [];
    for (let i = 0; i < 10; i++) {
      wireFrames = wireFrames.concat(framer.push(downsampleTo16k(constant(0.01, 4800), 48000)));
    }
    expect(wireFrames).toHaveLength(10);
    for (const f of wireFrames) expect(floatToS16le(f).byteLength).toBe(3200);
    expect(framer.pendingCount()).toBe(0);
  });
});
