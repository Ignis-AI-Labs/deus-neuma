// aura-view.js — every presentation decision for the sheet's AURA block (#405).
//
// Pure: the loaded leg goes in, render-ready facts come out. The sheet's data
// law holds here exactly as it does for every other block — a leg that could
// not be read is UNREADABLE, a lane with no identity anchors yet is EMPTY, and
// neither is ever dressed up as the other.

import { UNREADABLE, EMPTY, READY } from './sheet-view.js';

/**
 * The aura block's standing.
 *
 * The leg carries `{aura}` where `aura.recorded` is the backend's own honest
 * answer: false means the lane has no soul mark, genesis hash, or moment seed
 * yet — a real state during birth, not a failure. A null leg is a failed read.
 *
 * @param {{aura?: {recorded?: boolean, form?: object, fit?: object}}|null} leg
 * @returns {string} UNREADABLE | EMPTY | READY
 */
export const auraReadiness = (leg) => {
  if (!leg || typeof leg !== 'object' || !leg.aura) return UNREADABLE;
  const { aura } = leg;
  if (!aura.recorded) return EMPTY;
  // A form that arrived without its grammar or its fit cannot be swept, and
  // half a form is not a truth about a being — that reads as unreadable.
  return aura.form?.p && aura.fit ? READY : UNREADABLE;
};

/**
 * The form the canvas sweeps, or null when there is nothing to sweep. Pure.
 * @param {object|null} leg
 * @returns {{form: object, fit: object, cycle: number}|null}
 */
export const auraFormOf = (leg) => {
  if (auraReadiness(leg) !== READY) return null;
  const { form, fit, cycle } = leg.aura;
  return { form, fit, cycle };
};

/**
 * The block's honest caption: the three grammar choices the seed made, and the
 * seed's own head. Nothing here is a score and nothing is invented — every
 * value is read straight off the derivation.
 *
 * `carrier` is the texture of the strand, `coupling` the posture, `output` the
 * cast onto the plane (core/aura/form.js). The words are the platform's own.
 *
 * @param {object|null} leg
 * @returns {Array<{label: string, value: string}>}
 */
export const auraFacts = (leg) => {
  if (auraReadiness(leg) !== READY) return [];
  const { form, seed } = leg.aura;
  const facts = [
    { label: 'CARRIER', value: String(form.carrier).toUpperCase() },
    { label: 'COUPLING', value: String(form.coupling).toUpperCase() },
    { label: 'CAST', value: String(form.output).toUpperCase() },
  ];
  if (typeof seed === 'string' && seed) {
    facts.push({ label: 'SEED', value: seed.slice(0, 12).toUpperCase() });
  }
  return facts;
};

/** One full breath, in wall-clock milliseconds. Slow on purpose: it is alive, not spinning. */
export const BREATH_MS = 20000;

/**
 * THE FLOW (Design note, 2026-09-26: […]).
 *
 * The grammar drives four rates off one phase, and a single phase closes on
 * AURA_CYCLE — so an aura drawn from one phase repeats itself exactly every
 * breath. Here each rate runs on its own clock instead: the shared breath,
 * plus a slow drift whose four periods are mutually irrational multiples of
 * the breath, so the four never fall back into step and the form never
 * passes through the same moment twice.
 *
 * The drift is BOUNDED (FLOW_DRIFT radians either side of the breath) — the
 * gate proved each form across its lockstep cycle, and a headless probe over
 * 60 derived forms (2026-09-26) measured frames outside the gate's limits at
 * 2.0% on the lockstep loop, 2.4% under this drift, and 4.2% with the four
 * rates fully free. The drift keeps the form in the neighbourhood the gate
 * surveyed while never letting it repeat.
 *
 * The clock is the WALL clock, so the aura is where time has carried it —
 * opening the card does not restart it at a first frame.
 */
export const FLOW_DRIFT = 0.6;
const FLOW_PERIODS = Object.freeze([Math.SQRT2, (1 + Math.sqrt(5)) / 2, Math.sqrt(3), Math.PI].map((k) => k * 3.1 * BREATH_MS));
const FLOW_OFFSETS = Object.freeze([0, 1.9, 3.7, 5.3]);

/**
 * The four phases at a moment of the wall clock, each folded into the cycle
 * (every rate closes on it, so the fold is seamless per term). Pure.
 * @param {number} epochMs milliseconds since the epoch
 * @param {number} cycle AURA_CYCLE, carried on the payload
 * @returns {number[]} [t1, t2, t3, t4], each within [0, cycle)
 */
export const flowPhases = (epochMs, cycle) => {
  const breath = ((epochMs % BREATH_MS) / BREATH_MS) * cycle;
  return FLOW_PERIODS.map((period, i) => {
    const drift = FLOW_DRIFT * Math.sin(((epochMs % period) / period) * 2 * Math.PI + FLOW_OFFSETS[i]);
    return (((breath + drift) % cycle) + cycle) % cycle;
  });
};

/** The grid and point count the gate judged every form at. */
export const GATE_GRID = 220;
export const GATE_POINTS = 14000;
/** Past this a larger grid buys nothing a screen shows, and a frame's cost grows with the area. */
export const MAX_GRID = 1280;

/**
 * The grid a plate is drawn at, and the points it needs. Pure.
 *
 * The grid is the plate's real device-pixel size (css × dpr), so the browser
 * never stretches the picture soft or squeezes it into moiré. The point count
 * scales with the grid's AREA from the gate's own 220-cell / 14 000-point
 * sweep, so every cell gathers the density the gate measured and the tone
 * curve lands identically: the same picture at a finer resolution, never a
 * different one (core/aura/render.js).
 * @param {number} cssPx the plate's shown size
 * @param {number} [dpr] the device-pixel ratio
 * @returns {{size: number, count: number}}
 */
export const sigilGrid = (cssPx, dpr = 1) => {
  const want = Math.round(Math.max(1, cssPx) * Math.max(1, dpr));
  const size = Math.max(64, Math.min(MAX_GRID, want));
  return { size, count: Math.round(GATE_POINTS * (size / GATE_GRID) ** 2) };
};
