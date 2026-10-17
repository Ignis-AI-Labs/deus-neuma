// code-lattice.js — THE CODE, Deus Neuma's lattice. Pure.
// Ratified 2026-10-09 (Founder): built on deusneuma.ai, moved here, mirrored back to the site by
// `npm run sync:lookdev`. It grounds the gateway and the brand's social plates (docs/design/brand/export.py).
//
//
// A 2-uniform tiling of triangles, squares, hexagons and dodecagons, built from the rhombitrihexagonal
// tiling (3.4.6.4): there every hexagon, with its ring of six squares and six triangles, makes an exact
// regular dodecagon. On one hexagon site in seven (seven, as the seed of life's circles) that patch
// is dissolved into an open dodecagon, a ROSETTE, and holds a ring: the emblem's circle within its
// polygon. The seven-fold choice twists the field: it keeps six-fold rotation about every rosette
// and no mirror (balanced but dynamic, as the brand's chamfer is). It repeats, so it tiles.
//
// A rosette sits on the still point, so the armillary is seated in the code. Every vertex is shared
// by three or four faces and joins three or four rails: the field is one connected network, and
// energy can reach the core from anywhere. Coordinates are page px relative to the still point.

export const EDGE = 26; // every edge of the field, in px
export const ROSETTE_EVERY = 7;
const ROOT3 = Math.sqrt(3);
const SPACING = EDGE * (1 + ROOT3); // between neighbouring hexagon centres in 3.4.6.4
export const ROSETTE_INRADIUS = (EDGE * (2 + ROOT3)) / 2;
export const ROSETTE_CIRCUMRADIUS = EDGE / (2 * Math.sin(Math.PI / 12));
export const RING_RADIUS = ROSETTE_INRADIUS * 0.7;

/** @typedef {readonly [number, number]} Pt */
/**
 * @typedef {{
 *   pts: Pt[],
 *   edges: [number, number][],
 *   adj: number[][],
 *   rosettes: Pt[],
 *   rosetteOf: number[],
 *   rims: number[][],
 *   near: Map<string, number[]>,
 * }} Lattice
 * rosetteOf: the rosette whose rim a vertex lies on, or -1. rims: each rosette's graduations, the
 * angles of its dodecagon's corners. near: vertices by grid cell (one edge square), for nearestVertex.
 */

/** @param {number} n @param {number} m */
const mod = (n, m) => ((n % m) + m) % m;
/** Hexagon site (s, r) in axial coordinates: its centre, and whether it is a rosette. */
export const siteAt = (/** @type {number} */ s, /** @type {number} */ r) => ({
  c: /** @type {Pt} */ ([SPACING * (s + r / 2), SPACING * (ROOT3 / 2) * r]),
  // s + 3r ≡ 0 (mod 7) is a sublattice a 60° turn keeps ((s, r) → (−r, s + r) needs k² − k + 1 ≡ 0
  // mod 7: k = 3, or 5 for its mirror image): six-fold, and chiral
  rosette: mod(s + 3 * r, ROSETTE_EVERY) === 0,
});

/** The field over the window [x0, x1] × [y0, y1] (relative to the still point), with a margin. */
/** @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1 @returns {Lattice} */
export function latticeIn(x0, y0, x1, y1) {
  const m = SPACING * 2;
  const rowH = SPACING * (ROOT3 / 2);
  /** @type {{ c: Pt, rosette: boolean }[]} */
  const sites = [];
  for (let r = Math.floor((y0 - m) / rowH); r <= Math.ceil((y1 + m) / rowH); r++) {
    for (let s = Math.floor((x0 - m) / SPACING - r / 2); s <= Math.ceil((x1 + m) / SPACING - r / 2); s++) sites.push(siteAt(s, r));
  }
  // every vertex of 3.4.6.4 belongs to exactly one hexagon: six per site, none shared
  /** @type {Pt[]} */
  const all = sites.flatMap(({ c }) => Array.from({ length: 6 }, (_, k) => {
    const t = Math.PI / 6 + (k * Math.PI) / 3;
    return /** @type {Pt} */ ([c[0] + EDGE * Math.cos(t), c[1] + EDGE * Math.sin(t)]);
  }));
  const rosettes = sites.filter((x) => x.rosette).map((x) => x.c);
  const insideRosette = (/** @type {Pt} */ p) => rosettes.some(([x, y]) => Math.hypot(p[0] - x, p[1] - y) < ROSETTE_INRADIUS - 1e-6);

  // rails: vertex pairs exactly one edge apart, found through a spatial hash; a rosette's inside dissolves
  const cell = EDGE * 1.01;
  /** @type {Map<string, number[]>} */
  const bucket = new Map();
  all.forEach(([x, y], k) => {
    const key = `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
    (bucket.get(key) ?? /** @type {number[]} */ (bucket.set(key, []).get(key))).push(k);
  });
  /** @type {[number, number][]} */
  const pairs = [];
  all.forEach(([x, y], u) => {
    const [gx, gy] = [Math.floor(x / cell), Math.floor(y / cell)];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const v of bucket.get(`${gx + dx},${gy + dy}`) ?? []) {
          if (v <= u || Math.abs(Math.hypot(all[v][0] - x, all[v][1] - y) - EDGE) > 1e-6) continue;
          if (!insideRosette([(x + all[v][0]) / 2, (y + all[v][1]) / 2])) pairs.push([u, v]);
        }
      }
    }
  });
  // keep only vertices that still carry a rail, renumbered
  /** @type {Map<number, number>} */
  const index = new Map();
  /** @type {Pt[]} */
  const pts = [];
  for (const [u, v] of pairs) for (const k of [u, v]) if (!index.has(k)) { index.set(k, pts.length); pts.push(all[k]); }
  const edges = pairs.map(([u, v]) => /** @type {[number, number]} */ ([/** @type {number} */ (index.get(u)), /** @type {number} */ (index.get(v))]));
  const adj = pts.map(() => /** @type {number[]} */ ([]));
  for (const [u, v] of edges) { adj[u].push(v); adj[v].push(u); }
  const rosetteOf = pts.map((p) => rosettes.findIndex(([x, y]) => Math.abs(Math.hypot(p[0] - x, p[1] - y) - ROSETTE_CIRCUMRADIUS) < 1e-6));
  const rims = rosettes.map(() => /** @type {number[]} */ ([]));
  pts.forEach(([x, y], k) => {
    const r = rosetteOf[k];
    if (r >= 0) rims[r].push(Math.atan2(y - rosettes[r][1], x - rosettes[r][0]));
  });
  rims.forEach((angles) => angles.sort((a, b) => a - b));
  /** @type {Map<string, number[]>} */
  const near = new Map();
  pts.forEach(([x, y], k) => {
    const key = `${Math.floor(x / EDGE)},${Math.floor(y / EDGE)}`;
    (near.get(key) ?? /** @type {number[]} */ (near.set(key, []).get(key))).push(k);
  });
  return { pts, edges, adj, rosettes, rosetteOf, rims, near };
}

/**
 * A rosette's graduations: one for each corner of its dodecagon, as angles from its centre. The ring
 * is an instrument in small (design-language: seals carry graduations), and its count is true.
 */
export const graduationsOf = (/** @type {Lattice} */ L, /** @type {number} */ rosette) => L.rims[rosette];

/** The vertex nearest a point: searched in its grid cell and the rings of cells round it. */
/** @param {Lattice} L @param {Pt} p @returns {number} */
export function nearestVertex(L, [x, y]) {
  const [gx, gy] = [Math.floor(x / EDGE), Math.floor(y / EDGE)];
  let best = -1;
  let bestD = Infinity;
  // every point lies within one edge of a vertex, so two rings of cells always hold the nearest
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      for (const k of L.near.get(`${gx + dx},${gy + dy}`) ?? []) {
        const d = (L.pts[k][0] - x) ** 2 + (L.pts[k][1] - y) ** 2;
        if (d < bestD) [best, bestD] = [k, d];
      }
    }
  }
  return best;
}
