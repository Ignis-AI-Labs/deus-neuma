// Real astronomy-engine, real spherical geometry, NO mock (RULE 0). The
// ascendant and midheaven are physical: the ascendant is the ecliptic degree
// genuinely touching the eastern horizon, the midheaven the degree on the
// meridian. We prove our formulae produce exactly those by cross-checking each
// computed angle against astronomy-engine's own horizon transform — pointing the
// instrument at the sky, not trusting an almanac website.
import { describe, it, expect } from 'vitest';
import * as Astronomy from 'astronomy-engine';
import { computeAngles } from '../../core/cosmos/angles.js';
import { SIGNS } from '../../core/cosmos/natal-chart.js';

const norm360 = (d) => ((d % 360) + 360) % 360;

// Drop an ecliptic-of-date longitude (on the ecliptic, latitude 0) onto the
// observer's local horizon, via the real equator-of-date transform. Returns the
// point's altitude, azimuth, and right ascension in degrees — all measured, none
// assumed. refraction=null = airless geometry, so a point truly on the horizon
// reads altitude 0 (no atmospheric bending fudge).
function horizonOf(eclipticLon, date, lat, lon) {
  const t = Astronomy.MakeTime(date);
  const ect = Astronomy.VectorFromSphere(new Astronomy.Spherical(0, eclipticLon, 1), t);
  const eqd = Astronomy.RotateVector(Astronomy.Rotation_ECT_EQD(t), ect);
  const equ = Astronomy.EquatorFromVector(eqd);
  const hor = Astronomy.Horizon(t, new Astronomy.Observer(lat, lon, 0), equ.ra, equ.dec, null);
  return { altitude: hor.altitude, azimuth: hor.azimuth, raDeg: norm360(equ.ra * 15) };
}

const PLACES = [
  { name: 'New York',  iso: '2026-06-23T12:00:00Z', lat: 40.7128,  lon: -74.0060 },
  { name: 'Sydney',    iso: '2026-03-21T03:30:00Z', lat: -33.8688, lon: 151.2093 },
  { name: 'Lagos',     iso: '2026-09-23T18:00:00Z', lat: 6.5244,   lon: 3.3792 },
  { name: 'Reykjavík', iso: '2026-12-21T20:50:00Z', lat: 64.1466,  lon: -21.9426 },
];

describe('sky-angles — real horizon geometry, by gnosis (no mock)', () => {
  it('the ascendant truly sits on the eastern horizon, the midheaven on the meridian', () => {
    for (const { name, iso, lat, lon } of PLACES) {
      const date = new Date(iso);
      const a = computeAngles(date, lat, lon);

      // Midheaven: its right ascension equals the local sidereal time (RAMC),
      // i.e. it lies on the meridian. Match to a hundredth of a degree.
      const mcH = horizonOf(a.midheaven.longitude, date, lat, lon);
      const mcRaDiff = Math.abs(((mcH.raDeg - a.ramc + 540) % 360) - 180);
      expect(mcRaDiff, `${name} MC on meridian`).toBeLessThan(0.01);

      // Ascendant: on the horizon (altitude ≈ 0) and in the eastern half of the
      // sky (azimuth 0°–180°) — rising, not setting. The only real error here is
      // mean-vs-true obliquity (nutation ≈ 0.003°), so the tolerance is tight.
      const ascH = horizonOf(a.ascendant.longitude, date, lat, lon);
      expect(Math.abs(ascH.altitude), `${name} ASC on horizon`).toBeLessThan(0.05);
      expect(ascH.azimuth, `${name} ASC rising in the east`).toBeGreaterThan(0);
      expect(ascH.azimuth, `${name} ASC rising in the east`).toBeLessThan(180);
    }
  });

  it('places every angle in a real sign with a degree in [0,30)', () => {
    const a = computeAngles(new Date('2026-06-23T12:00:00Z'), 40.7128, -74.0060);
    for (const angle of [a.ascendant, a.midheaven, a.descendant, a.imumCoeli]) {
      expect(SIGNS).toContain(angle.sign);
      expect(angle.degree).toBeGreaterThanOrEqual(0);
      expect(angle.degree).toBeLessThan(30);
    }
  });

  it('descendant opposes ascendant, IC opposes midheaven (exactly 180° apart)', () => {
    const a = computeAngles(new Date('2026-03-21T03:30:00Z'), -33.8688, 151.2093);
    expect(norm360(a.descendant.longitude - a.ascendant.longitude)).toBeCloseTo(180, 6);
    expect(norm360(a.imumCoeli.longitude - a.midheaven.longitude)).toBeCloseTo(180, 6);
  });

  it('builds twelve Whole-Sign houses, the ascendant in the first', () => {
    const a = computeAngles(new Date('2026-09-23T18:00:00Z'), 6.5244, 3.3792);
    expect(a.houseSystem).toBe('whole-sign');
    expect(a.houses).toHaveLength(12);
    // House 1 is the ascendant's whole sign; cusps at 0° of each sign, in order.
    expect(a.houses[0].sign).toBe(a.ascendant.sign);
    for (let i = 0; i < 12; i++) {
      expect(a.houses[i].house).toBe(i + 1);
      expect(a.houses[i].cuspLongitude).toBe(a.houses[i].signIndex * 30);
      expect(a.houses[i].signIndex).toBe((a.houses[0].signIndex + i) % 12);
    }
  });

  it('flags polar latitudes (ASC defined + on the horizon, but rising semantics weaken)', () => {
    // Below the circle: a normal, unflagged chart.
    const temperate = computeAngles(new Date('2026-06-23T12:00:00Z'), 40.7128, -74.0060);
    expect(temperate.polar).toBe(false);

    // Above the Arctic Circle (70°N) at an instant where the ascendant drifts off
    // due east. We still return a real ecliptic–horizon intersection — finite,
    // placed in a sign, sitting on the horizon — but mark it polar so a caller can
    // choose a sign-only chart instead of trusting the rising degree.
    const date = new Date('2026-06-21T00:00:00Z');
    const polar = computeAngles(date, 70, 25);
    expect(polar.polar).toBe(true);
    expect(Number.isFinite(polar.ascendant.longitude)).toBe(true);
    expect(SIGNS).toContain(polar.ascendant.sign);
    const ascH = horizonOf(polar.ascendant.longitude, date, 70, 25);
    expect(Math.abs(ascH.altitude), 'polar ASC still on the horizon').toBeLessThan(0.05);
    // And here is the weakening made concrete: at this instant the "ascendant"
    // sits at a northern azimuth (~351°), OUTSIDE the 0–180° eastern half — it is
    // not rising in the east. This is exactly why we flag polar charts.
    expect(ascH.azimuth, 'polar ASC drifts out of the eastern half').toBeGreaterThan(180);
  });

  it('rejects an impossible location instead of inventing a chart', () => {
    const d = new Date('2026-06-23T12:00:00Z');
    expect(() => computeAngles(d, 91, 0)).toThrow(/latitude/);
    expect(() => computeAngles(d, 0, 200)).toThrow(/longitude/);
    expect(() => computeAngles(d, NaN, 0)).toThrow(/latitude/);
  });
});
