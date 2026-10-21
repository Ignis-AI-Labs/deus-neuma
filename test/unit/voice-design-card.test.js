/**
 * Voice designer pure logic (F-12, FR-29) — the honest batch-wait estimator
 * and the contract-bounded REROLL seed bump. Pure logic only: no fetch, no
 * DOM, no mocks. The sidecar is not booted for these.
 */

import { describe, test, expect } from 'vitest';
import {
  DESIGN_WAIT_SECONDS_PER_CHAR,
  DESIGN_SEED_MAX,
  estimateDesignWait,
  normalizeDesignSeed,
  bumpDesignSeed,
} from '../../frontend/app/RelinkShell/voice-client.js';

describe('estimateDesignWait — honest batch wait derived from text length', () => {
  test('the constant is the measured sidecar rate (0.05 s/char, wave-1 contract)', () => {
    expect(DESIGN_WAIT_SECONDS_PER_CHAR).toBe(0.05);
  });

  test('short probe lands fast; longer texts scale linearly (ceil, whole seconds)', () => {
    expect(estimateDesignWait(28)).toBe(2);  // a short probe line (28 chars → 1.4 s → 2)
    expect(estimateDesignWait(47)).toBe(3);  // a full line (47 chars → 2.35 s → 3)
    expect(estimateDesignWait(100)).toBe(5);
    expect(estimateDesignWait(4000)).toBe(200); // contract-max text
  });

  test('degenerate input floors at 1 s — never a fake instant', () => {
    expect(estimateDesignWait(0)).toBe(1);
    expect(estimateDesignWait(-5)).toBe(1);
    expect(estimateDesignWait(NaN)).toBe(1);
    expect(estimateDesignWait(undefined)).toBe(1);
  });
});

describe('normalizeDesignSeed / bumpDesignSeed — contract-bounded seeds', () => {
  test('the bound matches the sidecar contract (int, 0..2³¹−1)', () => {
    expect(DESIGN_SEED_MAX).toBe(2 ** 31 - 1);
  });

  test('normalize clamps into range, floors floats, coerces strings, rejects junk to 0', () => {
    expect(normalizeDesignSeed(0)).toBe(0);
    expect(normalizeDesignSeed(1337)).toBe(1337);
    expect(normalizeDesignSeed(DESIGN_SEED_MAX)).toBe(DESIGN_SEED_MAX);
    expect(normalizeDesignSeed(DESIGN_SEED_MAX + 1)).toBe(DESIGN_SEED_MAX);
    expect(normalizeDesignSeed(-3)).toBe(0);
    expect(normalizeDesignSeed(4.9)).toBe(4);
    expect(normalizeDesignSeed('42')).toBe(42);
    expect(normalizeDesignSeed('abc')).toBe(0);
    expect(normalizeDesignSeed(undefined)).toBe(0);
  });

  test('bump increments and wraps at the contract bound', () => {
    expect(bumpDesignSeed(1337)).toBe(1338);
    expect(bumpDesignSeed(DESIGN_SEED_MAX)).toBe(0);
    expect(bumpDesignSeed(-5)).toBe(1); // junk normalizes to 0 first
  });
});
