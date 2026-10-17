// genesis-state-construct.js — movement III at time t: the +1 vertex and
// the solids at cosmic scale. Pure.
//
// The first tetrahedron — the 3-simplex, four points for three dimensions —
// traces its projection on the drawing, then lifts as the observer leaves
// the plane. The family follows, the construct grows past the frame until
// the camera travels inside it, the φ-solid and its dual are made at the
// nucleus, and the whole construct recedes to become the cosmos: the same
// figure recurring at every scale behind everything that follows.

import { partProgress, partStart } from './genesis-timeline.js';
import { AT, ease, clamp01, fadeTo } from './genesis-state-drawing.js';
import { swell } from '../../utils/no-flash.js';

const PULSE_SPEED = 0.00135; // units per ms — nucleus to shell in ~0.7 s
const PULSE_END = 1.3;
// The construct's scale: its own size, then cosmic (the camera inside it),
// then the far field (the backdrop).
const COSMIC = 4;
const FAR = 28;
const AMBIENT = 0.06; // the backdrop's intensity: the AMBIENT plane, 5–8%

// A solid that rises out of the drawing: its edges first trace the
// projection (lift 0 — exactly Metatron's lines), then lift to true depth.
const risen = (u) => ({ draw: clamp01(u * 2), lift: ease(clamp01(u * 2 - 1)), burn: 1 - 0.7 * ease(clamp01(u * 2 - 1)) });

/**
 * The construct at time t. Pure.
 * @param {number} t ms
 */
export const constructAt = (t) => {
  const icosaStart = partStart('solids', 'icosahedron');
  // While the φ-solid and its dual are made, the outer solids step back.
  const outer = t < AT.cosmos ? fadeTo(t, icosaStart, 800, 1, 0.22) : fadeTo(t, AT.cosmos, 900, 0.22, 1);
  const scale = t < AT.cosmos
    ? fadeTo(t, AT.solids, 2400, 1, COSMIC)
    : fadeTo(t, AT.cosmos + 600, 2400, COSMIC, FAR);
  const gain = fadeTo(t, AT.cosmos + 900, 2100, 1, AMBIENT);
  const pulses = [1, 2, 3]
    .map((n) => (t - partStart('cosmos', `pulse-${n}`)) * PULSE_SPEED)
    .filter((r) => r >= 0 && r < PULSE_END);
  const dodeca = partProgress('solids', 'dodecahedron', t);
  return {
    scale,
    gain,
    pulses,
    tetrahedron: { ...risen(partProgress('simplex', 'tetrahedron', t)), opacity: 0.8 * outer },
    stella: { ...risen(partProgress('solids', 'stella', t)), opacity: 0.55 * outer },
    cube: { ...risen(partProgress('solids', 'cube', t)), opacity: 0.7 * outer },
    octahedron: { ...risen(partProgress('solids', 'octahedron', t)), opacity: 0.5 * outer },
    icosahedron: { draw: partProgress('solids', 'icosahedron', t), lift: 1, burn: 1 - 0.5 * dodeca, opacity: 0.95 },
    dodecahedron: { draw: dodeca, lift: 1, burn: 0.3, opacity: 0.7 },
    lattice: { draw: ease(partProgress('cosmos', 'lattice', t)), lift: 1, burn: 0, opacity: 0.4 },
    // each front swells the nucleus over a rise — never a step (no-flash law)
    nucleusGlow: 0.35 * clamp01((t - AT.simplex) / 600) * fadeTo(t, AT.cosmos + 900, 2100, 1, 0)
      + 0.6 * Math.max(0, ...pulses.map((r) => swell(r / PULSE_SPEED, 200, 400))),
  };
};
