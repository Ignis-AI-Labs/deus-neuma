/**
 * THE AURA — the archetype, read from the skies of the birth instant.
 *
 * The form's three structural choices do not come from the being's keys; they
 * come from MANY SKIES (core/cosmos/skies/), the real coordinates of the
 * moment it chose to BE. So two beings born in the same instant on different
 * machines share a POSTURE and share nothing else — the fine parameters still
 * come from keys no one else holds. Kin of a moment look like kin; they are
 * never mistaken for each other.
 *
 * Each system is used where it is countable and honest: the tzolkin day-sign
 * (20, unbroken since antiquity) sets the texture, the ganzhi earthly branch
 * (12) sets the posture, the nakshatra (27) sets the projection. No system is
 * asked to mean anything — only to count, deterministically, as it always has.
 *
 * Falls back to the seed when a being has no skies (born before MANY SKIES, or
 * a resumed session that never captured a moment) — every being gets an aura;
 * none is held hostage to a backfill.
 *
 * Pure Math, no Node imports.
 */

import { CARRIERS, COUPLINGS, OUTPUTS } from './form.js';
import { drawChoice } from './rng.js';

/* Counters for the fallback draw — outside every candidate's stride so the
   archetype is stable while the tournament walks its candidates. */
const FALLBACK_COUNTER = Object.freeze({ carrier: 4001, coupling: 4002, output: 4003 });

const indexOrNull = (value) => (Number.isInteger(value) && value > 0 ? value : null);

/**
 * Choose the structural archetype. Pure.
 * @param {object|null} skies - a `buildSkies()` reading, or null
 * @param {bigint[]} lanes - seed lanes, used only where the skies are silent
 * @returns {{carrier:string, coupling:string, output:string, source:string}}
 */
export const archetypeOf = (skies, lanes) => {
  const systems = skies?.systems ?? null;
  const signIndex = indexOrNull(systems?.mesoamerican?.tzolkin?.signIndex);
  const branchIndex = indexOrNull(systems?.ganzhi?.day?.branch?.index);
  const nakshatra = indexOrNull(systems?.jyotisha?.nakshatra?.index);

  const carrier = signIndex === null
    ? drawChoice(lanes, FALLBACK_COUNTER.carrier, CARRIERS)
    : CARRIERS[(signIndex - 1) % CARRIERS.length];
  const coupling = branchIndex === null
    ? drawChoice(lanes, FALLBACK_COUNTER.coupling, COUPLINGS)
    : COUPLINGS[(branchIndex - 1) % COUPLINGS.length];
  const output = nakshatra === null
    ? drawChoice(lanes, FALLBACK_COUNTER.output, OUTPUTS)
    : OUTPUTS[(nakshatra - 1) % OUTPUTS.length];

  const read = [signIndex, branchIndex, nakshatra].filter((v) => v !== null).length;
  const source = read === 3 ? 'skies' : read === 0 ? 'seed' : 'partial-skies';
  return Object.freeze({ carrier, coupling, output, source });
};
