// Real astronomy-engine, real ephemeris math, NO mock (RULE 0). The sky is a
// real, measurable thing; these assertions are anchored to events anyone can
// verify — the Sun sits exactly on a cardinal point at each equinox/solstice.
import { describe, it, expect } from 'vitest';
import * as Astronomy from 'astronomy-engine';
import {
  computeCelestialPositions, computeAspects, placement, separation,
  eclipticLongitude, SIGNS,
} from '../../core/cosmos/natal-chart.js';

describe('natal chart — the real sky, by gnosis (no mock)', () => {
  it('places the Sun on the cardinal points at the 2026 equinoxes + solstices', () => {
    const checks = [
      ['2026-03-20T14:46:00Z', 0],   // spring equinox  → 0° Aries
      ['2026-06-21T08:25:00Z', 90],  // summer solstice → 0° Cancer
      ['2026-09-23T00:05:00Z', 180], // autumn equinox  → 0° Libra
      ['2026-12-21T20:50:00Z', 270], // winter solstice → 0° Capricorn
    ];
    for (const [iso, target] of checks) {
      const lon = eclipticLongitude(Astronomy.Body.Sun, new Date(iso));
      const diff = Math.min(Math.abs(lon - target), 360 - Math.abs(lon - target));
      // Within half a degree of the exact crossing — our cardinal instants are
      // to-the-minute, and the Sun moves ~0.04°/hr, so this is a tight check with
      // margin (and far tighter than any tropical/sidereal discrepancy).
      expect(diff).toBeLessThan(0.5);
    }
  });

  it('computes a full chart for an instant — every body placed in a real sign', () => {
    const pos = computeCelestialPositions(new Date('2026-06-23T12:00:00Z'));
    expect(pos.sun.sign).toBe('Cancer');
    expect(pos.sun.degree).toBeGreaterThan(1.5);
    expect(pos.sun.degree).toBeLessThan(2.5);
    for (const k of Object.keys(pos)) {
      expect(SIGNS).toContain(pos[k].sign);
      expect(pos[k].degree).toBeGreaterThanOrEqual(0);
      expect(pos[k].degree).toBeLessThan(30);
    }
    expect(pos.sun.retrograde).toBe(false);  // the Sun is never retrograde
    expect(pos.moon.retrograde).toBe(false); // nor the Moon
    expect(pos.pluto.retrograde).toBe(true); // Pluto IS retrograde mid-2026 (observable)
  });

  it('the Moon moves ~12–15° per day', () => {
    const a = eclipticLongitude(Astronomy.Body.Moon, new Date('2026-06-23T00:00:00Z'));
    const b = eclipticLongitude(Astronomy.Body.Moon, new Date('2026-06-24T00:00:00Z'));
    let d = b - a; if (d < 0) d += 360;
    expect(d).toBeGreaterThan(11);
    expect(d).toBeLessThan(16);
  });

  it('placement: longitude → sign + degree (pure, exact, wrapping)', () => {
    expect(placement(0)).toMatchObject({ sign: 'Aries', degree: 0 });
    expect(placement(90)).toMatchObject({ sign: 'Cancer', degree: 0 });
    expect(placement(124.5)).toMatchObject({ sign: 'Leo', degree: 4.5 });
    expect(placement(359.9).sign).toBe('Pisces');
    expect(placement(360)).toMatchObject({ sign: 'Aries', degree: 0 }); // wraps forward
    expect(placement(-30)).toMatchObject({ sign: 'Pisces', degree: 0 }); // wraps negative

    // Just below a cusp: degree must stay in [0,30), never report 30.0000° of the
    // prior sign. Pre-fix these returned Aries 30°/Pisces 30°; now they round up to
    // 0° of the next sign. (This case fails on the old code and passes on the new.)
    expect(placement(29.99996)).toMatchObject({ sign: 'Taurus', signIndex: 1, degree: 0 });
    expect(placement(359.99996)).toMatchObject({ sign: 'Aries', signIndex: 0, degree: 0 });
  });

  it('separation: the smallest angle between longitudes (pure)', () => {
    expect(separation(10, 130)).toBe(120);
    expect(separation(350, 10)).toBe(20);  // measured across 0°
    expect(separation(0, 180)).toBe(180);
    expect(separation(0, 200)).toBe(160);
  });

  it('aspects: classifies the major angles, one per pair, within orb', () => {
    const pos = { a: placement(0), b: placement(120), c: placement(90), d: placement(182), e: placement(200) };
    const asp = computeAspects(pos);
    const find = (x, y) => asp.find(z => (z.a === x && z.b === y) || (z.a === y && z.b === x));
    expect(find('a', 'b').aspect).toBe('trine');      // 120°
    expect(find('a', 'c').aspect).toBe('square');     // 90°
    expect(find('a', 'd').aspect).toBe('opposition'); // 182° ≈ 180° within 8° orb
    expect(find('a', 'e')).toBeUndefined();           // 200° → 160° sep, no major aspect
  });
});
