// emblem-geometry.js — the brand mark's true measurements. Pure.
//
// THE EMBLEM: a circle inscribed in a chamfered square — LINE meets CYCLE,
// structure holding spirit (docs/design/interface/design-language.md, THE CORE
// DICHOTOMY). Locked in 2026-07-18 as the brand mark; it recurs at every
// scale — favicon, first-paint veil, boot seal, gateway seal. This module
// owns the counts so every renderer (React JSX, vanilla string markup, the
// hand-inlined veil in index.html) draws the SAME instrument. SHINKEI binds
// here hardest: captions state true counts, and the counts are true because
// this is their only source.

export const EMBLEM = Object.freeze({
  TICK_COUNT: 60, // graduations on the seal's ring — sixty, like seconds
  CARDINAL_COUNT: 4, // elongated markers at 12 / 3 / 6 / 9 o'clock
  SEED_PETALS: 6, // seed of life: six around one, seven circles one radius
  INSCRIPTION:
    'DEUS NEUMA · GATEWAY · IDENTITY IS THE THRESHOLD · SOVEREIGN LOCAL LAYER · UNAVIS NETWORK · ',
});

// The boot seal's fixed spec (SVG viewBox space). The seed is a TRUE seed of
// life: petal centers sit exactly one radius from the center, so the seven
// circles fill the core ring precisely (extent 2r = CORE_RADIUS).
// SEAL and the generator functions below are staged
// for their renderers — EmblemSeal/boot (unit 2) and the gateway seal
// (unit 3); the veil and favicon hand-inline their copies by necessity
// (pre-module contexts), each carrying a comment pointing back here.
export const SEAL = Object.freeze({
  VIEWBOX: 132,
  CENTER: 66,
  FRAME: Object.freeze({ X: 1, Y: 1, SIZE: 130, CUT: 12 }), // TR+BL chamfers
  RING_RADIUS: 46,
  TICK_LENGTH: 4,
  CARDINAL_LENGTH: 8,
  CORE_RADIUS: 27,
  SEED_RADIUS: 27 / 2,
  CENTER_DOT: 2,
});

// The gateway seal's fixed spec (the portal's 400 viewBox space). The outer
// ring is truly INSCRIBED in the chamfered frame (FRAME.SIZE / 2 =
// RING_RADIUS) — the emblem's line-holding-cycle at full scale. Graduations
// point INWARD so they never pierce that frame; the bands stay distinct:
// middle ring 140 < inscription ~146 < dashed ring 160 < ticks 167–180.
export const GATEWAY_SEAL = Object.freeze({
  CENTER: 200,
  RING_RADIUS: 180,
  TICK_LENGTH: 7,
  CARDINAL_LENGTH: 13,
  INSCRIPTION_RADIUS: 146,
  VESICA_RADIUS: 12,
  FRAME: Object.freeze({ X: 20, Y: 20, SIZE: 360, CUT: 26 }), // TR+BL chamfers
});

/**
 * Polar point, 0° at 12 o'clock, clockwise (SVG y-down).
 * @param {number} cx @param {number} cy @param {number} r @param {number} deg
 * @returns {{x: number, y: number}}
 */
export const polar = (cx, cy, r, deg) => {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
};

/**
 * Chamfered-square polygon points — TR+BL diagonal cuts, the LINE register's
 * panel shape. Origin (x0, y0) is the top-left of the bounding square.
 * @returns {string} SVG polygon points
 */
export const chamferedSquarePoints = (x0, y0, size, cut) => {
  const x1 = x0 + size;
  const y1 = y0 + size;
  return `${x0},${y0} ${x1 - cut},${y0} ${x1},${y0 + cut} ${x1},${y1} ${x0 + cut},${y1} ${x0},${y1 - cut}`;
};

/**
 * Ring graduations — TICK_COUNT radial ticks, CARDINAL_COUNT of them
 * elongated at the compass points. direction +1 (default): ticks run
 * OUTWARD from the ring (inner endpoint on the ring). direction -1: ticks
 * run INWARD (outer endpoint on the ring) — the gateway seal's graduations
 * must not pierce its inscribed frame.
 * @returns {Array<{x1:number,y1:number,x2:number,y2:number,cardinal:boolean}>}
 */
export const ringGraduations = (cx, cy, radius, tickLength, cardinalLength, direction = 1) => {
  const perCardinal = EMBLEM.TICK_COUNT / EMBLEM.CARDINAL_COUNT;
  return Array.from({ length: EMBLEM.TICK_COUNT }, (_, i) => {
    const deg = (i * 360) / EMBLEM.TICK_COUNT;
    const cardinal = i % perCardinal === 0;
    const length = cardinal ? cardinalLength : tickLength;
    const inner = polar(cx, cy, radius, deg);
    const outer = polar(cx, cy, radius + direction * length, deg);
    return { x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y, cardinal };
  });
};

/**
 * The seed of life — seven circles one radius: one center, six petals whose
 * centers lie exactly one radius out (each petal's center on the center
 * circle's circumference). Petal 0 at 3 o'clock, 60° steps.
 * @returns {Array<{x:number,y:number,r:number}>} center first, then petals
 */
export const seedOfLife = (cx, cy, r) => [
  { x: cx, y: cy, r },
  ...Array.from({ length: EMBLEM.SEED_PETALS }, (_, i) => ({
    ...polar(cx, cy, r, 90 + i * 60),
    r,
  })),
];

/**
 * The vesica — two sovereign circles, each center on the other's
 * circumference (centers exactly r apart). The lens between them is the
 * portal: witness ⇄ neuma.
 * @returns {[ {x:number,y:number,r:number}, {x:number,y:number,r:number} ]}
 */
export const vesica = (cx, cy, r) => [
  { x: cx - r / 2, y: cy, r },
  { x: cx + r / 2, y: cy, r },
];
