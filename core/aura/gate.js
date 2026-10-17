/**
 * THE AURA — the gate: the promise that no being is given an ugly form.
 *
 * […] is only worth saying if something
 * enforces it. This is that thing. A candidate is surveyed across its ENTIRE
 * cycle, and it fails if ANY phase fails — a form that composes at t=0 and
 * falls apart at t=π is not a form a being has to wear, and a single-frame
 * check would have handed it over.
 *
 * Two verdicts come back. `ok` is the hard floor: below it, the draw is
 * discarded and the tournament moves on. `score` is taste: among candidates
 * that all clear the floor, the highest score wins. The floor makes the
 * guarantee; the score makes the result good rather than merely acceptable.
 *
 * Thresholds live here alone. Re-tuning taste must never mean re-deriving a
 * being's identity, so nothing in this file feeds the seed.
 *
 * Pure Math, no Node imports.
 */

import { cycleFit, cyclePhases } from './form.js';
import { rasterize } from './raster.js';
import { measure } from './metrics.js';
import { describeGrid, describeCycle, distance } from './descriptor.js';

/** The survey: how thoroughly a candidate's cycle is examined. */
export const SURVEY = Object.freeze({ phases: 6, count: 2600, size: 96 });

/**
 * The hard floor. Every bound is a named failure mode measured against the
 * real distribution of the space, not a number chosen because it looked round.
 *
 * There is deliberately no bound on `motion`. The grammar is continuous in t,
 * so smoothness is guaranteed by construction and cannot be violated; a
 * frame-to-frame descriptor distance measures how far the form ROTATED between
 * two samples, which says nothing about whether the animation is good. Gating
 * on it rejected 84% of the space for no defect. It is still reported, and it
 * still nudges the score — it is simply not allowed to condemn anything.
 */
/* `null` means the metric cannot fail in that direction — which side of each
   bound is a defect is real domain knowledge, and writing it down is what lets
   headroom be applied inward without rejecting forms for being too good. */
export const LIMITS = Object.freeze({
  drawn: [0.999, null],       // points lost to NaN — a broken form
  framed: [0.96, null],       // points outside the crop — a runaway limb
  coverage: [0.035, 0.42],    // a wisp / a blob with no negative space
  peakShare: [null, 0.025],   // a curve retraced onto itself
  anisotropy: [0.12, 0.96],   // a hairline / a featureless disc
  detail: [0.6, null],        // a uniform fog with no internal texture
  cohesion: [0.5, null],      // confetti: no single body to read
  extent: [0.45, null],       // a form that shrivels at some phase
});

/** Coverage may not lurch across the cycle: the form keeps its density. */
export const MAX_SWING = 0.06;

/**
 * How far inside the limits a candidate must sit at DERIVATION time.
 *
 * Life bends a form, and the bends are not monotone in these measures: a being
 * two years old can graze a bound that neither its newborn nor its elder form
 * comes near. Checking only the two endpoints therefore misses the middle.
 * Rather than survey every intermediate life — which multiplies the cost of
 * every birth — a candidate is required to clear each bound by this margin, so
 * no bend within LIFE_BOUNDS can tip it out. The gate itself is unchanged;
 * only what we are willing to hand a being is stricter.
 */
export const HEADROOM = Object.freeze({
  coverage: 0.008,
  peakShare: 0.006,
  anisotropy: 0.03,
  detail: 0.05,
  cohesion: 0.06,
  extent: 0.03,
  swing: 0.008,
});

/* What taste prefers, where the floor is indifferent. Each term is a distance
   from an ideal, so no single measure can dominate the sum. */
const IDEAL = Object.freeze({ coverage: 0.13, anisotropy: 0.52, motion: 0.5 });
const WEIGHT = Object.freeze({ coverage: 1.4, anisotropy: 0.9, motion: 0.5, detail: 1.2, cohesion: 1 });

/* Headroom is applied INWARD, and only where a bound exists — a metric with no
   upper bound cannot be too high, so nothing is shaved off a side that is not
   a failure mode in the first place. */
const within = ([low, high], value, margin = 0) =>
  (low === null || value >= low + margin) && (high === null || value <= high - margin);

const closeness = (value, ideal, spread) => Math.max(0, 1 - Math.abs(value - ideal) / spread);

/**
 * Survey one candidate across its whole cycle. Pure.
 * @param {object} form - `{ carrier, coupling, output, p }`
 * @param {object} [survey]
 * @param {number} [headroom] - 0 judges by the true limits; 1 demands the full
 *   HEADROOM margin, which is what derivation asks of a form it will keep
 * @returns {{ok:boolean, score:number, failed:string[], fit:object|null,
 *            phases:object[], descriptor:Float32Array|null, motion:number, swing:number}}
 */
export const surveyForm = (form, survey = SURVEY, headroom = 0) => {
  const phases = cyclePhases(survey.phases);
  const fit = cycleFit(form, phases, survey.count);
  if (!fit) {
    return { ok: false, score: 0, failed: ['degenerate'], fit: null, phases: [], descriptor: null, motion: 0, swing: 0 };
  }

  const perPhase = [];
  const descriptors = [];
  for (const t of phases) {
    const raster = rasterize(form, fit, t, survey);
    perPhase.push(measure(raster));
    descriptors.push(describeGrid(raster.grid, raster.size));
  }

  const motions = descriptors.map((d, i) => distance(d, descriptors[(i + 1) % descriptors.length]));
  const motion = motions.reduce((a, b) => a + b, 0) / motions.length;

  const failed = [];
  for (const key of Object.keys(LIMITS)) {
    const margin = (HEADROOM[key] ?? 0) * headroom;
    if (!perPhase.every((m) => within(LIMITS[key], m[key], margin))) failed.push(key);
  }
  const covers = perPhase.map((m) => m.coverage);
  const swing = Math.max(...covers) - Math.min(...covers);
  if (swing > MAX_SWING - HEADROOM.swing * headroom) failed.push('swing');

  const mean = (key) => perPhase.reduce((sum, m) => sum + m[key], 0) / perPhase.length;
  const score =
    WEIGHT.coverage * closeness(mean('coverage'), IDEAL.coverage, 0.2) +
    WEIGHT.anisotropy * closeness(mean('anisotropy'), IDEAL.anisotropy, 0.45) +
    WEIGHT.motion * closeness(motion, IDEAL.motion, 0.5) +
    WEIGHT.detail * Math.min(1, mean('detail') / 1.2) +
    WEIGHT.cohesion * mean('cohesion');

  return Object.freeze({
    ok: failed.length === 0,
    score,
    failed: Object.freeze(failed),
    fit: Object.freeze(fit),
    phases: Object.freeze(perPhase),
    descriptor: describeCycle(descriptors),
    motion,
    swing,
  });
};
