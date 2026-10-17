// genesis-state-drawing.js — movements I–II at time t: the field, then the
// plane unfolded (monad → circle → vesica → the first line → seed → fruit →
// Metatron). Pure. The shared easing and fade helpers live here too; the
// other movement modules import them.

import { BEATS, progress, partProgress, strokesDrawn, SPANS } from './genesis-timeline.js';
import { GENESIS } from './genesis-geometry.js';

export const AT = Object.freeze(Object.fromEntries(BEATS.map((b) => [b.id, b.at])));
export const ease = (x) => x * x * (3 - 2 * x);
export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** pure — a value that fades from `from` to `to` across [t0, t0 + dur]. */
export const fadeTo = (t, t0, dur, from, to) => from + (to - from) * ease(clamp01((t - t0) / dur));

// The field alternates light ⇄ void on this period while the void is held.
const FIELD_PERIOD = 2400;

/**
 * The field and the drawing at time t. Pure.
 * @param {number} t ms
 */
export const drawingAt = (t) => {
  // I · THE FIELD — not nothing: a lattice at the edge of sight, breathing
  // light ⇄ void; after the void it stays as the ground of everything.
  const breathing = t < AT.monad ? 0.5 - 0.5 * Math.cos((t / FIELD_PERIOD) * Math.PI * 2) : 0.35;
  const field = { opacity: fadeTo(t, 0, 1500, 0, 1) * (0.03 + 0.09 * breathing) };
  const vibration = partProgress('field', 'vibration', t);

  const circleDraw = progress('circle', t);
  const vesicaDraw = clamp01(progress('vesica', t) / 0.5);
  const petalDraws = [3, 4, 5, 6, 7].map((n) => partProgress('seed', `petal-${n}`, t));
  // The plane holds until the first solid lifts out of it, then gives way.
  const plane = fadeTo(t, AT.simplex, 2400, 1, 0);
  const seedOpacity = fadeTo(t, AT.fruit, 3000, 0.55, 0.12) * plane;
  const centerOpacity = fadeTo(t, AT.metatron, 2000, 0.55, 0.22) * plane;
  const reach = ease(partProgress('fruit', 'reach', t));
  const fruitOpacity = Math.min(1, reach * 3) * fadeTo(t, AT.metatron, 2000, 0.55, 0.22) * plane;
  const metatronU = partProgress('metatron', 'channels', t);

  return {
    field,
    // The first vibration: one ring out from the center, before any form.
    wave: { radius: vibration * 3.2 * GENESIS.R, opacity: vibration > 0 && vibration < 1 ? 0.7 * (1 - vibration) : 0 },
    monadGlow: ease(progress('monad', t)) * fadeTo(t, AT.circle, 1200, 1, 0.45) * fadeTo(t, AT.simplex, 1500, 1, 0),
    radiusHand: { angle: Math.PI / 2 + circleDraw * Math.PI * 2, opacity: circleDraw > 0 && circleDraw < 1 ? 0.85 : 0 },
    center: { draw: circleDraw, opacity: centerOpacity },
    petals: [vesicaDraw, ...petalDraws].map((draw) => ({ draw, opacity: seedOpacity })),
    lens: { opacity: ease(partProgress('vesica', 'lens', t)) * fadeTo(t, AT.line + 1400, 1200, 1, 0.3) * fadeTo(t, AT.fruit, 1500, 1, 0) },
    chord: { draw: partProgress('line', 'chord', t), opacity: fadeTo(t, AT.seed, 1500, 0.9, 0.35) * fadeTo(t, AT.fruit, 1500, 1, 0) },
    triad: { draw: partProgress('line', 'triad', t), opacity: fadeTo(t, AT.seed, 1500, 0.8, 0.3) * fadeTo(t, AT.fruit, 1500, 1, 0) },
    fruit: { reach, opacity: fruitOpacity },
    metatron: { u: metatronU, opacity: fadeTo(t, AT.simplex, 2400, 0.5, 0.08) * fadeTo(t, AT.solids, 1400, 1, 0) },
    counters: {
      seed: [circleDraw, vesicaDraw, ...petalDraws].filter((d) => d >= 1).length,
      channels: strokesDrawn(metatronU, GENESIS.METATRON_LINES, SPANS.METATRON),
    },
  };
};
