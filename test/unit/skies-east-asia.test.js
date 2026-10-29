// skies-east-asia — the East Asian skies against PUBLISHED vectors
// (docs/architecture/identity/many-skies-east-asia.md): the lunisolar date at
// China's, Japan's, Korea's and Vietnam's meridians (Hong Kong Observatory,
// arachne.jp, Kye/SNU, Hồ Ngọc Đức), rokuyō (arachne.jp, benri.jp), the
// almanac day-duty lodge (Chinese almanacs, KOYOMI NOTE, the Jōkyō and Western
// Xia records), the Phugpa Losar (CTA, Tibetan Nuns Project), the nine-star and
// mewa years (Buddha Weekly, tibastro). The Moon's own lodge has no published
// vector — its geometry is proven instead. Real engine, real astronomy; no mocks.
import { describe, it, expect } from 'vitest';
import { lunarDateAt, meridianOf, rokuyoOf, lunisolar } from '../../core/cosmos/skies/lunisolar.js';
import { dayMansion, moonMansion, mansionStartsAt, MANSIONS } from '../../core/cosmos/skies/xiu.js';
import { losarJdn, phugpaDate, tibetanYearName, nineStar } from '../../core/cosmos/skies/tibetan.js';
import { jdnFromCivil } from '../../core/cosmos/skies/daycount.js';
import { buildSkies } from '../../core/cosmos/skies/index.js';

const OFFSET = { china: 480, vietnam: 420, japan: 540, korea: 540 };
const lunar = (iso, where) => {
  const r = lunarDateAt(new Date(`${iso}T05:00:00Z`), { offset: OFFSET[where] }, where === 'china');
  return `${r.leap ? 'L' : ''}${r.month}/${r.day}`;
};
const isoOf = (jd) => new Date((jd - 2440588) * 86400000).toISOString().slice(0, 10);

describe('the lunisolar date', () => {
  it('China (HKO): new years, a mid-winter date, leap months — 2033 included', () => {
    for (const [d, want] of [['2026-02-17', '1/1'], ['2026-01-01', '11/13'], ['2025-01-29', '1/1'], ['2025-07-25', 'L6/1'], ['2023-03-22', 'L2/1'],
      ['2024-02-10', '1/1'], ['2027-02-06', '1/1'], ['2033-12-22', 'L11/1'], ['1984-11-23', 'L10/1'], ['1985-02-20', '1/1'], ['1978-09-03', '8/1']]) {
      expect(lunar(d, 'china'), d).toBe(want);
    }
  });
  it('the meridian is objective: Vietnam’s Tết a month early in 1985; Korea’s and Japan’s own new years and leap months', () => {
    for (const [d, want] of [['1985-01-21', '1/1'], ['2007-02-17', '1/1'], ['2030-02-02', '1/1'], ['2053-02-18', '1/1']]) expect(lunar(d, 'vietnam'), d).toBe(want);
    for (const [d, want] of [['1997-02-08', '1/1'], ['2027-02-07', '1/1'], ['2028-01-27', '1/1'], ['2040-09-21', '8/15']]) expect(lunar(d, 'korea'), d).toBe(want);
    for (const [d, want] of [['2012-04-21', 'L3/1'], ['2017-06-24', 'L5/1']]) expect(lunar(d, 'japan'), d).toBe(want);
  });
  it('the meridians in force: Beijing’s before 1929, Vietnam on China’s before 1968', () => {
    expect(meridianOf('china', Date.UTC(1920, 0, 1)).label).toMatch(/Beijing/);
    expect(meridianOf('vietnam', Date.UTC(1960, 0, 1)).offset).toBe(480);
    expect(meridianOf('vietnam', Date.UTC(1990, 0, 1)).offset).toBe(420);
  });
  it('the year name follows the lunar new year — the Snake until 2026-02-17, the Horse after', () => {
    expect(lunarDateAt(new Date('2026-02-10T05:00:00Z'), { offset: 480 }, true)).toMatchObject({ year: 2025, animal: 'Snake' });
    expect(lunarDateAt(new Date('2026-02-17T05:00:00Z'), { offset: 480 }, true)).toMatchObject({ year: 2026, animal: 'Horse', yearName: 'bǐng-wǔ' });
  });
});

describe('rokuyō, on the Japanese reading', () => {
  it('matches the published almanacs', () => {
    for (const [d, want] of [['2026-01-01', '大安'], ['2026-10-19', '大安'], ['2025-07-24', '大安'], ['2025-07-25', '赤口'],
      ['2017-06-23', '先負'], ['2017-06-24', '大安'], ['2012-04-20', '友引'], ['2012-04-21', '先負']]) {
      expect(lunisolar(new Date(`${d}T05:00:00Z`)).rokuyo.kanji, d).toBe(want);
    }
    expect(rokuyoOf({ month: 5, day: 1 }).kanji).toBe('大安'); // a leap month uses its own number
  });
});

describe('the 28 lodges', () => {
  it('the almanac day-duty lodge, unbroken from 1201 to today', () => {
    for (const [y, m, d, want] of [[2024, 1, 1, '毕'], [2025, 1, 1, '参'], [1950, 1, 1, '虚'], [2025, 1, 9, '角'], [2025, 1, 12, '房'], [2026, 10, 19, '心']]) {
      expect(dayMansion(jdnFromCivil(y, m, d)).hanzi, `${y}-${m}-${d}`).toBe(want);
    }
    // 1201-06-03 Julian = 1201-06-10 proleptic Gregorian, a Sunday — Western Xia 天庆八年五月朔
    expect(dayMansion(jdnFromCivil(1201, 6, 10)).hanzi).toBe('星');
    expect(dayMansion(jdnFromCivil(1685, 2, 4)).hanzi).toBe('星'); // the Jōkyō calendar's first day, a Sunday
  });
  it('the Moon’s lodge: the 28 widths close the circle, 觜 stays narrow and positive, a determinative star opens its own lodge', () => {
    const date = new Date('2026-07-21T20:23:00Z');
    const starts = mansionStartsAt(date);
    const widths = starts.map((s, i) => ((starts[(i + 1) % 28] - s) % 360 + 360) % 360);
    expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(360, 6);
    expect(widths[19]).toBeGreaterThan(0);
    expect(widths[19]).toBeLessThan(3);
    const m = moonMansion(date);
    expect(MANSIONS[m.index].hanzi).toBe(m.hanzi);
    expect(m.du).toBeGreaterThanOrEqual(0);
    expect(m.du).toBeLessThan(m.widthDu);
  });
});

describe('Tibet and the nine star', () => {
  it('every published Phugpa Losar, 2022–2027', () => {
    for (const [y, want] of [[2022, '2022-03-03'], [2023, '2023-02-21'], [2024, '2024-02-10'], [2025, '2025-02-28'], [2026, '2026-02-18'], [2027, '2027-02-07']]) {
      expect(isoOf(losarJdn(y)), String(y)).toBe(want);
    }
    expect(phugpaDate(losarJdn(2026))).toMatchObject({ year: 2026, month: 1, day: 1, element: 'Fire', gender: 'Male', animal: 'Horse', rabjung: 17, rabjungYear: 40 });
    expect(phugpaDate(losarJdn(2026) - 1)).toMatchObject({ year: 2025, month: 12, day: 30, animal: 'Snake' });
    expect(tibetanYearName(2027)).toMatchObject({ element: 'Fire', gender: 'Female', animal: 'Sheep' });
  });
  it('one number, two boundaries: the kyūsei year star at risshun, the mewa at Losar', () => {
    for (const [y, star, colour] of [[2024, 3, 'blue'], [2025, 2, 'black'], [2026, 1, 'white']]) {
      const n = nineStar(new Date(Date.UTC(y, 5, 1)), y);
      expect(n.risshun.star, String(y)).toBe(star);
      expect(n.losar).toMatchObject({ mewa: star, colour });
    }
    expect(nineStar(new Date(Date.UTC(1942, 5, 1)), 1942).losar).toMatchObject({ mewa: 4, life: 1, power: 7 });
    // between risshun (2022-02-04) and Losar (2022-03-03) the two readings differ — both kept
    const between = nineStar(new Date('2022-02-20T05:00:00Z'), 2021);
    expect(between.risshun.star).not.toBe(between.losar.mewa);
  });
});

describe('the record carries them, with what was left out and why', () => {
  it('four new systems; parkha and the contested stars named as omitted', () => {
    const skies = buildSkies({ utc: '2026-07-21T20:23:00.000Z', epochMs: Date.parse('2026-07-21T20:23:00.000Z'), zone: 'Asia/Jakarta', offsetMinutes: 420 });
    expect(Object.keys(skies.systems)).toEqual(expect.arrayContaining(['lunisolar', 'xiu', 'tibetan', 'nineStar']));
    const omitted = skies.omitted.map((o) => o.system);
    expect(omitted).toEqual(expect.arrayContaining(['tibetan-parkha', 'kyusei-day-star', 'kyusei-month-star', 'ifa']));
    expect(omitted).not.toContain('xiu-28');
  });
});
