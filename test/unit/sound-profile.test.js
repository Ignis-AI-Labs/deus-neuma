/**
 * The sound profile (backend/services/voice/sound-profile.js) and its plain
 * words (core/voice/sound-words.js) — pure law over real signals: a voiced
 * harmonic tone with a known pitch and glide, white noise, and silence. No
 * mocks (RULE 0).
 */

import { describe, it, expect } from 'vitest';
import { soundProfileOf, pitchTrack } from '../../backend/services/voice/sound-profile.js';
import { frameLevels, speechFrames } from '../../backend/services/voice/forge-doors.js';
import { soundWordsOf } from '../../core/voice/sound-words.js';

const SR = 24000;

// A buzzy voiced tone: harmonics 1..12 of f0(t), rolling off, at -12 dBFS.
const voiced = (seconds, f0At, { gapEvery = 0, gap = 0 } = {}) => {
  const out = new Int16Array(Math.round(seconds * SR));
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    phase += (2 * Math.PI * f0At(t)) / SR;
    const silent = gapEvery && (t % gapEvery) > gapEvery - gap;
    let v = 0;
    for (let h = 1; h <= 12; h++) v += Math.sin(h * phase) / h;
    out[i] = silent ? 0 : Math.round(v * 0.25 * 8192);
  }
  return out;
};

const profile = (samples) => {
  const levels = frameLevels(samples, SR);
  return soundProfileOf(samples, SR, { speech: speechFrames(levels).speech, levels });
};

describe('soundProfileOf — measured from real signals', () => {
  it('a steady 150 Hz voice: its pitch, a narrow range, a clean texture', () => {
    const p = profile(voiced(6, () => 150));
    expect(p.pitchHz).toBeGreaterThan(146);
    expect(p.pitchHz).toBeLessThan(154);
    expect(p.pitchRangeSt).toBeLessThan(1);
    expect(p.aperiodicity).toBeLessThan(0.05);
    expect(p.centroidHz).toBeGreaterThan(150);
  });

  it('a voice gliding 110 → 220 Hz reads a wide range (about an octave)', () => {
    const p = profile(voiced(8, (t) => 110 * 2 ** (t / 8)));
    expect(p.pitchRangeSt).toBeGreaterThan(8);
    expect(p.pitchRangeSt).toBeLessThan(13);
  });

  it('pauses of half a second are counted per minute', () => {
    const p = profile(voiced(12, () => 160, { gapEvery: 2, gap: 0.5 }));
    expect(p.pausesPerMinute).toBeGreaterThanOrEqual(20);
    expect(p.pausesPerMinute).toBeLessThanOrEqual(30);
  });

  it('noise and silence carry no pitch — no number is invented', () => {
    let seed = 7;
    const noise = Int16Array.from({ length: 6 * SR }, () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return Math.round(((seed / 2 ** 31) - 0.5) * 8000);
    });
    expect(pitchTrack(noise, SR, Array(300).fill(true)).length).toBeLessThan(10);
    expect(profile(noise).pitchHz).toBeNull();
    expect(profile(new Int16Array(6 * SR))).toMatchObject({ pitchHz: null, pitchRangeSt: null, centroidHz: null });
  });
});

describe('soundWordsOf — the profile in plain words', () => {
  it('says each band with its number', () => {
    const lines = soundWordsOf({ pitchHz: 105, pitchRangeSt: 5, centroidHz: 700, aperiodicity: 0.08, dynamicsDb: 16, pausesPerMinute: 5 }, 3.5);
    expect(lines).toEqual([
      'Pitch: low among adult voices (median 105 Hz), narrow, little rise and fall (5 semitones).',
      'Tone as recorded: dark and warm (spectral centre 700 Hz).',
      'Texture: breathy or husky.',
      'Loudness: a steady volume (16 dB between soft and loud).',
      'Pace: quick (3.5 words a second), few pauses (5 a minute).',
    ]);
  });

  it('leaves out what was not measured', () => {
    expect(soundWordsOf(null)).toEqual([]);
    expect(soundWordsOf({ pitchHz: 200 })).toEqual(['Pitch: high among adult voices (median 200 Hz).']);
  });
});
