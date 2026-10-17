/**
 * MANY SKIES — Chinese Four Pillars (BaZi) + zodiac (ancient-living).
 *
 * The decisive research finding (2026-07-24): classical Ziping BaZi is SOLAR,
 * not lunar. The year pillar changes at lichun (sun at 315°), the month pillar
 * at the 12 jié solar terms (every 30° of solar longitude) — never at lunar
 * boundaries. The whole chart therefore computes from the real sun longitude
 * (astronomy-engine) + unbroken sexagenary day arithmetic + local clock time.
 *
 * Declared school options (labeled in the output, deliberately fixed in v1):
 * year boundary = lichun (the folk zodiac animal flips at Lunar New Year — a
 * divergence window we label, not hide); day boundary = local civil midnight
 * (the traditional 23:00 zi-hour roll is a labeled pending option); hour from
 * standard clock time (true-solar-time correction pending).
 *
 * Day-pillar anchor verified: JDN 2458511 (2019-01-27) = jiǎzǐ.
 */

import * as Astronomy from 'astronomy-engine';
import { eclipticLongitude } from '../natal-chart.js';

const posMod = (n, m) => ((n % m) + m) % m;

export const STEMS = Object.freeze([
  { pinyin: 'jiǎ', element: 'wood', polarity: 'yang' },
  { pinyin: 'yǐ', element: 'wood', polarity: 'yin' },
  { pinyin: 'bǐng', element: 'fire', polarity: 'yang' },
  { pinyin: 'dīng', element: 'fire', polarity: 'yin' },
  { pinyin: 'wù', element: 'earth', polarity: 'yang' },
  { pinyin: 'jǐ', element: 'earth', polarity: 'yin' },
  { pinyin: 'gēng', element: 'metal', polarity: 'yang' },
  { pinyin: 'xīn', element: 'metal', polarity: 'yin' },
  { pinyin: 'rén', element: 'water', polarity: 'yang' },
  { pinyin: 'guǐ', element: 'water', polarity: 'yin' },
]);
export const BRANCHES = Object.freeze([
  { pinyin: 'zǐ', animal: 'Rat' }, { pinyin: 'chǒu', animal: 'Ox' },
  { pinyin: 'yín', animal: 'Tiger' }, { pinyin: 'mǎo', animal: 'Rabbit' },
  { pinyin: 'chén', animal: 'Dragon' }, { pinyin: 'sì', animal: 'Snake' },
  { pinyin: 'wǔ', animal: 'Horse' }, { pinyin: 'wèi', animal: 'Goat' },
  { pinyin: 'shēn', animal: 'Monkey' }, { pinyin: 'yǒu', animal: 'Rooster' },
  { pinyin: 'xū', animal: 'Dog' }, { pinyin: 'hài', animal: 'Pig' },
]);

// Han-dynasty gua qi (卦氣): the 12 sovereign hexagrams (bìguà) mapped to the
// solar-term months as the yin/yang waxing-waning wheel, from the winter-
// solstice month (Rat) = hexagram 24 (Fù, Return). Ancient, labeled.
const SOVEREIGN_HEXAGRAMS = Object.freeze([24, 19, 11, 34, 43, 1, 44, 33, 12, 20, 23, 2]);

const pillar = (stemIndex, branchIndex) => ({
  stem: { index: stemIndex, ...STEMS[stemIndex] },
  branch: { index: branchIndex, ...BRANCHES[branchIndex] },
  name: `${STEMS[stemIndex].pinyin}-${BRANCHES[branchIndex].pinyin}`,
});

/**
 * The Four Pillars at an instant.
 * @param {Date} instant - the UTC instant (for the sun's real longitude)
 * @param {number} jdn - JDN of the LOCAL civil date
 * @param {{year:number, month:number, hour:number}} local - local civil parts
 */
export const ganzhi = (instant, jdn, local) => {
  const sunLon = eclipticLongitude(Astronomy.Body.Sun, instant);

  // Month index from solar longitude: Tiger month opens at lichun (315°).
  const m = Math.floor(posMod(sunLon - 315, 360) / 30); // 0 = Tiger month
  // The Chinese year opens at lichun: a Jan/Feb birth before 315° belongs to
  // the previous year's pillar.
  const chineseYear = local.year - ((local.month <= 2 && sunLon < 315) ? 1 : 0);

  const yearStem = posMod(chineseYear - 4, 10);
  const yearBranch = posMod(chineseYear - 4, 12);
  const monthBranch = posMod(2 + m, 12);
  const monthStem = posMod(2 * (yearStem % 5) + 2 + m, 10); // Five Tigers rule
  const dayStem = posMod(jdn - 1, 10);
  const dayBranch = posMod(jdn + 1, 12);
  const hourBranch = Math.floor(posMod(local.hour + 1, 24) / 2); // zǐ = 23:00–00:59
  const hourStem = posMod(2 * (dayStem % 5) + hourBranch, 10); // Five Rats rule

  return {
    provenance: {
      kind: 'ancient-living',
      school: {
        yearBoundary: 'lichun (folk zodiac flips at Lunar New Year — labeled divergence window)',
        dayBoundary: 'local civil midnight (23:00 zi-hour roll = pending labeled option)',
        time: 'standard clock (true-solar-time correction = pending labeled option)',
      },
    },
    year: pillar(yearStem, yearBranch),
    month: pillar(monthStem, monthBranch),
    day: pillar(dayStem, dayBranch),
    hour: pillar(hourStem, hourBranch),
    zodiac: {
      animal: BRANCHES[yearBranch].animal,
      element: STEMS[yearStem].element,
      polarity: STEMS[yearStem].polarity,
    },
    sovereignHexagram: {
      provenance: { kind: 'ancient', note: 'Han-dynasty gua qi — the month\'s sovereign hexagram (bìguà)' },
      number: SOVEREIGN_HEXAGRAMS[posMod(m - 10, 12)],
    },
  };
};
