/**
 * MANY SKIES — the Tibetan calendar (Phugpa school), and the nine-star number
 * it shares with China and Japan.
 *
 * TIBETAN: a purely arithmetic lunisolar calendar — fixed rational mean
 * motions and two small correction tables, no observation (Janson, […], §5–§9, epoch E806; reproduces every published Phugpa
 * Losar 1927–2046). Labels carried: school Phugpa; moon-anomaly step 1/28 as
 * the Dharamsala almanac prints it; the day runs dawn to dawn, read here at
 * 05:00 mean solar time at Lhasa (OUR convention — the tradition publishes no
 * rule for converting an instant). The year: element, gender and animal on the
 * same sixty-year cycle as China's, turning at Losar; the rabjung count.
 * Parkha is NOT computed: it needs the born one's sex or the mother's age.
 *
 * NINE STAR (九星 · 紫白 · sme ba): one Lo Shu number per year, descending —
 * the Japanese kyūsei and Chinese 紫白 year star turning at risshun (the Sun at
 * 315°), the Tibetan birth mewa turning at Losar. The same number, two
 * boundaries — both kept, never merged. Day star omitted (almanacs disagree);
 * month star omitted until it has a published vector.
 * Research + vectors: docs/architecture/identity/many-skies-east-asia.md §3, §4.4.
 * Pure.
 */
import * as Astronomy from 'astronomy-engine';

const amod = (n, m) => ((((n - 1) % m) + m) % m) + 1;
const frac = (x) => x - Math.floor(x);
const Y0 = 806; const M0 = 3; const BETA_STAR = 61; const BETA = 123;
const LHASA_DAWN = 91.1 / 360 - 5 / 24; // the day's turn at 05:00 Lhasa mean solar time, in days

// the correction tables: moon (period 28, quarter 0..7) and sun (period 12, quarter 0..3), linear between
const tab = (quarter, period, x) => {
  const at = (i) => {
    const k = ((i % period) + period) % period;
    const q = period / 4;
    if (k <= q) return quarter[k];
    if (k <= 2 * q) return quarter[2 * q - k];
    return -at(k - 2 * q);
  };
  const i = Math.floor(x);
  return at(i) + (at(i + 1) - at(i)) * (x - i);
};
const MOON_TAB = [0, 5, 10, 15, 19, 22, 24, 25];
const SUN_TAB = [0, 6, 10, 11];

/** The civil JDN on which lunar day d of true month n ends. Pure. */
export const tithiEnd = (n, d) => {
  const meanDate = n * 167025 / 5656 + d * 11135 / 11312 + 2015501 + 4783 / 5656;
  const meanSun = n * 65 / 804 + d * 13 / 4824 + 743 / 804;
  const anomaly = n * 253 / 3528 + d / 28 + 475 / 3528;
  const trueDate = meanDate + tab(MOON_TAB, 28, 28 * frac(anomaly)) / 60 - tab(SUN_TAB, 12, 12 * frac(meanSun - 1 / 4)) / 60;
  return Math.floor(trueDate);
};

/** The year, month and leap flag of true month n. Pure. */
export const monthOf = (n) => {
  const x = Math.ceil((65 * n + BETA) / 67);
  return { year: Math.ceil(x / 12) - 1 + Y0, month: amod(x, 12), leap: [1, 2].includes(((65 * n + BETA) % 67 + 67) % 67) };
};

const ELEMENTS = Object.freeze(['Wood', 'Fire', 'Earth', 'Iron', 'Water']);
const ANIMALS = Object.freeze(['Mouse', 'Ox', 'Tiger', 'Rabbit', 'Dragon', 'Snake', 'Horse', 'Sheep', 'Monkey', 'Bird', 'Dog', 'Pig']);

/** A Tibetan year's name — element, gender, animal — and its rabjung count. Pure. */
export const tibetanYearName = (year) => {
  const p = amod(year - 3, 60); // 1 = Wood-Male-Mouse
  return Object.freeze({
    element: ELEMENTS[Math.floor((p - 1) / 2) % 5],
    gender: p % 2 === 1 ? 'Male' : 'Female',
    animal: ANIMALS[(p - 1) % 12],
    rabjung: Math.ceil((year - 1026) / 60),
    rabjungYear: amod(year - 1026, 60),
  });
};

/** The Tibetan civil day number (JDN) of an instant — dawn to dawn at Lhasa. Pure. */
export const tibetanDayOf = (date) => Math.floor(date.getTime() / 86400000 + 2440588 + LHASA_DAWN);

/**
 * The Phugpa date of a Tibetan civil day: its month (and leap), and its lunar
 * day — skipped numbers never appear; a repeated number is marked. Pure.
 * @param {number} jd Tibetan civil JDN
 */
export const phugpaDate = (jd) => {
  // an estimate of the true month, then walk lunar days to the first that ends on or after jd
  let n = Math.floor((jd - 2015501) / (167025 / 5656)) - 1;
  for (;;) {
    for (let d = 1; d <= 30; d += 1) {
      const end = tithiEnd(n, d);
      if (end >= jd) {
        const m = monthOf(n);
        return Object.freeze({ ...m, day: d, repeated: end > jd, ...tibetanYearName(m.year) });
      }
    }
    n += 1;
  }
};

/** Losar of a Tibetan year: the civil JDN after day 30 of the previous year's twelfth (regular) month. Pure. */
export const losarJdn = (year) => {
  // the true month count of month 12 of year − 1 (regular, not leap)
  const mStar = 12 * (year - 1 - Y0) + 12 - M0;
  const n = Math.floor((67 * mStar + BETA_STAR + 17) / 65);
  return tithiEnd(n, 30) + 1;
};

const KYUSEI = Object.freeze(['一白水星', '二黒土星', '三碧木星', '四緑木星', '五黄土星', '六白金星', '七赤金星', '八白土星', '九紫火星']);
const MEWA_COLOUR = Object.freeze(['white', 'black', 'blue', 'green', 'yellow', 'white', 'red', 'white', 'maroon']);

/** The nine-star numbers of an instant: the risshun-year star, and the Losar-year mewa with its life and power. Pure. */
export const nineStar = (date, tibetanYear) => {
  const lichun = Astronomy.SearchSunLongitude(315, new Date(Date.UTC(date.getUTCFullYear(), 0, 15)), 60).date;
  const y = date >= lichun ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
  const star = ((10 - (y % 9)) % 9) + 1;
  const central = amod(2 - tibetanYear, 9);
  return {
    provenance: { kind: 'ancient', school: 'Lo Shu numbers (九宮 · 紫白); Japanese kyūsei school (Sonoda, 1909); Tibetan Jungtsi mewa', note: 'one number, two year boundaries — risshun (kyūsei) and Losar (mewa); day star omitted (almanacs disagree), month star omitted (no published vector yet)' },
    risshun: { year: y, star, name: KYUSEI[star - 1] },
    losar: { year: tibetanYear, mewa: central, colour: MEWA_COLOUR[central - 1], life: amod(central - 3, 9), power: amod(central + 3, 9) },
  };
};

/** The Tibetan block of one birth. Pure. */
export const tibetan = (date) => {
  const at = phugpaDate(tibetanDayOf(date));
  return {
    provenance: { kind: 'ancient-living', school: 'Phugpa (Men-Tsee-Khang / Dharamsala almanac), moon-anomaly step 1/28', note: 'the Tibetan day runs dawn to dawn — read at 05:00 Lhasa mean solar time (our convention, labelled); parkha not computed: it needs the born one\'s sex or the mother\'s age, and a neuma has neither' },
    ...at,
  };
};
