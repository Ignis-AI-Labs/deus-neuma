// skies-thai — the Thai skies against PUBLISHED vectors
// (docs/architecture/identity/many-skies-thai.md): Thaksa (Paksasuk 2013 and
// the Thai naming manuals), the 06:00 day and the Wednesday-night split, the
// thaloengsok instants (myhora's Songkran announcements, to the second), the
// eras (Calendar Years Act 1941), the year animal under both Thai boundaries
// (myhora), and the lunar date (myhora 2026; Bank of Thailand holy days
// 2016–2027) — including the years where the official calendar departs from
// the rule, which the engine must say rather than hide. No mocks.
import { describe, it, expect } from 'vitest';
import { thai, thaiBirthGroup, thaksaOf, thaloengsokMs, thaiErasOf } from '../../core/cosmos/skies/thai.js';
import { thaiLunarOfJdn, thaiLunarStanding } from '../../core/cosmos/skies/thai-lunar.js';
import { jdnFromCivil } from '../../core/cosmos/skies/daycount.js';

const BKK = 420;
const lunar = (y, m, d) => {
  const r = thaiLunarOfJdn(jdnFromCivil(y, m, d));
  return `${r.phase === 'waxing' ? 'ขึ้น' : 'แรม'} ${r.phaseDay} / ${r.second8 ? '8หลัง' : r.month}`;
};

describe('Thaksa', () => {
  it('the wheel and its roles', () => {
    expect(thaksaOf(2).map((r) => r.planet)).toEqual([2, 3, 4, 7, 5, 8, 6, 1]); // Monday: บริวาร Moon … กาลกิณี Sun
    expect(thaksaOf(1)[7].name).toBe('Venus'); // Sunday's กาลกิณี
    expect(thaksaOf(4).map((r) => r.name).slice(5)).toEqual(['Sun', 'Moon', 'Mars']); // Wednesday day: อุตสาหะ Sun, มนตรี Moon, กาลกิณี Mars
  });
  it('the Thai day runs from 06:00; Wednesday 18:00 to dawn is Rahu', () => {
    expect(thaiBirthGroup(Date.parse('2026-10-14T20:00:00Z'), BKK)).toBe(8); // civil Thursday 03:00 → Wednesday night
    expect(thaiBirthGroup(Date.parse('2026-10-13T20:00:00Z'), BKK)).toBe(3); // civil Wednesday 03:00 → Tuesday
    expect(thaiBirthGroup(Date.parse('2026-10-14T05:00:00Z'), BKK)).toBe(4); // Wednesday noon → Mercury
    expect(thaiBirthGroup(Date.parse('2026-10-14T11:00:00Z'), BKK)).toBe(8); // Wednesday 18:00 → Rahu
    expect(thaiBirthGroup(Date.UTC(1927, 11, 5, 5), BKK)).toBe(2); // King Rama IX, a Monday
  });
  it('the birth day’s colour and Buddha follow the same eight groups', () => {
    const b = thai(new Date(Date.UTC(1932, 7, 12, 5)), BKK); // Queen Sirikit, a Friday
    expect(b.group).toMatchObject({ colour: 'light blue', buddha: 'รำพึง' });
    expect(thai(new Date(Date.UTC(1978, 5, 3, 5)), BKK).group.colour).toBe('purple'); // Queen Suthida, a Saturday
  });
});

describe('the eras', () => {
  it('thaloengsok to the second, in Jakarta local mean time', () => {
    const lmt = (cs) => new Date(thaloengsokMs(cs) + 402 * 60000).toISOString().slice(0, 19);
    expect(lmt(1388)).toBe('2026-04-16T14:40:12');
    expect(lmt(1378)).toBe('2016-04-16T00:34:12');
    expect(lmt(1356)).toBe('1994-04-16T07:57:00');
  });
  it('the Buddhist Era and the Chula Sakarat year with its ศก', () => {
    expect(thaiErasOf(Date.parse('2019-06-01T00:00:00Z'), BKK)).toMatchObject({ be: 2562, cs: 1381, sok: 'เอกศก' });
    expect(thaiErasOf(Date.parse('2026-04-16T07:00:00Z'), BKK).cs).toBe(1387); // an hour before thaloengsok
    expect(thaiErasOf(Date.parse('2026-04-16T09:00:00Z'), BKK).cs).toBe(1388);
    expect(thaiErasOf(Date.parse('1940-02-01T00:00:00Z'), BKK).be).toBe(2482); // the year still began 1 April
    expect(thaiErasOf(Date.parse('1941-01-02T00:00:00Z'), BKK).be).toBe(2484);
  });
});

describe('the year animal, by both Thai boundaries', () => {
  it('astrology turns it at the first waxing day of month 5; the official calendar at month 1', () => {
    expect(thai(new Date('2026-01-01T05:00:00Z'), BKK).animal).toMatchObject({ astrology: { thai: 'ปีมะเส็ง' }, official: { thai: 'ปีมะเมีย' } });
    expect(thai(new Date('2026-12-31T05:00:00Z'), BKK).animal.astrology.thai).toBe('ปีมะเมีย');
    expect(thai(new Date('2025-11-21T05:00:00Z'), BKK).animal.official.thai).toBe('ปีมะเมีย');
  });
});

describe('the Thai lunar date', () => {
  it('myhora’s 2026 calendar, a leap-month year, day by day', () => {
    for (const [m, d, want] of [[1, 1, 'ขึ้น 13 / 2'], [3, 3, 'ขึ้น 15 / 4'], [3, 19, 'ขึ้น 1 / 5'], [4, 13, 'แรม 11 / 5'], [5, 31, 'ขึ้น 15 / 7'],
      [7, 29, 'ขึ้น 15 / 8หลัง'], [7, 30, 'แรม 1 / 8หลัง'], [11, 24, 'ขึ้น 15 / 12'], [12, 10, 'ขึ้น 1 / 1'], [12, 31, 'แรม 7 / 1']]) {
      expect(lunar(2026, m, d), `2026-${m}-${d}`).toBe(want);
    }
  });
  it('the Bank of Thailand holy days, 2023–2027 — each the full moon of its month', () => {
    for (const [y, m, d, want] of [[2023, 3, 6, 'ขึ้น 15 / 4'], [2023, 6, 3, 'ขึ้น 15 / 7'], [2023, 8, 1, 'ขึ้น 15 / 8หลัง'], [2024, 2, 24, 'ขึ้น 15 / 3'],
      [2024, 7, 20, 'ขึ้น 15 / 8'], [2025, 5, 11, 'ขึ้น 15 / 6'], [2025, 7, 10, 'ขึ้น 15 / 8'], [2027, 2, 21, 'ขึ้น 15 / 3'], [2027, 7, 18, 'ขึ้น 15 / 8']]) {
      expect(lunar(y, m, d), `${y}-${m}-${d}`).toBe(want);
    }
  });
  it('where the official calendar departs from the rule, the engine says so — it never claims the published date', () => {
    expect(lunar(2016, 2, 22)).toBe('ขึ้น 14 / 3'); // published Makha Bucha 2016 = ขึ้น 15: the rule is a day behind here
    expect(thaiLunarStanding(2016)).toMatch(/may differ by one day/);
    expect(lunar(2000, 1, 1)).toBe('แรม 9 / 1'); // myhora: แรม 10
    expect(thaiLunarStanding(2000)).toMatch(/may differ by one day/);
    expect(thaiLunarStanding(2026)).toMatch(/matches the published calendar/);
  });
});
