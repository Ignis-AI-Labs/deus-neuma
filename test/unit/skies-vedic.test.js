// skies-vedic — the Vedic skies against PUBLISHED panchangas and texts
// (docs/architecture/identity/many-skies-vedic.md, Appendix A). The Lahiri
// anchor (corrected 2026-10-19 to the IAE mean) is proven by the boundaries
// Drik Panchang and Prokerala print: two minutes before a published
// nakshatra or yoga change the engine reads the old one, two minutes after it
// the new one. Real engine, real astronomy; no mocks.
import { describe, it, expect } from 'vitest';
import { jyotisha, ayanamsaDeg } from '../../core/cosmos/skies/jyotisha.js';
import { grahasOf, vargaSign, vedicCalendar, vimshottari, SHODASAVARGA } from '../../core/cosmos/skies/vedic.js';
import { buildSkies } from '../../core/cosmos/skies/index.js';

const IST = (iso) => new Date(Date.parse(`${iso}+05:30`));
const around = (iso, minutes) => new Date(IST(iso).getTime() + minutes * 60000);
const nak = (d) => jyotisha(d, 0).nakshatra.name;
const yoga = (d) => jyotisha(d, 0).yoga.index;

describe('the Lahiri anchor reads the published panchangas', () => {
  it('sits within 30″ of Drik’s printed ayanamsa (Drik runs ~22″ above the IAE mean)', () => {
    expect(Math.abs(ayanamsaDeg(IST('2026-10-19T15:22:50')) - 24.238165) * 3600).toBeLessThan(30);
    expect(Math.abs(ayanamsaDeg(IST('2023-08-15T12:00:00')) - 24.193754) * 3600).toBeLessThan(30);
  });
  it('the Moon’s mansion changes when Drik and Prokerala say it does', () => {
    for (const [at, before, after] of [
      ['2026-10-19T15:38:00', 'Uttara Ashadha', 'Shravana'], // Drik + Prokerala
      ['2023-08-15T13:59:00', 'Pushya', 'Ashlesha'], // Drik
      ['2023-07-19T07:58:00', 'Pushya', 'Ashlesha'], // Prokerala
      ['2000-01-01T18:33:00', 'Swati', 'Vishakha'], // Prokerala
      ['2021-04-13T14:19:00', 'Ashwini', 'Bharani'], // Prokerala
    ]) {
      expect(nak(around(at, -2)), `${at} before`).toBe(before);
      expect(nak(around(at, 2)), `${at} after`).toBe(after);
    }
  });
  it('the yoga changes when the panchangas say it does (the sum doubles any anchor error)', () => {
    for (const [at, before] of [
      ['2023-08-15T17:33:00', 17], // Vyatipata → Variyan (Drik)
      ['2026-10-20T00:35:00', 8], // Dhriti → Shula (Drik)
      ['2000-01-01T12:38:00', 7], // Sukarma → Dhriti (Prokerala)
      ['2021-04-13T15:16:00', 1], // Vishkambha → Priti (Prokerala)
    ]) {
      expect(yoga(around(at, -3)), `${at} before`).toBe(before);
      expect(yoga(around(at, 3)), `${at} after`).toBe(before + 1);
    }
  });
});


const S = ['Ar', 'Ta', 'Ge', 'Cn', 'Le', 'Vi', 'Li', 'Sc', 'Sg', 'Cp', 'Aq', 'Pi'];
const at = (sign, deg, min = 0) => S.indexOf(sign) * 30 + deg + min / 60;
const v = (lon, n) => S[vargaSign(lon, n)];
const dms = (d, m, s) => d + m / 60 + s / 3600;

describe('the nine grahas against Drik Panchang (New Delhi, 2026-10-19 15:22:50 IST)', () => {
  const { grahas, trueRahu } = grahasOf(IST('2026-10-19T15:22:50'));
  const by = Object.fromEntries(grahas.map((g) => [g.key, g]));
  it('every graha within 30″ of Drik’s sidereal table (Drik runs ~22″ above the IAE mean); the Moon and Venus within 45″', () => {
    for (const [k, drik, tol] of [['sun', dms(181, 47, 46.95), 30], ['moon', dms(279, 52, 18.57), 45], ['jupiter', dms(118, 22, 57.12), 30],
      ['venus', dms(189, 20, 5.95), 45], ['saturn', dms(345, 54, 55.64), 30], ['rahu', dms(302, 29, 58.74), 30]]) {
      expect(Math.abs(by[k].sidereal - drik) * 3600, k).toBeLessThan(tol);
    }
    expect(Math.abs(trueRahu.sidereal - dms(303, 47, 55.28)) * 3600).toBeLessThan(30); // Drik's Spashta (true) Rahu
    expect([by.sun.nakshatra, by.sun.pada, by.moon.nakshatra, by.moon.pada, by.rahu.nakshatra, by.rahu.pada]).toEqual(['Chitra', 3, 'Uttara Ashadha', 4, 'Dhanishta', 3]);
    expect(by.ketu.sidereal).toBeCloseTo((by.rahu.sidereal + 180) % 360, 6);
    expect(grahas.map((g) => g.key)).toEqual(['sun', 'moon', 'mars', 'mercury', 'jupiter', 'venus', 'saturn', 'rahu', 'ketu']); // no Uranus, Neptune, Pluto
  });
});

describe('the divisional charts, by Parashara (PVR’s textbook examples)', () => {
  it('D3, D4, D7, D9, D10, D12, D16, D20, D24, D40, D45, D60', () => {
    expect([v(at('Ge', 3), 3), v(at('Ge', 19), 3), v(at('Ge', 21), 3)]).toEqual(['Ge', 'Li', 'Aq']);
    expect([v(at('Ta', 3), 4), v(at('Ta', 14), 4), v(at('Ta', 23), 4)]).toEqual(['Ta', 'Le', 'Aq']);
    expect([v(at('Ge', 10), 7), v(at('Vi', 19), 7)]).toEqual(['Le', 'Cn']);
    expect([v(at('Ge', 11), 9), v(at('Sc', 19), 9)]).toEqual(['Cp', 'Sg']);
    expect([v(at('Ge', 10), 10), v(at('Sc', 19), 10)]).toEqual(['Vi', 'Cp']);
    expect([v(at('Ge', 11), 12), v(at('Sc', 19), 12)]).toEqual(['Li', 'Ge']);
    expect([v(at('Ge', 11), 16), v(at('Sc', 19), 16), v(at('Ge', 11), 20), v(at('Sc', 19), 20), v(at('Ge', 11), 24), v(at('Sc', 19), 24)]).toEqual(['Ta', 'Ge', 'Pi', 'Sg', 'Ar', 'Li']);
    expect([v(at('Sc', 19), 27), v(at('Ge', 11), 40), v(at('Sc', 19), 40), v(at('Ge', 11), 45), v(at('Sc', 19), 45)]).toEqual(['Ge', 'Ge', 'Sc', 'Ar', 'Sg']);
    // (PVR's "Gemini 11°" D27 = Leo needs the book's minutes: 11°06′40″ is the Cancer/Leo boundary)
    expect([v(at('Sc', 12, 58), 60), v(at('Cp', 13, 25), 60)]).toEqual(['Sg', 'Pi']); // PVR Ex.26; Santhanam's BPHS note
  });
  it('all sixteen for PVR’s worked chart (Jupiter Sagittarius 29°49′) — vargottama in the navamsa', () => {
    const j = at('Sg', 29, 49);
    expect(SHODASAVARGA.filter((n) => n !== 1 && n !== 3).map((n) => v(j, n))).toEqual(['Cn', 'Vi', 'Ge', 'Sg', 'Vi', 'Sc', 'Pi', 'Pi', 'Cn', 'Ge', 'Li', 'Cn', 'Le', 'Sc']);
  });
});

describe('the Hindu calendar against Drik (tātkālika)', () => {
  const cal = (iso) => vedicCalendar(IST(iso), jyotisha(IST(iso), 0).tithi.number);
  it('2026-10-19: Ashvina, VS 2083 Siddharthi, Shaka 1948 Parabhava, Gujarati 2082, Kali 5127, Sharad, Dakshinayana', () => {
    expect(cal('2026-10-19T15:22:50')).toMatchObject({
      masa: { amanta: 'Ashvina', purnimanta: 'Ashvina', adhika: false },
      years: { vikram: 2083, shaka: 1948, gujarati: 2082, kali: 5127 },
      samvatsara: { northern: 'Siddharthi', southern: 'Parabhava', northernNow: 'Raudra' }, // the Jovian year turned 21 Apr 2026
      ritu: { vedic: 'Sharad', drik: 'Sharad' }, ayana: { tropical: 'Dakshinayana', sidereal: 'Dakshinayana' },
    });
  });
  it('the adhika months of 2023 (Shravana), 2026 (Jyeshtha) and 2029 (Chaitra)', () => {
    expect(cal('2023-08-15T12:00:00')).toMatchObject({ masa: { amanta: 'Shravana', adhika: true }, years: { vikram: 2080, shaka: 1945, gujarati: 2079 }, samvatsara: { northern: 'Nala', southern: 'Shobhakrit' } });
    expect(cal('2026-06-01T12:00:00').masa).toMatchObject({ amanta: 'Jyeshtha', adhika: true });
    expect(cal('2029-03-20T12:00:00').masa).toMatchObject({ amanta: 'Chaitra', adhika: true });
  });
  it('the waning half names the next month in the north; the two seasons and half-years can disagree', () => {
    expect(cal('2012-03-22T12:00:00')).toMatchObject({ masa: { purnimanta: 'Chaitra', amanta: 'Phalguna' }, ritu: { drik: 'Vasanta', vedic: 'Shishira' } });
    expect(cal('2026-01-01T12:00:00').ayana).toEqual({ tropical: 'Uttarayana', sidereal: 'Dakshinayana' });
    expect(cal('2026-07-01T12:00:00').ayana).toEqual({ tropical: 'Dakshinayana', sidereal: 'Uttarayana' });
  });
});

describe('the Vimshottari timeline (PyJHora’s published test 6: Chennai, 1996-12-07 10:34 IST, years of 365.256364 days)', () => {
  it('the mahadashas start within a day of the published dates — the first before the birth', () => {
    const birth = IST('1996-12-07T10:34:00');
    const d = vimshottari(grahasOf(birth).grahas[1].sidereal, birth.getTime(), 365.256364);
    const want = [['Rahu', '1996-07-16T01:12:44'], ['Jupiter', '2014-07-16T15:57:42'], ['Saturn', '2030-07-16T18:24:19'], ['Mercury', '2049-07-16T15:18:26'], ['Ketu', '2066-07-16T23:54:14']];
    for (const [i, [lord, start]] of want.entries()) {
      expect(d.mahadashas[i].lord).toBe(lord);
      expect(Math.abs(Date.parse(d.mahadashas[i].start) - IST(start).getTime()) / 86400000, lord).toBeLessThan(1);
    }
    expect(Date.parse(d.mahadashas[0].start)).toBeLessThan(birth.getTime());
  });
});

describe('the record carries it — and the aura’s field does not move', () => {
  it('a vedic block beside the untouched jyotisha block; varna named as left out', () => {
    const skies = buildSkies({ utc: '2026-07-21T20:23:00.000Z', epochMs: Date.parse('2026-07-21T20:23:00.000Z'), zone: 'Asia/Jakarta', offsetMinutes: 420 });
    expect(skies.systems.vedic.moon).toMatchObject({ lord: 'Rahu', deity: 'Vayu', gana: 'Deva', syllable: 'Ru' });
    expect(skies.systems.jyotisha.nakshatra).toMatchObject({ name: 'Swati', index: 15 }); // what the aura reads
    expect(skies.omitted.map((o) => o.system)).toContain('vedic-varna');
  });
});
