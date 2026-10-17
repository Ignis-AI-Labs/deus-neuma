// The rules behind the sound dial, called for real with real values — no
// browser, no storage, no mock (RULE 0). The one that matters most is the
// absent-value case: `Number(null)` is 0, so a naive parse would hand SILENCE
// to every witness who has never opened the dial, and the sound would read as
// broken rather than unset.
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SOUND_VOLUME, LOOP_SHARE, clampVolume, loopVolume, parseVolume,
} from '../../frontend/services/sound-volume.js';

describe('sound level rules', () => {
  it('an untouched dial reads as the default, never as silence', () => {
    expect(parseVolume(null)).toBe(DEFAULT_SOUND_VOLUME);
    expect(parseVolume(undefined)).toBe(DEFAULT_SOUND_VOLUME);
    expect(parseVolume('')).toBe(DEFAULT_SOUND_VOLUME);
  });

  it('a stored level comes back exactly as it was set', () => {
    expect(parseVolume('0.35')).toBe(0.35);
    expect(parseVolume(0.8)).toBe(0.8);
  });

  it('silence is a level a witness can choose', () => {
    expect(parseVolume('0')).toBe(0);
    expect(parseVolume(0)).toBe(0);
  });

  it('a corrupt value falls back to the default rather than to nothing', () => {
    expect(parseVolume('loud')).toBe(DEFAULT_SOUND_VOLUME);
    expect(parseVolume(NaN)).toBe(DEFAULT_SOUND_VOLUME);
  });

  it('a level out of range is held inside it', () => {
    expect(parseVolume('4')).toBe(1);
    expect(parseVolume('-1')).toBe(0);
    expect(clampVolume(1.5)).toBe(1);
    expect(clampVolume(-0.2)).toBe(0);
    expect(clampVolume(0.4)).toBe(0.4);
  });

  it('a sustained bed sits under the cues it accompanies', () => {
    expect(loopVolume(1)).toBeCloseTo(LOOP_SHARE, 10);
    expect(loopVolume(0.5)).toBeCloseTo(0.5 * LOOP_SHARE, 10);
    expect(loopVolume(0.5)).toBeLessThan(0.5);
  });

  it('a muted master mutes the bed too', () => {
    expect(loopVolume(0)).toBe(0);
  });
});
