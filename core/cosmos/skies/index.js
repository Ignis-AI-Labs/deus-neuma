/**
 * MANY SKIES — the multi-system reading of a being's birth moment.
 *
 * One sealed instant, read through humanity's calendrical and astronomical
 * systems (Founder's directive, 2026-07-24; design: docs/architecture/identity/many-skies.md).
 * SHINKEI: every coordinate is a real, deterministic function of the instant;
 * every system carries an honest provenance label; systems we cannot compute
 * honestly are listed as omitted WITH the reason — never silently dropped.
 *
 * Location law: everything here depends only on the instant (+ its sealed
 * timezone offset for local civil dates), so skies.json may live as plaintext
 * beside the genesis seal. Any future location-bearing output (angles, lots,
 * sunrise-based vara) MUST ride the encrypted natal path instead.
 *
 * Like the natal chart, the skies live OUTSIDE genesisHash — backfillable to
 * every being already born without disturbing any seal.
 */

import { jdnFromCivil, localCivil, mesoamerican, wetonan, pawukon, akan, mahabote } from './daycount.js';
import { dreamspell } from './dreamspell.js';
import { ganzhi } from './ganzhi.js';
import { jyotisha } from './jyotisha.js';
import { decans } from './binnings.js';
import { lunisolar } from './lunisolar.js';
import { xiu } from './xiu.js';
import { tibetan, nineStar } from './tibetan.js';
import { thai } from './thai.js';
import { vedic } from './vedic.js';
import { adaduananOf } from './world-days.js';
import { worldSkies } from './world.js';

export const SKIES_SCHEMA = 'skies/v1';

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
};

const OMITTED = Object.freeze([
  { system: 'sabian-texts', reason: 'the degree index is computed; we author our own 360 degree texts (ratified 2026-07-24) — pending' },
  { system: 'lots', reason: 'needs witness location + day/night sect — encrypted natal path' },
  { system: 'vara-sunrise', reason: 'needs witness location — civil vara emitted in jyotisha meanwhile' },
  { system: 'gap-days', reason: 'Dreamspell GAP table (52 entries) pending verification' },
  { system: 'pawukon-full-weeks', reason: 'intercalated 4/8/9-day + derived 1/2/10-day weeks pending rule verification' },
  { system: 'tibetan-parkha', reason: 'parkha is counted from the sex of the born (male from Li, female from Kham) or from the mother\'s age; a neuma has neither, and we will not assign one' },
  { system: 'kyusei-day-star', reason: 'the day star\'s solstice switch and its 閏 realignment differ between almanacs — no single published rule' },
  { system: 'kyusei-month-star', reason: 'the month star\'s starting value per year group has no published vector yet' },
  { system: 'vedic-varna', reason: 'the varna (caste class) mappings disagree three ways, and a caste hierarchy is not assigned to a being (ruled 2026-10-19)' },
  { system: 'vedic-d60-flags', reason: 'the benefic/malefic flags of the D60 parts disagree between sources and are interpretation, not coordinate' },
  { system: 'thai-lagna', reason: 'the Thai ascendant runs from the birthplace\'s sunrise — it belongs on the private place, not in plaintext skies' },
  { system: 'thai-life-periods', reason: 'the 108-year Mahathaksa life periods, the eight daily watches and the yearly lucky days were not verified against two sources — not shown until they are' },
  { system: 'balinese-sasih', reason: 'council-decreed rules changed 1971/1993/2000/2001; 1993–2002 contested — pending era-versioned rules' },
  { system: 'armenian', reason: 'the published epoch (11 July 552) and the printed year starts disagree by two days — held until one source settles it' },
  { system: 'hijri-sighting', reason: 'a month begun by sighting the crescent depends on who saw it and where — Umm al-Qura and the tabular count are shown instead' },
  { system: 'burmese-lunisolar', reason: 'the Myanmar lunisolar date (its watat intercalation by era) is pending a verified port' },
  { system: 'xiuhpohualli', reason: 'the Aztec 365-day year\'s correlation is contested — held until a third independent vector agrees' },
  { system: 'mandaean', reason: 'the published anchors of its 365-day year conflict — held' },
  { system: 'solar-term-pentad-names', reason: 'the pentad is counted; the 72 names wait for a verified source' },
  { system: 'human-design-type', reason: 'type, authority, channels and centres are the system\'s interpretation, not a coordinate — the gates and lines are shown' },
  { system: 'numerology', reason: 'the life-path methods (Balliett, 1905) conflict with each other, and the number is a digit artefact, not a coordinate' },
  { system: 'uranian', reason: 'the Hamburg school\'s hypothetical planets do not exist' },
  { system: 'asteroids', reason: 'Chiron and the asteroids need an ephemeris we do not carry — not now' },
  { system: 'civil-locked', reason: 'the Saka national, Bangladeshi, Nanakshahi, Graves tree (1948) and Yoruba Kọ́jọ́dá calendars are fixed to the Gregorian date by decree — whether to show them is pending' },
  { system: 'coligny', reason: 'the Gaulish bronze has no agreed alignment to our days' },
  { system: 'slavic', reason: 'no pre-Christian Slavic calendar survives; the "Slavic horoscope" is a late-20th-century invention' },
  { system: 'yoruba-ose', reason: 'the published anchors of the four-day Ọ̀sẹ̀ disagree by two days — held' },
  { system: 'ifa', reason: 'not computable by design — a birth Odù is revealed only through Ìtẹ̀fá initiation, never a date; computing one would be fabrication' },
]);

/**
 * Read one birth moment through every v1 system.
 * @param {{utc:string, epochMs:number, zone?:string, offsetMinutes?:number}} birthMoment
 *   A sealed birth moment (the genesis seal's own shape).
 * @returns {object} deep-frozen skies reading
 */
export const buildSkies = (birthMoment) => {
  if (!birthMoment || typeof birthMoment.epochMs !== 'number') {
    throw new Error('buildSkies requires a birthMoment with epochMs');
  }
  const instant = new Date(birthMoment.epochMs);
  const local = localCivil(birthMoment);
  const jdn = jdnFromCivil(local.year, local.month, local.day);
  const tibet = tibetan(instant);
  const jyot = jyotisha(instant, jdn);

  return deepFreeze({
    schema: SKIES_SCHEMA,
    instant: birthMoment.utc || instant.toISOString(),
    local: { ...local, zone: birthMoment.zone || null, offsetMinutes: birthMoment.offsetMinutes ?? 0, jdn },
    systems: {
      mesoamerican: mesoamerican(jdn),
      dreamspell: dreamspell(local),
      ganzhi: ganzhi(instant, jdn, local),
      jyotisha: jyot,
      wetonan: wetonan(jdn),
      pawukon: pawukon(jdn),
      akan: { ...akan(jdn), adaduanan: adaduananOf(jdn) },
      mahabote: mahabote(jdn, local.hour),
      decans: decans(instant),
      // East Asia (2026-10-19): the lunisolar date at four meridians + rokuyō, the 28 lodges, Tibet, the nine star
      lunisolar: lunisolar(instant),
      xiu: xiu(instant, jdn),
      tibetan: tibet,
      nineStar: nineStar(instant, tibet.year),
      // Thailand (2026-10-19): Thaksa, the birth day's colour and Buddha, the eras, the year animal, the lunar date
      thai: thai(instant, birthMoment.offsetMinutes ?? 0),
      // the whole Vedic chart (2026-10-19): the nine grahas, D9, the Moon's nakshatra tables, the dasha timeline, the calendar
      vedic: vedic(instant, jyot),
      // the world (2026-10-19): Hebrew, Hijri, Ethiopian, Egyptian, Zoroastrian, Igbo, Persian, Bahá'í, French, Icelandic, the 819-day count,
      // the nengō; the Arabic mansions, the 64 gates, the solar terms, the western additions
      ...worldSkies(instant, jdn, local),
    },
    omitted: OMITTED,
  });
};
