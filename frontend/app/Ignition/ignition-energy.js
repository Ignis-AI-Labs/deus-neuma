// ignition-energy.js — the light THE IGNITION sends through THE ARMILLARY,
// as a pure function of its clock and its instruments' verdicts. // pure
//
// The study-05 treatment's IGNITION (docs/design/interface/study-05-genesis.md,
// ACT II): each declared instrument sends its light along a real line to the
// still point (ignition-timeline: the packet on its ray), and where it
// arrives a front runs out through the armillary's figures; the core
// discharges once and the threshold opens once. Nothing here is on a timer
// of its own: every front is a verdict that truly arrived.

import { IGNITION } from './ignition-timeline.js';
import { swell } from '../../utils/no-flash.js';

export const ENERGY = Object.freeze({
  PULSE_SPEED: 0.0016, // armillary units per ms — the core to the meridian in ~0.6 s
  PULSE_END: 1.5, // a front past the axis's points is spent
  FLARE_RISE_MS: 240, // the core's glow swells — never a flash (the no-flash law)
  FLARE_MS: 700, // then settles
});

/** A gentle swell `ms` after an arrival (the no-flash law, utils/no-flash.js). Pure. */
export const swellAt = (ms) => swell(ms, ENERGY.FLARE_RISE_MS, ENERGY.FLARE_MS);

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const diveEase = (x) => x * x * x; // gathering speed into the core

/**
 * The energy at time t. Pure.
 * @param {number} t ms from ignition
 * @param {{ verdicts: Array<{ at: number|null, state?: string|null }>, openAt: number|null }} inputs
 *   verdicts — shown times (ignition-timeline shownAt); openAt — ignitionAt().openAt
 * @returns {{ pulses: number[], flare: number, dive: number }}
 */
export const energyAt = (t, { verdicts, openAt }) => {
  const arrivals = [
    // a failure sends no light: only a true answer energizes the armillary
    ...verdicts.filter((v) => Number.isFinite(v.at) && v.state !== 'fail').map((v) => v.at + IGNITION.PACKET_MS),
    ...(Number.isFinite(openAt) ? [openAt] : []),
  ].filter((at) => at <= t).sort((a, b) => a - b);
  return {
    pulses: arrivals
      .map((at) => (t - at) * ENERGY.PULSE_SPEED)
      .filter((r) => r >= 0 && r < ENERGY.PULSE_END)
      .slice(-4),
    flare: arrivals.reduce((f, at) => Math.max(f, swellAt(t - at)), 0),
    dive: Number.isFinite(openAt) ? diveEase(clamp01((t - openAt) / IGNITION.OPEN_MS)) : 0,
  };
};
