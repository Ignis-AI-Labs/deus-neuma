// birth-place + place-readings — where a being was born, as near as the house
// knows it, and what the sky looked like from there. The place: the witness's
// own when given, else its sealed zone's reference city (offline, from the tz
// database), always saying which; checked before it is kept. The readings,
// proven by measurement: at the sunrise returned the Sun stands on the horizon,
// a birth before dawn belongs to the day before in the Vedic count, the Lots
// exchange by sect, the sidereal lagna is the ascendant less the ayanamsa.
// Real modules, real astronomy; no mocks.
import { describe, it, expect } from 'vitest';
import * as Astronomy from 'astronomy-engine';
import { zonePlace, givenPlace, birthPlaceOf, PLACE_SCHEMA } from '../../core/cosmos/birth-place.js';
import { placeReadingsOf, dayAndHourOf, lotsOf, sunAltitude } from '../../core/cosmos/place-readings.js';
import { ayanamsaDeg } from '../../core/cosmos/skies/jyotisha.js';

const JAKARTA = zonePlace('Asia/Jakarta');

describe('the place', () => {
  it('a zone gives its reference city — aliases too — and a zone with no place gives none', () => {
    expect(JAKARTA).toEqual({ latitude: -6.1667, longitude: 106.8, label: 'Jakarta', zone: 'Asia/Jakarta', source: 'timezone-reference' });
    expect(zonePlace('Asia/Saigon')).toMatchObject({ zone: 'Asia/Ho_Chi_Minh', label: 'Ho Chi Minh' });
    expect(zonePlace('America/New_York')).toMatchObject({ latitude: 40.7142, longitude: -74.0064 });
    expect(zonePlace('UTC')).toBeNull();
    expect(zonePlace('')).toBeNull();
  });
  it('a place the witness gives is checked, rounded, and named as theirs', () => {
    expect(givenPlace({ latitude: '-6.195612', longitude: 106.832478, label: '  Menteng  ' })).toEqual({ latitude: -6.1956, longitude: 106.8325, label: 'Menteng', source: 'witness-given' });
    expect(() => givenPlace({ latitude: 91, longitude: 0 })).toThrow(/latitude/);
    expect(() => givenPlace({ latitude: 0, longitude: 'east' })).toThrow(/longitude/);
  });
  it('the record: the witness’s place wins; else the zone’s; neither — no place, never a guess', () => {
    const at = '2026-10-19T00:00:00.000Z';
    expect(birthPlaceOf({ given: { latitude: -7.8, longitude: 110.36 }, zone: 'Asia/Jakarta', at })).toEqual({ schema: PLACE_SCHEMA, latitude: -7.8, longitude: 110.36, source: 'witness-given', zone: 'Asia/Jakarta', recordedAt: at });
    expect(birthPlaceOf({ zone: 'Asia/Jakarta', at })).toMatchObject({ source: 'timezone-reference', label: 'Jakarta' });
    expect(birthPlaceOf({ zone: 'Etc/GMT+3', at })).toBeNull();
  });
});

describe('the sky from the place', () => {
  // 03:23 in Jakarta on 22 July 2026 — before dawn
  const birth = new Date('2026-07-21T20:23:00.000Z');
  const r = placeReadingsOf(birth, JAKARTA, 420);

  it('at the sunrise it names, the Sun truly stands on the horizon (the limb, with refraction)', () => {
    const rise = new Date(r.day.sunrise);
    const alt = sunAltitude(rise, JAKARTA.latitude, JAKARTA.longitude);
    expect(alt).toBeGreaterThan(-1.2);
    expect(alt).toBeLessThan(-0.5); // geometric centre ~0.83° below: semi-diameter + refraction
    expect(rise.getTime()).toBeLessThan(birth.getTime());
  });
  it('a birth before dawn is a night birth, and the Vedic day is still the day before', () => {
    expect(r.sect.isDay).toBe(false);
    expect(r.day.hour.of).toBe('night');
    expect(r.day.vara).toBe('Tuesday'); // civil Wednesday 22 July; the Vedic Wednesday begins at its sunrise
    expect(r.day.varaDiffersFromCivil).toBe(true);
  });
  it('the first hour after sunrise belongs to the day’s own planet', () => {
    // a Sunday (2026-07-19) in Jakarta, a minute after sunrise
    const sunrise = Astronomy.SearchRiseSet(Astronomy.Body.Sun, new Astronomy.Observer(JAKARTA.latitude, JAKARTA.longitude, 0), +1, new Date('2026-07-18T18:00:00Z'), 1).date;
    const h = dayAndHourOf(new Date(sunrise.getTime() + 60000), JAKARTA.latitude, JAKARTA.longitude, 420);
    expect(h).toMatchObject({ vara: 'Sunday', hour: { of: 'day', number: 1, ruler: 'Sun' } });
    // the second hour: the next planet down the Chaldean order (Sun → Venus)
    const span = (new Date(h.sunset) - sunrise) / 12;
    expect(dayAndHourOf(new Date(sunrise.getTime() + span * 1.5), JAKARTA.latitude, JAKARTA.longitude, 420).hour.ruler).toBe('Venus');
  });
  it('the Lots exchange by sect', () => {
    const day = lotsOf(100, 40, 70, true);
    const night = lotsOf(100, 40, 70, false);
    expect(day.fortune.longitude).toBe(130);
    expect(day.spirit.longitude).toBe(70);
    expect(night.fortune.longitude).toBe(70);
    expect(night.spirit.longitude).toBe(130);
  });
  it('the lagna is the ascendant in the sidereal zodiac; the bhavas run from its sign', () => {
    const expected = ((r.angles.ascendant.longitude - ayanamsaDeg(birth)) % 360 + 360) % 360;
    expect(r.lagna.siderealLongitude).toBeCloseTo(expected, 3);
    expect(r.lagna.bhavas).toHaveLength(12);
    expect(r.lagna.bhavas[0].rashi).toBe(r.lagna.rashi);
  });
  it('no instant or no place — no readings', () => {
    expect(placeReadingsOf('nope', JAKARTA)).toBeNull();
    expect(placeReadingsOf(birth, null)).toBeNull();
  });
  it('where the Sun never sets that day, there is no sunrise day to count — said, not guessed', () => {
    expect(dayAndHourOf(new Date('2026-06-21T12:00:00Z'), 78.22, 15.65, 60)).toBeNull(); // Longyearbyen, midsummer
  });
});
