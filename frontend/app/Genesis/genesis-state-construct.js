// genesis-state-construct.js — movement III at time t: the +1 vertex and
// the solids at cosmic scale. Pure.
//
// The first tetrahedron — the 3-simplex, four points for three dimensions —
// traces its projection on the drawing, then lifts as the observer leaves
// the plane. The family follows, each held whole in the frame; the φ-solid
// is made on the octahedron's edges and its dual inside it, the whole family
// is seen as the cosmos, and the construct recedes past the camera to become
// the backdrop: the same figure recurring at every scale behind everything
// that follows. The camera frames by the construct's scale
// (genesis-camera.js), so growing it never loses a solid.

import { partProgress, partStart } from './genesis-timeline.js';
import { AT, ease, clamp01, fadeTo } from './genesis-state-drawing.js';
import { swell } from '../../utils/no-flash.js';

const PULSE_SPEED = 0.00135; // units per ms — nucleus to shell in ~0.7 s
const PULSE_END = 1.3;
// The construct's scale: its own size, then cosmic (large beside the
// nucleus glow), then the far field (the backdrop).
const COSMIC = 4;
const FAR = 28;
const AMBIENT = 0.06; // the backdrop's intensity: the AMBIENT plane, 5–8%
// While the tree is built and breathes the backdrop all but goes, so none of
// its lines cut through the tree; it returns for the offering, which turns it.
const UNDER_TREE = 0.012;
const BACKDROP_MS = 1500;
const backdrop = (t) => (t < AT.offering
  ? fadeTo(t, AT.tree, BACKDROP_MS, 1, UNDER_TREE / AMBIENT)
  : fadeTo(t, AT.offering, BACKDROP_MS, UNDER_TREE / AMBIENT, 1));

// A solid that rises out of the drawing: its edges first trace the
// projection (lift 0 — exactly Metatron's lines), then lift to true depth.
const risen = (u) => ({ draw: clamp01(u * 2), lift: ease(clamp01(u * 2 - 1)), burn: 1 - 0.7 * ease(clamp01(u * 2 - 1)) });

// The recession: once the cosmos has been seen whole, the construct grows
// past the camera into the backdrop (genesis-camera.js CROSSINGS.recession).
export const RECESSION = Object.freeze({ from: AT.cosmos + 1800, to: AT.tree });
const RECEDE_MS = RECESSION.to - RECESSION.from;

/** pure — the construct's scale at time t (the camera frames by it). */
export const constructScale = (t) => (t < AT.cosmos
  ? fadeTo(t, AT.solids, 2400, 1, COSMIC)
  : fadeTo(t, RECESSION.from, RECEDE_MS, COSMIC, FAR));

// THE LIGHT GOES WHERE THE CAPTION POINTS. While a beat names a solid it
// takes the light; the solid it is about to (its host — the corners it
// stands on, its dual, the edges it is inscribed on) stays half-lit, and the
// rest step back. THE COSMOS lights all five. Every change is a fade.
const SOLID_KEYS = Object.freeze(['tetrahedron', 'stella', 'cube', 'octahedron', 'icosahedron', 'dodecahedron']);
const FOCUS = Object.freeze([
  [AT.simplex, ['tetrahedron'], []],
  [partStart('solids', 'stella'), ['tetrahedron', 'stella'], []],
  [partStart('solids', 'cube'), ['cube'], ['tetrahedron', 'stella']],
  [partStart('solids', 'octahedron'), ['octahedron'], ['cube']],
  [partStart('solids', 'icosahedron'), ['icosahedron'], ['octahedron']],
  [partStart('solids', 'dodecahedron'), ['dodecahedron'], ['icosahedron']],
  [AT.cosmos, SOLID_KEYS, []],
]);
export const FOCUS_MS = 500;
const HOST = 0.6;
const STEP_BACK = 0.3;
const levelIn = (i, key) => (FOCUS[i][1].includes(key) ? 1 : FOCUS[i][2].includes(key) ? HOST : STEP_BACK);

/** pure — how much of its light a construct solid holds at t (1 when named). */
export const focusOf = (t, key) => {
  const i = FOCUS.findLastIndex(([at]) => t >= at);
  if (i < 0) return 1;
  return fadeTo(t, FOCUS[i][0], FOCUS_MS, i === 0 ? 1 : levelIn(i - 1, key), levelIn(i, key));
};

/**
 * The construct at time t. Pure.
 * @param {number} t ms
 */
export const constructAt = (t) => {
  const focus = (key) => focusOf(t, key);
  const scale = constructScale(t);
  const gain = fadeTo(t, RECESSION.from, RECEDE_MS, 1, AMBIENT) * backdrop(t);
  const pulses = [1, 2, 3]
    .map((n) => (t - partStart('cosmos', `pulse-${n}`)) * PULSE_SPEED)
    .filter((r) => r >= 0 && r < PULSE_END);
  const dodeca = partProgress('solids', 'dodecahedron', t);
  return {
    scale,
    gain,
    pulses,
    tetrahedron: { ...risen(partProgress('simplex', 'tetrahedron', t)), opacity: 0.8 * focus('tetrahedron') },
    stella: { ...risen(partProgress('solids', 'stella', t)), opacity: 0.55 * focus('stella') },
    cube: { ...risen(partProgress('solids', 'cube', t)), opacity: 0.7 * focus('cube') },
    octahedron: { ...risen(partProgress('solids', 'octahedron', t)), opacity: 0.6 * focus('octahedron') },
    icosahedron: { draw: partProgress('solids', 'icosahedron', t), lift: 1, burn: 1 - 0.5 * dodeca, opacity: 0.95 * focus('icosahedron') },
    dodecahedron: { draw: dodeca, lift: 1, burn: 0.3, opacity: 0.7 * focus('dodecahedron') },
    lattice: { draw: ease(partProgress('cosmos', 'lattice', t)), lift: 1, burn: 0, opacity: 0.4 },
    // each front swells the nucleus over a rise — never a step (no-flash law)
    nucleusGlow: 0.35 * clamp01((t - AT.simplex) / 600) * fadeTo(t, AT.cosmos + 900, 2100, 1, 0)
      + 0.6 * Math.max(0, ...pulses.map((r) => swell(r / PULSE_SPEED, 200, 400))),
  };
};
