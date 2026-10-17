import { describe, expect, it } from 'vitest';

import { buildPlan } from '../../scripts/lib/bake-plan.mjs';
import { concatWavs, parseWav, wavDuration } from '../../scripts/lib/wav-concat.mjs';
import { pickAudioUrl, resolveSlice } from '../../frontend/services/sprite-resolver.js';
import { SOUND_MANIFEST } from '../../frontend/services/sound-manifest.js';
import spriteIndex from '../../frontend/sounds-baked/sprite.json';

describe('buildPlan', () => {
  it('lays cues end-to-end with a gap after each', () => {
    const cues = [
      { event: 'a', file: 'a.wav' },
      { event: 'b', file: 'b.wav' },
      { event: 'c', file: 'c.wav' },
    ];
    const { index, total } = buildPlan(cues, [1, 2, 0.5], 0.1);
    expect(index.a).toEqual({ start: 0, duration: 1 });
    expect(index.b).toEqual({ start: 1.1, duration: 2 });
    expect(index.c).toEqual({ start: 3.2, duration: 0.5 });
    expect(total).toBeCloseTo(3.8, 10); // 3.5 cues + 3 gaps
  });

  it('rejects mismatched cue/duration arity', () => {
    expect(() => buildPlan([{ event: 'a', file: 'a' }], [], 0.1)).toThrow(/align/);
  });

  it('rejects a non-positive duration', () => {
    expect(() => buildPlan([{ event: 'a', file: 'a' }], [0], 0.1)).toThrow(/non-positive/);
  });
});

// Real WAV builder: emits a valid RIFF/WAVE buffer with genuine PCM samples.
// No mock — these are real audio bytes parsed by the real parser.
const buildRealWav = ({ sampleRate = 48000, channels = 2, bitsPerSample = 16, frames = 100 }) => {
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = channels * bytesPerSample;
  const dataSize = frames * blockAlign;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * blockAlign, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < dataSize; i += 1) buf[44 + i] = (i % 251); // nonzero PCM
  return buf;
};

describe('wav-concat', () => {
  it('parses a real WAV back to its format + data', () => {
    const w = parseWav(buildRealWav({ sampleRate: 44100, channels: 2, bitsPerSample: 16, frames: 50 }));
    expect(w.audioFormat).toBe(1);
    expect(w.channels).toBe(2);
    expect(w.sampleRate).toBe(44100);
    expect(w.bitsPerSample).toBe(16);
    expect(w.data.length).toBe(50 * 2 * 2);
  });

  it('concats uniform WAVs with a silence gap and yields a valid larger WAV', () => {
    const a = parseWav(buildRealWav({ sampleRate: 48000, frames: 4800 })); // 0.1s
    const b = parseWav(buildRealWav({ sampleRate: 48000, frames: 4800 }));
    const out = concatWavs([a, b], 0.05);
    const parsed = parseWav(out);
    expect(parsed.sampleRate).toBe(48000);
    // 0.1 + 0.05 gap + 0.1 = 0.25s @ 48k stereo 16-bit
    // = (4800 + 2400 + 4800) frames * 4 bytes/frame = 48000 bytes
    expect(parsed.data.length).toBe(48000);
    expect(wavDuration(parsed)).toBeCloseTo(0.25, 6);
  });

  it('throws honestly on mixed-format sources instead of corrupting output', () => {
    const a = parseWav(buildRealWav({ sampleRate: 44100 }));
    const b = parseWav(buildRealWav({ sampleRate: 96000 }));
    expect(() => concatWavs([a, b], 0.1)).toThrow(/not uniform/);
  });
});

describe('sprite-resolver (against the real committed sprite)', () => {
  it('has a slice for every manifest event', () => {
    const events = Object.keys(SOUND_MANIFEST);
    // The manifest GROWS — 17 ratified cues, then the 14-cue act board
    // (2026-08-06). What must hold is that the bake covers whatever the
    // manifest declares, so this counts the sprite against the manifest
    // instead of against a number that goes stale on the next cue.
    expect(events.length).toBeGreaterThanOrEqual(17);
    expect(Object.keys(spriteIndex.events)).toHaveLength(events.length);
    for (const event of events) {
      const slice = resolveSlice(spriteIndex, event);
      expect(slice, `missing slice for ${event}`).not.toBeNull();
      expect(slice.start).toBeGreaterThanOrEqual(0);
      expect(slice.duration).toBeGreaterThan(0);
      expect(slice.start + slice.duration).toBeLessThanOrEqual(spriteIndex.total ?? Infinity);
    }
  });

  it('starts the first cue at offset 0', () => {
    expect(resolveSlice(spriteIndex, 'noticeArrival').start).toBe(0);
  });

  it('returns null for an unknown event', () => {
    expect(resolveSlice(spriteIndex, 'nope')).toBeNull();
  });

  it('prefers opus, falls back to wav when opus unsupported or absent', () => {
    expect(pickAudioUrl({ opus: 's.opus', wav: 's.wav' }, true)).toBe('s.opus');
    expect(pickAudioUrl({ opus: 's.opus', wav: 's.wav' }, false)).toBe('s.wav');
    expect(pickAudioUrl({ wav: 's.wav' }, true)).toBe('s.wav'); // opus absent from bake
    expect(pickAudioUrl({ opus: 's.opus' }, false)).toBe('s.opus'); // only opus, must use it
    expect(() => pickAudioUrl({}, true)).toThrow(/bake-sounds/);
  });
});
