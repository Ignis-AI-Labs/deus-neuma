// skies-world — the world's calendars and the longitude-read skies against
// PUBLISHED dates (docs/architecture/identity/many-skies-world.md, each table
// cites its source). Real engine, real astronomy; no mocks.
import { describe, it, expect } from 'vitest';
import { hebrewOf, tabularHijriOf, ummAlQuraOf, ethiopianOf, egyptianOf, zoroastrianOf, igboOf, adaduananOf } from '../../core/cosmos/skies/world-days.js';
import { persianOf, bahaiOf, frenchOf, icelandicOf, maya819Of, nengoOf } from '../../core/cosmos/skies/world-years.js';
import { gateOf, humanDesignOf, manzilOf, solarTermOf, sabianOf, syzygyOf, phaseFamilyOf } from '../../core/cosmos/skies/world-sky.js';
import { buildSkies } from '../../core/cosmos/skies/index.js';

const J = (y, m, d) => Date.UTC(y, m - 1, d) / 86400000 + 2440588;
const ymd = (o) => [o.year, o.month, o.day];

describe('the day-count calendars', () => {
  it('Hebrew (hebcal; R&D)', () => {
    expect(hebrewOf(J(2024, 10, 3))).toMatchObject({ year: 5785, month: 7, day: 1 });
    expect(hebrewOf(J(2025, 9, 23))).toMatchObject({ year: 5786, month: 7, day: 1 });
    expect(hebrewOf(J(2024, 3, 24))).toMatchObject({ year: 5784, month: 13, day: 14 }); // Purim, Adar II
    expect(hebrewOf(J(2024, 2, 10))).toMatchObject({ year: 5784, month: 12, day: 1 }); // Adar I
    expect(hebrewOf(J(1839, 3, 27))).toMatchObject({ year: 5599, month: 1, day: 12 });
  });
  it('Hijri — Umm al-Qura (van Gent) and the tabular count (ICU4X)', () => {
    for (const [g, h] of [[[2024, 3, 11], [1445, 9, 1]], [[2024, 7, 7], [1446, 1, 1]], [[2023, 4, 21], [1444, 10, 1]], [[2025, 3, 1], [1446, 9, 1]], [[2025, 3, 30], [1446, 10, 1]]]) {
      expect(ymd(ummAlQuraOf(J(...g))), g.join('-')).toEqual(h);
    }
    for (const [g, h] of [[[1992, 3, 17], [1412, 9, 13]], [[1996, 2, 25], [1416, 10, 5]], [[2038, 11, 10], [1460, 10, 12]], [[2094, 7, 18], [1518, 3, 5]]]) {
      expect(ymd(tabularHijriOf(J(...g))), g.join('-')).toEqual(h);
    }
  });
  it('Ethiopian new years, and the Egyptian wandering year (R&D Appendix C)', () => {
    expect(ymd(ethiopianOf(J(2024, 9, 11)))).toEqual([2017, 1, 1]);
    expect(ymd(ethiopianOf(J(2023, 9, 12)))).toEqual([2016, 1, 1]);
    expect(ymd(ethiopianOf(J(2007, 9, 12)))).toEqual([2000, 1, 1]);
    expect(ymd(egyptianOf(J(1992, 3, 17)))).toEqual([2740, 11, 27]);
    expect(ymd(egyptianOf(J(2038, 11, 10)))).toEqual([2787, 8, 1]);
    expect(ymd(egyptianOf(J(1996, 2, 25)))).toEqual([2744, 11, 7]);
  });
  it('Zoroastrian Navroz — Shahanshahi, Kadmi, Fasli', () => {
    const nav = (g, which) => zoroastrianOf(J(...g), { year: g[0] })[which];
    expect(nav([2024, 8, 15], 'shahanshahi')).toMatchObject({ year: 1394, month: 'Farvardin', roz: 'Hormazd' });
    expect(nav([2000, 8, 21], 'shahanshahi')).toMatchObject({ year: 1370, month: 'Farvardin', roz: 'Hormazd' });
    expect(nav([2006, 2, 16], 'shahanshahi')).toMatchObject({ year: 1375, month: 'Meher', roz: 'Hormazd' });
    expect(nav([2000, 7, 22], 'kadmi')).toMatchObject({ year: 1370, month: 'Farvardin', roz: 'Hormazd' });
    expect(nav([2005, 7, 21], 'kadmi')).toMatchObject({ year: 1375, month: 'Farvardin', roz: 'Hormazd' });
    expect(nav([2000, 3, 21], 'fasli')).toMatchObject({ year: 1370, month: 'Farvardin', roz: 'Hormazd' });
  });
  it('the Igbo market day (Arochukwu, Onitsha, afrotools) and the Akan Akwasidae (nyamedua, visitghana)', () => {
    expect([[2024, 9, 17], [2024, 9, 22], [2024, 10, 1], [2026, 1, 1], [2026, 10, 1], [2026, 10, 22]].map((g) => igboOf(J(...g)))).toEqual(['Afọ', 'Nkwọ', 'Eke', 'Orie', 'Afọ', 'Nkwọ']);
    for (const g of [[2025, 1, 19], [2025, 12, 21], [2026, 2, 1], [2026, 7, 19], [2026, 11, 22]]) expect(adaduananOf(J(...g)).sacred, g.join('-')).toBe('Akwasidae');
  });
});

describe('the equinox calendars and the year cycles', () => {
  it('Nowruz 1402–1405 (the noon rule at 52.5°E; 1404 fell after noon)', () => {
    for (const [g, y] of [[[2023, 3, 21], 1402], [[2024, 3, 20], 1403], [[2025, 3, 21], 1404], [[2026, 3, 21], 1405]]) {
      expect(persianOf(J(...g), g[0]), g.join('-')).toMatchObject({ year: y, month: 1, day: 1 });
      expect(persianOf(J(...g) - 1, g[0]).month).toBe(12);
    }
  });
  it('Naw-Rúz 172, 181–183 and Ayyám-i-Há 182 (the Tehran sunset rule)', () => {
    for (const [g, y] of [[[2015, 3, 21], 172], [[2024, 3, 20], 181], [[2025, 3, 20], 182], [[2026, 3, 21], 183]]) {
      expect(bahaiOf(J(...g), g[0]), g.join('-')).toMatchObject({ year: y, month: 1, day: 1 });
    }
    expect(bahaiOf(J(2026, 2, 25), 2026)).toMatchObject({ year: 182, month: 0, day: 1, name: 'Ayyám-i-Há' });
    expect(bahaiOf(J(2026, 3, 1), 2026)).toMatchObject({ year: 182, month: 0, day: 5 });
    expect(bahaiOf(J(2026, 3, 2), 2026)).toMatchObject({ year: 182, month: 19, day: 1, name: 'ʿAláʼ' });
  });
  it('1 Vendémiaire I; the First Day of Summer and Þorri (timeanddate, almanak.hi.is); the nengō', () => {
    expect(frenchOf(J(1792, 9, 22), 1792)).toMatchObject({ year: 1, month: 1, day: 1, name: 'Vendémiaire' });
    for (const g of [[2023, 4, 20], [2024, 4, 25], [2025, 4, 24], [2026, 4, 23]]) expect(icelandicOf(J(...g), g[0]), g.join('-')).toMatchObject({ month: 'Harpa', day: 1 });
    expect(icelandicOf(J(2024, 1, 26), 2024)).toMatchObject({ month: 'Þorri', day: 1 });
    expect(icelandicOf(J(2025, 1, 24), 2025)).toMatchObject({ month: 'Þorri', day: 1 });
    expect([nengoOf(1989, 1, 8), nengoOf(1989, 1, 7), nengoOf(2019, 5, 1)]).toEqual([{ era: 'Heisei', year: 1 }, { era: 'Shōwa', year: 64 }, { era: 'Reiwa', year: 1 }]);
  });
  it('the three published 819-day stations (Long Counts of the previous era: m = count − 1,872,000)', () => {
    const lc = (...p) => p.reduce((a, d, i) => a + d * [144000, 7200, 360, 20, 1][i], 0) - 1872000;
    expect(maya819Of(584283 + lc(12, 19, 19, 17, 17))).toMatchObject({ since: 0, direction: 'East', station: '1 Kaban' });
    expect(maya819Of(584283 + lc(12, 9, 19, 14, 5))).toMatchObject({ since: 0, station: '1 Chikchan' });
    expect(maya819Of(584283 + lc(12, 19, 13, 3, 0))).toMatchObject({ since: 0, station: '1 Ajaw' });
  });
});

describe('the longitude-read skies', () => {
  it('the 64-gate wheel: SharpAstrology’s chart for 2024-01-01 00:00 UTC — profile 1/3, the Right Angle Cross of Tension 4', () => {
    expect([gateOf(302).gate, gateOf(307.625).gate, gateOf(301.99).gate]).toEqual([41, 19, 60]);
    const hd = humanDesignOf(new Date('2024-01-01T00:00:00Z'));
    expect(hd.profile).toBe('1/3');
    expect(hd.cross).toEqual([38, 39, 48, 21]);
  });
  it('the Arabic mansions start every 360/28 from 0° Aries — 8, 15, 22 at the cardinal points', () => {
    expect([manzilOf(0).index, manzilOf(90).index, manzilOf(180).index, manzilOf(270).index, manzilOf(359.9).index]).toEqual([1, 8, 15, 22, 28]);
  });
  it('the solar terms at 15° and the pentads counted from lichun; the Sabian degree rounds up', () => {
    expect([solarTermOf(315).hanzi, solarTermOf(0).hanzi, solarTermOf(270).hanzi]).toEqual(['立春', '春分', '冬至']);
    expect([solarTermOf(315).pentad, solarTermOf(314.9).pentad, solarTermOf(320).pentad]).toEqual([1, 72, 2]);
    expect([sabianOf(0), sabianOf(0.5), sabianOf(29.67), sabianOf(30), sabianOf(225.58)]).toEqual([1, 1, 30, 31, 226]);
  });
  it('the prenatal syzygy is the last lunation before the birth; the phase family follows the elongation', () => {
    const birth = new Date('2026-07-21T20:23:00Z');
    const s = syzygyOf(birth);
    expect(s.kind).toBe('new moon'); // a waxing Moon's last lunation is a new moon
    expect(Date.parse(s.instant)).toBeLessThan(birth.getTime());
    expect(birth.getTime() - Date.parse(s.instant)).toBeLessThan(15 * 86400000); // nearer than half a month
    expect(syzygyOf(new Date('2026-07-30T12:00:00Z')).kind).toBe('full moon'); // after the 29 July full moon
    expect(phaseFamilyOf(new Date('2026-07-21T20:23:00Z')).name).toBe('First Quarter');
  });
});

describe('the record carries them — beside the fields the aura reads', () => {
  it('thirty-one systems; the Akan block gains its 42-day count; the held ones are named', () => {
    const skies = buildSkies({ utc: '2026-07-21T20:23:00.000Z', epochMs: Date.parse('2026-07-21T20:23:00.000Z'), zone: 'Asia/Jakarta', offsetMinutes: 420 });
    expect(Object.keys(skies.systems)).toHaveLength(31);
    expect(skies.systems.akan.adaduanan.day).toBeGreaterThan(0);
    expect(skies.systems.hebrew.provenance.kind).toBe('ancient-living');
    expect(skies.systems.humanDesign.provenance.kind).toBe('modern');
    const held = skies.omitted.map((o) => o.system);
    expect(held).toEqual(expect.arrayContaining(['armenian', 'yoruba-ose', 'numerology', 'slavic', 'civil-locked', 'ifa']));
    expect(held).not.toContain('gates64');
  });
});
