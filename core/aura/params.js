/**
 * THE AURA — the curated parameter space.
 *
 * The point of this file is what it REFUSES to draw. Letting a seed pick
 * arbitrary coefficients for the form grammar produces mush most of the time;
 * beauty is not a property you can bolt on after the fact. So every parameter
 * is confined to a hand-tuned interval inside which the grammar is known to
 * behave, and the reference sketch's own constants sit inside every one of
 * them — the sketch that started this is a member of the space, not an
 * exception to it.
 *
 * Ranges are the FIRST of two guarantees. The second is gate.js, which throws
 * out the draws that are legal but ugly. Neither alone is enough.
 *
 * Pure Math, no Node imports.
 */

import { drawRange, drawChoice } from './rng.js';

/**
 * Temporal rates. Each is a whole number of turns across AURA_CYCLE, so the
 * animation is periodic and the gate's survey of a cycle is exhaustive rather
 * than a sample of something that never repeats.
 */
export const RATES = Object.freeze([-2, -1.5, -1, -0.5, 0.5, 1, 1.5, 2]);

/**
 * The curated intervals. Order is load-bearing: a parameter's position here is
 * the counter it draws from, so adding a key in the middle would re-roll every
 * aura after it. Append only.
 */
export const RANGES = Object.freeze({
  sweep: [22, 58],      // how much of the manifold is traced
  f1: [11, 38],         // fast carrier — the fine texture
  f2: [3, 11],          // medium carrier — the beading
  f3: [5, 20],          // second carrier (twin mode)
  am: [2.2, 5.5],       // carrier envelope depth
  fm: [1, 4],           // frequency-modulation depth (fm mode)
  eStart: [-15, -7],    // where the band opens — always below zero (see eSpan)
  eFrac: [0.25, 0.95],  // how far it travels, as a share of its room to move
  ds: [0.05, 0.4],      // radial modulation frequency
  dz: [-6, -2],         // radial offset
  cc: [0.55, 2.4],      // radius → angle gain: the posture knob
  cu: [0.02, 0.35],     // sweep → angle gain
  cw: [1.2, 4],         // winding depth (wound coupling)
  qa: [1, 4],           // carrier's direct contribution
  qf: [1.5, 5],         // its frequency
  qg: [0.6, 2],         // magnitude gain across the sweep
  qb: [5, 14],          // magnitude base
  qc: [5, 14],          // inner phase gain
  qd: [1, 4],           // radial feedback into the magnitude
  xr: [20, 70],         // shear extent
  yr: [20, 50],         // radial extent
});

const KEYS = Object.freeze(Object.keys(RANGES));

/**
 * The band the sweep travels must never cross zero. `e` is the distance of the
 * spine from the axis; letting it pass through zero collapses the radius, and
 * with it the clean ramp the whole coupling is built on — the form stops being
 * a creature and becomes a crease. So the travel is drawn as a FRACTION of the
 * room available below zero, never as an independent offset.
 */
const bandSpan = (eStart, eFrac) => eFrac * (Math.abs(eStart) - 2);
const RATE_KEYS = Object.freeze(['w1', 'w2', 'w3', 'w4']);

/** Counters reserved per candidate — room to append parameters without re-rolling. */
export const CANDIDATE_STRIDE = 64;

/**
 * Draw one candidate's continuous parameters. Pure.
 * @param {bigint[]} lanes - from seedLanes
 * @param {number} candidate - which candidate of the tournament
 * @returns {object} frozen parameter set, including the four temporal rates
 */
export const sampleParams = (lanes, candidate) => {
  const base = candidate * CANDIDATE_STRIDE;
  const p = {};
  KEYS.forEach((key, i) => {
    p[key] = drawRange(lanes, base + i, RANGES[key]);
  });
  RATE_KEYS.forEach((key, i) => {
    p[key] = drawChoice(lanes, base + KEYS.length + i, RATES);
  });
  p.eSpan = bandSpan(p.eStart, p.eFrac);
  delete p.eFrac; // the draw; eSpan is the quantity the grammar reads
  return Object.freeze(p);
};
