/**
 * MANY SKIES — the Dreamspell / 13-Moon galactic signature.
 *
 * HONEST PROVENANCE (binding): this is José & Lloydine Argüelles' 1987–1991
 * system — a modern esoteric count that is NOT the traditional Maya calendar
 * (its own creators say so). It uses the Tzolk'in's 13×20 mathematics with a
 * different anchor and it SKIPS Feb 29 entirely, so it drifts against the
 * unbroken living daykeeper count (+44 kin as of 2024–2027). We compute both,
 * side by side, labeled — the honest way to carry a modern practice.
 *
 * Anchor verified against four published vectors (2026-07-24 research pass):
 * 1987-07-26 = Kin 34; 2012-12-21 = Kin 207 Blue Crystal Hand;
 * 2013-07-26 = Kin 164; 1992-07-26 = Kin 39.
 */

import { jdnFromCivil } from './daycount.js';

const posMod = (n, m) => ((n % m) + m) % m;

export const DREAMSPELL_ANCHOR_JDN = 2447003; // 1987-07-26
export const DREAMSPELL_ANCHOR_KIN = 34;

export const SOLAR_SEALS = Object.freeze([
  'Red Dragon', 'White Wind', 'Blue Night', 'Yellow Seed', 'Red Serpent',
  'White World-Bridger', 'Blue Hand', 'Yellow Star', 'Red Moon', 'White Dog',
  'Blue Monkey', 'Yellow Human', 'Red Skywalker', 'White Wizard', 'Blue Eagle',
  'Yellow Warrior', 'Red Earth', 'White Mirror', 'Blue Storm', 'Yellow Sun',
]);
export const GALACTIC_TONES = Object.freeze([
  'Magnetic', 'Lunar', 'Electric', 'Self-Existing', 'Overtone', 'Rhythmic',
  'Resonant', 'Galactic', 'Solar', 'Planetary', 'Spectral', 'Crystal', 'Cosmic',
]);
const CASTLES = Object.freeze([
  'Red Eastern Castle of Turning', 'White Northern Castle of Crossing',
  'Blue Western Castle of Burning', 'Yellow Southern Castle of Giving',
  'Green Central Castle of Enchantment',
]);

const isLeapYear = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Proleptic-Gregorian civil date of a JDN (standard inverse, floor arithmetic). */
const civilFromJdn = (jdn) => {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor(146097 * b / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor(1461 * d / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return {
    year: 100 * b + d - 4800 + Math.floor(m / 10),
    month: m + 3 - 12 * Math.floor(m / 10),
    day: e - Math.floor((153 * m + 2) / 5) + 1,
  };
};

/** Count Feb 29 dates in the JDN interval (fromExclusive, toInclusive]; signed. */
const countLeapDays = (fromJdnExclusive, toJdnInclusive) => {
  if (toJdnInclusive < fromJdnExclusive) {
    return -countLeapDays(toJdnInclusive, fromJdnExclusive);
  }
  let count = 0;
  const firstYear = civilFromJdn(fromJdnExclusive).year;
  const lastYear = civilFromJdn(toJdnInclusive).year;
  for (let y = firstYear; y <= lastYear; y++) {
    if (!isLeapYear(y)) continue;
    const j = jdnFromCivil(y, 2, 29);
    if (j > fromJdnExclusive && j <= toJdnInclusive) count++;
  }
  return count;
};

const guideOffset = (tone) => {
  const r = tone % 5;
  if (r === 1) return 0;
  if (r === 2) return 12;
  if (r === 3) return 4;
  if (r === 4) return 16;
  return 8; // r === 0 (tones 5, 10)
};

/**
 * The Dreamspell galactic signature for a LOCAL civil date.
 * Feb 29 has no kin ("0.0 Hunab Ku"); for births the official rule applies —
 * before local noon reads as Feb 28, after as Mar 1. The caller passes the
 * local date + hour; the adjustment is performed and labeled here.
 */
export const dreamspell = ({ year, month, day, hour = 12 }) => {
  let y = year, m = month, d = day, leapDayAdjusted = false;
  if (month === 2 && day === 29) {
    leapDayAdjusted = true;
    if (hour < 12) { d = 28; } else { m = 3; d = 1; }
  }
  const jdn = jdnFromCivil(y, m, d);
  const counted = (jdn - DREAMSPELL_ANCHOR_JDN) - countLeapDays(DREAMSPELL_ANCHOR_JDN, jdn);
  const kin = posMod(DREAMSPELL_ANCHOR_KIN - 1 + counted, 260) + 1;
  const tone = posMod(kin - 1, 13) + 1;
  const seal = posMod(kin - 1, 20) + 1;
  const analogSeal = posMod(19 - seal, 20) === 0 ? 20 : posMod(19 - seal, 20);
  return {
    provenance: {
      kind: 'modern-1987',
      note: 'Argüelles Dreamspell — a modern system distinct from the traditional Maya count; skips Feb 29',
      ...(leapDayAdjusted ? { leapDayAdjusted: true } : {}),
    },
    kin,
    tone: { number: tone, name: GALACTIC_TONES[tone - 1] },
    seal: { number: seal, name: SOLAR_SEALS[seal - 1] },
    signature: `${SOLAR_SEALS[seal - 1].split(' ')[0]} ${GALACTIC_TONES[tone - 1]} ${SOLAR_SEALS[seal - 1].split(' ').slice(1).join(' ')}`,
    wavespell: Math.floor((kin - 1) / 13) + 1,
    castle: CASTLES[Math.floor((kin - 1) / 52)],
    earthFamily: posMod(kin - 1, 5) + 1,
    oracle: {
      analog: SOLAR_SEALS[analogSeal - 1],
      antipode: SOLAR_SEALS[posMod(seal + 9, 20)],
      occult: { seal: SOLAR_SEALS[21 - seal - 1], tone: GALACTIC_TONES[14 - tone - 1] },
      guide: SOLAR_SEALS[posMod(seal - 1 + guideOffset(tone), 20)],
    },
    // GAP (Galactic Activation Portal) days are a 52-entry lookup table —
    // omitted in v1 pending table verification; said, not silently dropped.
  };
};
