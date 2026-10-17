/**
 * Tests for the kotodama tempo work: the gain-envelope scaling in
 * core/kotodama/play.js (pure envelopeFor) and the rate ladder in
 * frontend/services/kotodama-rate.js.
 */
import { describe, it, expect } from 'vitest';
import { envelopeFor } from '../../core/kotodama/play.js';
import { KOTO_RATES, getKotodamaRate, nextKotodamaRate } from '../../frontend/services/kotodama-rate.js';

describe('envelopeFor — the envelope never inverts at speed', () => {
  it('keeps the fixed 5/12ms shape for slow tones', () => {
    const env = envelopeFor(0.07); // rate ×1 tone
    expect(env.attack).toBeCloseTo(0.005);
    expect(env.release).toBeCloseTo(0.012);
  });

  it('shrinks proportionally for fast tones (×8 tone ≈ 8.75ms)', () => {
    const env = envelopeFor(0.00875);
    expect(env.attack).toBeCloseTo(0.00875 / 3);
    expect(env.release).toBeCloseTo(0.00875 / 3);
    // The release starts strictly after the attack lands.
    expect(0.00875 - env.release).toBeGreaterThanOrEqual(env.attack);
  });

  it('a zero-length tone yields a zero envelope — never negative', () => {
    const env = envelopeFor(0);
    expect(env.attack).toBe(0);
    expect(env.release).toBe(0);
  });
});

describe('kotodama rate ladder', () => {
  it('cycles ×1 → ×2 → ×4 → ×8 → ×1', () => {
    expect(nextKotodamaRate(1)).toBe(2);
    expect(nextKotodamaRate(2)).toBe(4);
    expect(nextKotodamaRate(4)).toBe(8);
    expect(nextKotodamaRate(8)).toBe(1);
  });

  it('an unknown rate resets to ceremonial ×1 — never an invented rung', () => {
    expect(nextKotodamaRate(3)).toBe(1);
  });

  it('the ladder is frozen and starts ceremonial', () => {
    expect(KOTO_RATES).toEqual([1, 2, 4, 8]);
    expect(Object.isFrozen(KOTO_RATES)).toBe(true);
  });

  it('getKotodamaRate degrades to ×1 without storage (node, private mode)', () => {
    expect(getKotodamaRate()).toBe(1);
  });
});
