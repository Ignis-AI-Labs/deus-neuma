// armillary-state.js — THE ARMILLARY's state, the one shape its stage
// renders (armillary-stage.js): from THE IGNITION's timeline as it wakes, or
// at rest on the gateway under the witness's hand. Pure.

import { AXIAL_TILT_DEG } from './armillary-geometry.js';

/** The armillary whole and still: the gateway's rest, the ignition's last frame. */
export const ARMILLARY_REST = Object.freeze({
  t: 0,
  point: 1,
  axis: 1,
  meridian: 1,
  equator: 1,
  lean: AXIAL_TILT_DEG,
  geometry: 1,
  spin: 0,
  presence: Object.freeze({ x: 0, y: 0 }),
  charge: 0,
  flare: 0,
  pulses: Object.freeze([]),
  dive: 0,
  intensity: 1,
});

/**
 * The armillary as THE IGNITION wakes it. Pure.
 * @param {ReturnType<import('../Ignition/ignition-timeline.js').ignitionAt>} s
 * @param {ReturnType<import('../Ignition/ignition-energy.js').energyAt>} e
 * @param {number} seconds the clock its light travels on
 */
export const armillaryOfIgnition = (s, e, seconds) => ({
  ...ARMILLARY_REST,
  t: seconds,
  point: s.point,
  axis: s.axis,
  meridian: s.meridian,
  equator: s.equator,
  lean: s.lean,
  geometry: s.geometry,
  flare: e.flare,
  pulses: e.pulses,
  dive: e.dive,
});

const SPIN_RATE = (2 * Math.PI) / 90; // radians per second: one turn in ninety
const SPIN_RAMP_S = 4; // the turn gathers from stillness

/**
 * The resting spin `since` seconds after the armillary began to turn: it
 * gathers from stillness (the ignition hands it over still), then turns at
 * one revolution in ninety seconds. Pure.
 */
export const restingSpinOf = (since) => {
  if (since <= 0) return 0;
  if (since < SPIN_RAMP_S) return (SPIN_RATE * since * since) / (2 * SPIN_RAMP_S);
  return SPIN_RATE * (since - SPIN_RAMP_S / 2);
};
