// expression-map.test.js — the expression contract data holds against both
// sides it bridges: the KENORIE bake contract (ARKit-52 + 17 presets, per
// docs/architecture/avatars/consumer-contract.md) and the neuma emotion vocabulary
// (core/runtime/emotion-detector.js). Pure data, pure assertions.

import { describe, it, expect } from 'vitest';
import { EMOTION_LABELS } from '../../core/runtime/emotion-detector.js';
import {
  ARKIT_52, VRM_PRESETS_17, VISEME_PRESETS, GAZE_PRESETS,
  EMOTION_TO_PRESETS, EMOTION_TO_ARKIT,
} from '../../frontend/app/RelinkShell/vessel/expression-map.js';

const groupCount = (prefix) => ARKIT_52.filter((n) => n.startsWith(prefix)).length;

describe('ARKit-52 contract surface', () => {
  it('has exactly 52 unique names', () => {
    expect(ARKIT_52).toHaveLength(52);
    expect(new Set(ARKIT_52).size).toBe(52);
  });

  it('matches the contract group counts (eyes 14, jaw 4, mouth 23, brow 5, cheek 3, nose 2, tongue 1)', () => {
    expect(groupCount('eye')).toBe(14);
    expect(groupCount('jaw')).toBe(4);
    expect(groupCount('mouth')).toBe(23);
    expect(groupCount('brow')).toBe(5);
    expect(groupCount('cheek')).toBe(3);
    expect(groupCount('nose')).toBe(2);
    expect(groupCount('tongue')).toBe(1);
  });

  it('spans eyeBlinkLeft … tongueOut and is frozen', () => {
    expect(ARKIT_52[0]).toBe('eyeBlinkLeft');
    expect(ARKIT_52[51]).toBe('tongueOut');
    expect(Object.isFrozen(ARKIT_52)).toBe(true);
  });
});

describe('the 17 VRM presets', () => {
  it('are exactly the contract set', () => {
    expect([...VRM_PRESETS_17].sort()).toEqual([
      'aa', 'angry', 'blink', 'blinkLeft', 'blinkRight', 'ee', 'happy', 'ih',
      'lookDown', 'lookLeft', 'lookRight', 'lookUp', 'oh', 'ou', 'relaxed',
      'sad', 'surprised',
    ]);
  });

  it('contain the viseme and gaze subsets', () => {
    expect(VISEME_PRESETS).toEqual(['aa', 'ih', 'ou', 'ee', 'oh']);
    expect(GAZE_PRESETS).toEqual(['lookUp', 'lookDown', 'lookLeft', 'lookRight']);
    for (const name of [...VISEME_PRESETS, ...GAZE_PRESETS]) {
      expect(VRM_PRESETS_17).toContain(name);
    }
  });
});

describe('emotion maps', () => {
  it('cover the full neuma emotion vocabulary on both layers', () => {
    expect(Object.keys(EMOTION_TO_PRESETS).sort()).toEqual([...EMOTION_LABELS].sort());
    expect(Object.keys(EMOTION_TO_ARKIT).sort()).toEqual([...EMOTION_LABELS].sort());
  });

  it('preset layer only references the 17 contract presets, weights in (0, 1]', () => {
    for (const targets of Object.values(EMOTION_TO_PRESETS)) {
      for (const [name, weight] of Object.entries(targets)) {
        expect(VRM_PRESETS_17).toContain(name);
        expect(weight).toBeGreaterThan(0);
        expect(weight).toBeLessThanOrEqual(1);
      }
    }
  });

  it('rich layer only references ARKit-52 names, weights in (0, 1]', () => {
    for (const targets of Object.values(EMOTION_TO_ARKIT)) {
      for (const [name, weight] of Object.entries(targets)) {
        expect(ARKIT_52).toContain(name);
        expect(weight).toBeGreaterThan(0);
        expect(weight).toBeLessThanOrEqual(1);
      }
    }
  });

  it('never drives blink, viseme, or gaze presets from emotion (channel separation)', () => {
    const reserved = new Set([...VISEME_PRESETS, ...GAZE_PRESETS, 'blink', 'blinkLeft', 'blinkRight']);
    for (const targets of Object.values(EMOTION_TO_PRESETS)) {
      for (const name of Object.keys(targets)) expect(reserved.has(name)).toBe(false);
    }
  });
});
