// voice-sink playback level tap (F-04) — the being's voice as numbers. Real
// PCM frames through the REAL pushAudio path; Web Audio is injected as the
// established fake-context boundary (voice-sink.test.js precedent — the
// claimed path is the tap's measurement logic, all real code). No mock
// stands in for anything whose behavior is claimed.

import { describe, test, expect } from 'vitest';
import {
  createVoiceSink, base64ToBytes,
  chunkRms, decayedLevel, PLAYBACK_ACTIVITY_MS,
} from '../../frontend/app/RelinkShell/voice-sink.js';

// A fake AudioContext at the hardware boundary (same shape as voice-sink.test.js).
const makeFakeCtx = () => {
  const ctx = {
    state: 'running',
    currentTime: 0,
    destination: {},
    resume: () => Promise.resolve(),
    close: () => Promise.resolve(),
    createBuffer: (channels, length, sampleRate) => ({
      numberOfChannels: channels, length, sampleRate,
      duration: length / sampleRate,
      copyToChannel() {},
    }),
    createBufferSource: () => ({ connect() {}, start() {}, stop() {}, onended: null, buffer: null }),
    decodeAudioData: async () => ({ duration: 1 }),
  };
  return ctx;
};

// A mono pcm_s16le frame of `samples` samples all at amplitude `amp`.
const steadyFrame = (amp, samples = 64, { sampleRate = 24000, format = 'pcm_s16le' } = {}) => {
  const buf = new ArrayBuffer(samples * 2);
  const dv = new DataView(buf);
  for (let i = 0; i < samples; i++) dv.setInt16(i * 2, Math.round(amp * 32767), true);
  return {
    bytes: btoa(String.fromCharCode(...new Uint8Array(buf))),
    format, sampleRate, channels: 1,
  };
};

describe('voice-sink tap — pure measurement helpers', () => {
  test('chunkRms measures a real PCM chunk and rejects the unreadable', () => {
    const frame = steadyFrame(0.5);
    const bytes = base64ToBytes(frame.bytes);
    expect(chunkRms(bytes, frame.format, frame.channels)).toBeCloseTo(0.5, 2);
    expect(chunkRms(bytes, 'audio/ogg', 1)).toBe(0);   // encoded: level unknown, honestly 0
    expect(chunkRms(new Uint8Array(0))).toBe(0);
    expect(chunkRms(null)).toBe(0);
  });

  test('decayedLevel falls linearly to silence', () => {
    expect(decayedLevel(0.6, 0)).toBeCloseTo(0.6, 6);
    expect(decayedLevel(0.6, PLAYBACK_ACTIVITY_MS / 2)).toBeCloseTo(0.3, 6);
    expect(decayedLevel(0.6, PLAYBACK_ACTIVITY_MS)).toBe(0);
    expect(decayedLevel(0.6, PLAYBACK_ACTIVITY_MS * 2)).toBe(0);
    expect(decayedLevel(0, 0)).toBe(0);
    expect(decayedLevel(NaN, 0)).toBe(0);
  });
});

describe('voice-sink tap — getPlaybackState through the real push path', () => {
  test('a pushed frame reads as live playback with its real level', async () => {
    const sink = createVoiceSink({ createContext: makeFakeCtx });
    sink.pushAudio(steadyFrame(0.5));
    await sink.idle();
    const s = sink.getPlaybackState();
    expect(s.active).toBe(true);
    expect(s.level).toBeGreaterThan(0.3);
    expect(Object.isFrozen(s)).toBe(true);
    sink.dispose();
  });

  test('silence after the activity window; the clock is injectable', async () => {
    const sink = createVoiceSink({ createContext: makeFakeCtx });
    const now = Date.now();
    sink.pushAudio(steadyFrame(0.5));
    await sink.idle();
    // Within the window: live, decaying. Past it: silent and inactive.
    const during = sink.getPlaybackState(now + PLAYBACK_ACTIVITY_MS / 2);
    expect(during.active).toBe(true);
    expect(during.level).toBeLessThan(0.5);
    const after = sink.getPlaybackState(now + PLAYBACK_ACTIVITY_MS * 2);
    expect(after.active).toBe(false);
    expect(after.level).toBe(0);
    sink.dispose();
  });

  test('interrupt (barge-in) silences the channel at once', async () => {
    const sink = createVoiceSink({ createContext: makeFakeCtx });
    sink.pushAudio(steadyFrame(0.5));
    await sink.idle();
    sink.interrupt();
    const s = sink.getPlaybackState();
    expect(s.active).toBe(false);
    expect(s.level).toBe(0);
    sink.dispose();
  });

  test('a muted sink is never a live channel', async () => {
    const sink = createVoiceSink({ createContext: makeFakeCtx });
    sink.setEnabled(false);
    sink.pushAudio(steadyFrame(0.5)); // dropped by the mute gate — never scheduled
    await sink.idle();
    const s = sink.getPlaybackState();
    expect(s.active).toBe(false);
    expect(s.level).toBe(0);
    sink.dispose();
  });

  test('an encoded frame reports ACTIVITY with an honest zero level', async () => {
    const sink = createVoiceSink({ createContext: makeFakeCtx });
    sink.pushAudio({ bytes: btoa('OGGS....'), format: 'audio/ogg', sampleRate: 48000, channels: 1 });
    await sink.idle();
    const s = sink.getPlaybackState();
    expect(s.active).toBe(true);   // it was genuinely scheduled to play
    expect(s.level).toBe(0);       // but no level was readable — none is invented
    sink.dispose();
  });
});
