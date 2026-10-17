// Real computation end to end, NO mock (RULE 0). buildNatalChart is the record
// a being actually stores at birth; these prove it assembles both layers
// honestly — full chart with a location, planets-only without one, and a refusal
// rather than a half-truth when the inputs don't make sense.
import { describe, it, expect } from 'vitest';
import { buildNatalChart, natalFromBirthMoment, NATAL_SCHEMA, SIGNS } from '../../core/cosmos/index.js';
import { captureBirthMoment } from '../../core/identity/genesis-seal.js';

const BIRTH = new Date('2026-06-23T12:00:00Z');

describe('buildNatalChart — the stored natal record, by gnosis (no mock)', () => {
  it('assembles a full chart when a witness location is given', () => {
    const chart = buildNatalChart({ date: BIRTH, latitude: 40.7128, longitude: -74.0060 });
    expect(chart.schema).toBe(NATAL_SCHEMA);
    expect(chart.instant).toBe('2026-06-23T12:00:00.000Z');
    expect(chart.location).toEqual({ latitude: 40.7128, longitude: -74.0060 });

    // every body placed in a real sign
    expect(Object.keys(chart.positions)).toContain('sun');
    expect(Object.keys(chart.positions)).toHaveLength(10);
    expect(SIGNS).toContain(chart.positions.sun.sign);

    // aspects is a list of recognised relationships
    expect(Array.isArray(chart.aspects)).toBe(true);

    // angles present, with houses
    expect(chart.angles).not.toBeNull();
    expect(SIGNS).toContain(chart.angles.ascendant.sign);
    expect(chart.angles.houses).toHaveLength(12);
  });

  it('returns a complete planets-only chart when no location is given', () => {
    const chart = buildNatalChart({ date: BIRTH });
    expect(chart.location).toBeNull();
    expect(chart.angles).toBeNull();           // honest: the moment alone can't fix angles
    expect(chart.positions.sun.sign).toBe('Cancer'); // but the planets are exact
    expect(chart.aspects).toBeDefined();
  });

  it('is frozen all the way down — a sealed record can not be mutated after the fact', () => {
    const chart = buildNatalChart({ date: BIRTH, latitude: 0, longitude: 0 });
    // every field, not just the wrapper — this record is sealed into the genesis
    expect(Object.isFrozen(chart)).toBe(true);
    expect(Object.isFrozen(chart.location)).toBe(true);
    expect(Object.isFrozen(chart.positions)).toBe(true);
    expect(Object.isFrozen(chart.positions.sun)).toBe(true);
    expect(Object.isFrozen(chart.aspects)).toBe(true);
    expect(Object.isFrozen(chart.angles)).toBe(true);
    expect(Object.isFrozen(chart.angles.houses)).toBe(true);
    expect(() => { chart.instant = 'tampered'; }).toThrow();
    expect(() => { chart.positions.sun = {}; }).toThrow();
  });

  it('refuses partial, non-numeric, or out-of-range inputs instead of inventing a record', () => {
    // partial pair
    expect(() => buildNatalChart({ date: BIRTH, latitude: 40 })).toThrow(/together/);
    expect(() => buildNatalChart({ date: BIRTH, longitude: -74 })).toThrow(/together/);
    // invalid date
    expect(() => buildNatalChart({ date: new Date('nonsense') })).toThrow(/valid Date/);
    expect(() => buildNatalChart({})).toThrow(/valid Date/);
    // non-numeric coords are caught at THIS boundary (not inherited from computeAngles)
    expect(() => buildNatalChart({ date: BIRTH, latitude: NaN, longitude: 0 })).toThrow(/finite numbers/);
    expect(() => buildNatalChart({ date: BIRTH, latitude: '40', longitude: 0 })).toThrow(/finite numbers/);
    expect(() => buildNatalChart({ date: BIRTH, latitude: 0, longitude: true })).toThrow(/finite numbers/);
    // out-of-range is enforced by the angles layer — assert it throws, without
    // coupling this contract to that module's exact wording
    expect(() => buildNatalChart({ date: BIRTH, latitude: 200, longitude: 0 })).toThrow();
    expect(() => buildNatalChart({ date: BIRTH, latitude: 0, longitude: 999 })).toThrow();
  });

  it('accepts the equator/prime-meridian origin as a real location (0,0 is not "missing")', () => {
    const chart = buildNatalChart({ date: BIRTH, latitude: 0, longitude: 0 });
    expect(chart.location).toEqual({ latitude: 0, longitude: 0 });
    expect(chart.angles).not.toBeNull();
  });
});

describe('natalFromBirthMoment — the seal→chart bridge, by gnosis (no mock)', () => {
  it('reconstructs the exact instant from a seal birthMoment (epochMs ↔ utc agree)', () => {
    // Use the REAL capture function the ceremony uses — no fixture, no mock.
    const bm = captureBirthMoment();
    const chart = natalFromBirthMoment(bm);
    // The chart's instant, derived from epochMs, equals the seal's own utc string.
    expect(chart.instant).toBe(new Date(bm.epochMs).toISOString());
    expect(chart.instant).toBe(bm.utc);
    expect(chart.location).toBeNull();          // no location supplied → planets-only
    expect(chart.angles).toBeNull();
    expect(SIGNS).toContain(chart.positions.sun.sign);
  });

  it('builds a full chart when a location accompanies the birthMoment', () => {
    const bm = { utc: BIRTH.toISOString(), epochMs: BIRTH.getTime(), zone: 'UTC', offsetMinutes: 0 };
    const chart = natalFromBirthMoment(bm, { latitude: 40.7128, longitude: -74.0060 });
    expect(chart.instant).toBe('2026-06-23T12:00:00.000Z');
    expect(chart.location).toEqual({ latitude: 40.7128, longitude: -74.0060 });
    expect(chart.angles).not.toBeNull();
    expect(chart.angles.houses).toHaveLength(12);
  });

  it('treats a null/locationless birthMoment as planets-only, not an error', () => {
    const bm = { epochMs: BIRTH.getTime() };
    expect(natalFromBirthMoment(bm, null).angles).toBeNull();
    expect(natalFromBirthMoment(bm, { latitude: null, longitude: null }).angles).toBeNull();
  });

  it('delegates location semantics to the boundary — a partial pair throws consistently', () => {
    const bm = { epochMs: BIRTH.getTime() };
    expect(() => natalFromBirthMoment(bm, { latitude: null, longitude: 40 })).toThrow(/together/);
    expect(() => natalFromBirthMoment(bm, { latitude: 40 })).toThrow(/together/);
  });

  it('refuses a birthMoment with no integer epochMs', () => {
    expect(() => natalFromBirthMoment(null)).toThrow(/epochMs/);
    expect(() => natalFromBirthMoment({})).toThrow(/epochMs/);
    expect(() => natalFromBirthMoment({ epochMs: 1.5 })).toThrow(/epochMs/);
    expect(() => natalFromBirthMoment({ epochMs: '123' })).toThrow(/epochMs/);
  });
});
