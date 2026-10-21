/**
 * MANY SKIES — the East Asian lunisolar date (农历 · 旧暦 · 음력 · âm lịch).
 *
 * One published astronomical rule (the 1645 Shixian rules as codified in
 * GB/T 33661-2017; Aslaksen 2010 §4): a month begins on the civil day of the
 * new moon; the month holding the December solstice is the 11th; in a
 * solstice-to-solstice year of 13 months, the first month without a major
 * solar term (zhōngqì) is the leap month and repeats the number before it.
 * The tradition fixes its own meridian, so the date is a function of the
 * instant alone — and the meridian is objective: the same rule read at China's
 * 120°E, Japan's and Korea's 135°E and Vietnam's 105°E gives really different
 * published dates in some years (Tết 1985 a month before Chinese New Year).
 * Research + vectors: docs/architecture/identity/many-skies-east-asia.md §1, §4, §5.
 *
 * Near midnight the promulgated table, not our ephemeris, is the authority: the
 * two months where astronomy-engine puts the new moon seconds after 00:00
 * UTC+8 and the Hong Kong Observatory table does not are PINNED (§1.5).
 * Pure.
 */
import * as Astronomy from 'astronomy-engine';
import { STEMS, BRANCHES } from './ganzhi.js';

const DAY = 86400000;
const posMod = (n, m) => ((n % m) + m) % m;

// The new moons the Hong Kong Observatory places one civil day earlier than
// the ephemeris (computed 16:00:40 and 16:00:15 UTC) — local date index → table's
const PINNED_CHINA = new Map([[Date.UTC(2057, 8, 29) / DAY, -1], [Date.UTC(2097, 7, 8) / DAY, -1]]);

/** The meridian each reading uses at an instant (minutes east of UTC), and its label. Pure. */
export const meridianOf = (reading, epochMs) => {
  const before = (y, m, d) => epochMs < Date.UTC(y, m - 1, d) - 8 * 3600000;
  if (reading === 'china') return before(1929, 1, 1) ? { offset: 465 + 40 / 60, label: 'Beijing 116°25′E (imperial)' } : { offset: 480, label: '120°E (UTC+8)' };
  if (reading === 'japan') return { offset: 540, label: '135°E (UTC+9)' };
  if (reading === 'korea') return before(1912, 1, 1) ? meridianOf('china', epochMs) : { offset: 540, label: '135°E (UTC+9)' };
  if (reading === 'vietnam') return before(1968, 1, 1) ? meridianOf('china', epochMs) : { offset: 420, label: '105°E (UTC+7)' };
  throw new Error(`unknown lunisolar reading: ${reading}`);
};

const civilOf = (date, offset) => Math.floor((date.getTime() + offset * 60000) / DAY);
const solstice = (year) => Astronomy.SearchSunLongitude(270, new Date(Date.UTC(year, 11, 1)), 40).date;

/**
 * The lunisolar date of an instant at one meridian. Pure.
 * @param {Date} instant
 * @param {{offset: number}} meridian minutes east of UTC
 * @param {boolean} [pinChina] apply the published table's near-midnight pins (China only)
 * @returns {{year: number, month: number, leap: boolean, day: number, yearName: string, animal: string}}
 */
export const lunarDateAt = (instant, { offset }, pinChina = false) => {
  const civil = (date) => {
    const c = civilOf(date, offset);
    return pinChina ? c + (PINNED_CHINA.get(c) ?? 0) : c;
  };
  const d = civilOf(instant, offset);
  const gy = new Date(d * DAY).getUTCFullYear();

  // every new moon from well before last year's solstice to well after next year's
  const moons = [];
  for (let t = new Date(Date.UTC(gy - 1, 9, 1)); t < new Date(Date.UTC(gy + 2, 2, 1));) {
    const nm = Astronomy.SearchMoonPhase(0, t, 40).date;
    moons.push(civil(nm));
    t = new Date(nm.getTime() + DAY);
  }
  const monthHolding = (day) => moons.reduce((at, start, i) => (start <= day ? i : at), -1);
  // the solstice-to-solstice year holding the date
  let a = monthHolding(civil(solstice(gy - 1)));
  let b = monthHolding(civil(solstice(gy)));
  let from = solstice(gy - 1);
  if (d >= moons[b]) { a = b; b = monthHolding(civil(solstice(gy + 1))); from = solstice(gy); }

  // the civil days of the twelve major terms through that year
  const terms = [];
  for (let k = 1, t = from; k <= 12; k += 1) {
    t = Astronomy.SearchSunLongitude((270 + 30 * k) % 360, t, 40).date;
    terms.push(civil(t));
  }
  const holdsTerm = (i) => terms.some((z) => z >= moons[i] && z < moons[i + 1]);
  const leapYear = b - a === 13;

  let number = 11;
  let leapUsed = false;
  let found = { month: 11, leap: false, start: moons[a] };
  for (let i = a + 1; i < b; i += 1) {
    const leap = leapYear && !leapUsed && !holdsTerm(i);
    if (leap) leapUsed = true; else number = (number % 12) + 1;
    if (moons[i] <= d) found = { month: number, leap, start: moons[i] };
  }
  const gMonth = new Date(d * DAY).getUTCMonth() + 1;
  const year = found.month >= 11 && gMonth <= 2 ? gy - 1 : gy;
  const stem = posMod(year - 4, 10);
  const branch = posMod(year - 4, 12);
  return Object.freeze({
    year, month: found.month, leap: found.leap, day: d - found.start + 1,
    yearName: `${STEMS[stem].pinyin}-${BRANCHES[branch].pinyin}`,
    animal: BRANCHES[branch].animal,
  });
};

// 六曜 on the Japanese reading: (month + day) mod 6
const ROKUYO = Object.freeze([
  { name: 'Taian', kanji: '大安' }, { name: 'Shakkō', kanji: '赤口' }, { name: 'Senshō', kanji: '先勝' },
  { name: 'Tomobiki', kanji: '友引' }, { name: 'Senbu', kanji: '先負' }, { name: 'Butsumetsu', kanji: '仏滅' },
]);
/** The rokuyō of a Japanese (kyūreki) date. Pure. */
export const rokuyoOf = ({ month, day }) => ROKUYO[(month + day) % 6];

/**
 * The lunisolar block: the date read at each meridian the living traditions
 * use, and the rokuyō of the Japanese reading. Pure.
 * @param {Date} instant
 */
export const lunisolar = (instant) => {
  const epochMs = instant.getTime();
  const read = (reading) => {
    const m = meridianOf(reading, epochMs);
    return Object.freeze({ ...lunarDateAt(instant, m, reading === 'china' && m.offset === 480), meridian: m.label });
  };
  const japan = read('japan');
  return {
    provenance: {
      kind: 'ancient-living',
      school: 'Shixian rules (1645, true sun) as codified in GB/T 33661-2017; Japan: Tenpō rule (Hirayama 1912) — identical but for 2033-34, contested (leap 11th month recommended)',
      note: 'each reading at its tradition\'s own meridian; near-midnight new moons pinned to the Hong Kong Observatory table (2057-09, 2097-08)',
    },
    china: read('china'),
    japan,
    korea: read('korea'),
    vietnam: read('vietnam'),
    rokuyo: { ...rokuyoOf(japan), provenance: 'medieval import (Chinese 小六壬), Edo-popularised; on the Japanese reading' },
  };
};
