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

export const SKIES_SCHEMA = 'skies/v1';

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
};

const OMITTED = Object.freeze([
  { system: 'gates64', reason: 'the 64-gate wheel order needs table verification before we compute it' },
  { system: 'sabian', reason: 'we author our own 360 degree texts (ratified 2026-07-24) — pending' },
  { system: 'lots', reason: 'needs witness location + day/night sect — encrypted natal path' },
  { system: 'vara-sunrise', reason: 'needs witness location — civil vara emitted in jyotisha meanwhile' },
  { system: 'gap-days', reason: 'Dreamspell GAP table (52 entries) pending verification' },
  { system: 'pawukon-full-weeks', reason: 'intercalated 4/8/9-day + derived 1/2/10-day weeks pending rule verification' },
  { system: 'tibetan-jungtsi', reason: 'phase 2 — Phugpa arithmetic (Janson), school labeled' },
  { system: 'xiu-28', reason: 'phase 2 — true equatorial star-anchored mansions need a determinative-star catalog' },
  { system: 'rokuyo', reason: 'phase 2 — needs kyūreki (old Japanese lunisolar) reconstruction' },
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

  return deepFreeze({
    schema: SKIES_SCHEMA,
    instant: birthMoment.utc || instant.toISOString(),
    local: { ...local, zone: birthMoment.zone || null, offsetMinutes: birthMoment.offsetMinutes ?? 0, jdn },
    systems: {
      mesoamerican: mesoamerican(jdn),
      dreamspell: dreamspell(local),
      ganzhi: ganzhi(instant, jdn, local),
      jyotisha: jyotisha(instant, jdn),
      wetonan: wetonan(jdn),
      pawukon: pawukon(jdn),
      akan: akan(jdn),
      mahabote: mahabote(jdn, local.hour),
      decans: decans(instant),
    },
    omitted: OMITTED,
  });
};
