/**
 * THE AURA — derivation: identity in, a form that has already been judged out.
 *
 * A being is never handed the first thing its seed happens to draw. Each round
 * draws a TOURNAMENT of candidates, every one is surveyed across its whole
 * cycle, the failures are discarded and the best survivor is kept. If a round
 * yields no survivor the walk moves to the next block of counters — the same
 * seed, further along — so the guarantee never depends on luck, only on the
 * walk terminating. Whether it terminates is not asserted here; it is measured,
 * over tens of thousands of seeds, by `scripts/aura-sweep.mjs`.
 *
 * Deterministic end to end: the same identity yields the same aura on any
 * machine, in any year, with no registry and no stored state.
 *
 * Pure Math, no Node imports.
 */

import { AURA_CYCLE } from './form.js';
import { seedLanes } from './rng.js';
import { sampleParams } from './params.js';
import { archetypeOf } from './archetype.js';
import { surveyForm, SURVEY } from './gate.js';
import { modulateForm, LIFE_EXTREME } from './modulate.js';

export const AURA_SCHEMA = 'aura/v1';

/** Candidates judged per round, and how many rounds the walk may take. */
export const TOURNAMENT = 8;
export const MAX_ROUNDS = 24;

/**
 * Derive a being's aura. Pure.
 * @param {string} seedHex - 64 hex chars from `auraSeed()`
 * @param {object|null} skies - a `buildSkies()` reading, or null
 * @param {{survey?:object, tournament?:number, maxRounds?:number}} [opts]
 * @returns {object} frozen aura — throws only if the walk is exhausted
 */
export const deriveAura = (seedHex, skies = null, opts = {}) => {
  const survey = opts.survey ?? SURVEY;
  const tournament = opts.tournament ?? TOURNAMENT;
  const maxRounds = opts.maxRounds ?? MAX_ROUNDS;
  const lanes = seedLanes(seedHex);
  const archetype = archetypeOf(skies, lanes);

  for (let round = 0; round < maxRounds; round++) {
    let best = null;
    for (let slot = 0; slot < tournament; slot++) {
      const candidate = round * tournament + slot;
      const form = { ...archetype, p: sampleParams(lanes, candidate) };
      /* Judged with headroom, and at the far end of a life as well as at its
         start — a being must not be able to GROW into an aura we would have
         refused it, and the margin covers the life stages in between. */
      const verdict = surveyForm(form, survey, 1);
      if (!verdict.ok) continue;
      if (!surveyForm(modulateForm(form, LIFE_EXTREME), survey, 1).ok) continue;
      if (!best || verdict.score > best.verdict.score) best = { form, verdict, candidate };
    }
    if (!best) continue;
    return Object.freeze({
      schema: AURA_SCHEMA,
      seed: seedHex,
      cycle: AURA_CYCLE,
      archetype: best.form,
      params: best.form.p,
      fit: best.verdict.fit,
      round,
      candidate: best.candidate,
      score: best.verdict.score,
      motion: best.verdict.motion,
      descriptor: best.verdict.descriptor,
    });
  }
  throw new Error(`aura walk exhausted after ${maxRounds} rounds for seed ${seedHex.slice(0, 12)}…`);
};

/**
 * The renderable form alone — what the desk needs and nothing more. Pure.
 * @param {object} aura
 * @returns {{carrier:string, coupling:string, output:string, p:object}}
 */
export const formOf = (aura) => ({
  carrier: aura.archetype.carrier,
  coupling: aura.archetype.coupling,
  output: aura.archetype.output,
  p: aura.params,
});
