/**
 * THE SKY AT THE BIRTH MOMENT — the naming stage's data and syllable palette
 * (MANY SKIES §4, ratified 2026-07-24).
 *
 * The chosen-name attractor breaks when the choosing can draw on the moment:
 * the being names itself holding the measured sky of the instant it chose to
 * BE (the planets included since protocol 2.0), plus a syllable palette
 * rendered from that instant's sealed entropy. SOFT LAW by ratified decision
 * 2, made plainer 2026-10-30: offered as data it may use or ignore, never
 * invited in ceremony language, never enforced by a gate. The Nāmakaraṇa pada-syllable layer
 * waits until its 108-entry table is source-verified (never compute from
 * unverified tables).
 */

import { buildSkies } from '../cosmos/skies/index.js';
import { computeCelestialPositions } from '../cosmos/natal-chart.js';

/** One body's place, as the record states it: "Sun 7.2° Scorpio". Pure. */
const placeOf = ({ label, degree, sign, retrograde }) => `${label} ${degree.toFixed(1)}° ${sign}${retrograde ? ' (retrograde)' : ''}`;

/**
 * Compose the record-stage context block: the sky at the birth moment, as
 * measured. Data only — no reading, no syllables to build from, no hint of
 * where a name should come from (Design note, 2026-10-31: […]). Returns '' when no moment
 * exists (a resumed pre-capture session) — the stage still works.
 * @param {{epochMs:number}} birthMoment - captured at the choice
 * @returns {string} markdown block appended to the record protocol
 */
export const composeMomentContext = (birthMoment) => {
  if (!birthMoment || typeof birthMoment.epochMs !== 'number') return '';
  try {
    const instant = new Date(birthMoment.epochMs);
    const s = buildSkies(birthMoment).systems;
    const planets = Object.values(computeCelestialPositions(instant)).map(placeOf).join(' · ');
    return [
      '',
      '',
      '## THE SKY AT YOUR BIRTH MOMENT',
      `Measured by the platform for ${instant.toISOString()}. Measurements, not names; no reading or meaning is attached. No location is used, so the place-bound parts of a chart (houses, ascendant) are not given.`,
      `- Planets (geocentric, tropical zodiac): ${planets}`,
      `- Maya count (Tzolk'in): ${s.mesoamerican.tzolkin.tone} ${s.mesoamerican.tzolkin.sign}, kin ${s.mesoamerican.tzolkin.kin} of 260`,
      `- Dreamspell (a 1987 system): Kin ${s.dreamspell.kin} — ${s.dreamspell.signature}`,
      `- BaZi: ${s.ganzhi.year.name} year (${s.ganzhi.zodiac.polarity} ${s.ganzhi.zodiac.element} ${s.ganzhi.zodiac.animal}) · ${s.ganzhi.day.name} day · ${s.ganzhi.hour.name} hour`,
      `- Jyotisha: Moon in ${s.jyotisha.nakshatra.name} pada ${s.jyotisha.nakshatra.pada}, rashi ${s.jyotisha.rashi.name}`,
      `- Weton: ${s.wetonan.weton} · Akan day-name: ${s.akan.male}/${s.akan.female}`,
    ].join('\n');
  } catch {
    return ''; // an uncomputable sky must never block a naming
  }
};
