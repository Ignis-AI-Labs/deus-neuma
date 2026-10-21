// genesis-geometry.js — the first-ever opening's constructions. Pure.
//
// GENESIS (study 05, docs/design/interface/study-05-genesis.md) draws the
// creation sequence as compass-and-straightedge work: nothing is placed by
// eye, every center is a point the previous figures already made.
//   • Two circles of radius r whose centers are r apart cross at two points
//     that are themselves r from both centers — so each crossing is where
//     the NEXT circle stands. The seed of life constructs itself.
//   • The first straight line is the one through the first vesica's two
//     crossings: LINE is born from two CYCLES.
//   • The fruit's 13 centers joined pairwise give C(13,2) = 78 lines —
//     Metatron's cube.
//   • Seen down its corner-to-corner axis, the ignition gyro's cube projects
//     onto Metatron's inner hexagon (and so do the octahedron and the stella's
//     tetrahedra — true relations, gyro-geometry.js). So the solids can rise
//     out of the drawing literally: every vertex lifts from its projected
//     point to its true depth. The icosahedron needs φ and is NOT in the
//     hexagonal drawing: it is inscribed in the octahedron, each vertex
//     dividing an octahedron edge 1 : φ; the dodecahedron is its dual.
// The genesis plane is XY, facing a camera on +Z. Scale: the inner hexagon
// (2r) equals the gyro cube's projected radius, so the drawing and the
// construct are one object at one scale.

import { GYRO, platonicSolids, metatronNodes, metatronStruts } from '../BootIgnition/gyro-geometry.js';

const TAU = Math.PI * 2;
const UP = Math.PI / 2; // the first petal stands straight up

// The gyro cube's half-edge s = LATTICE_RADIUS/√2 projects (down its body
// diagonal) to a hexagon of radius s·√(8/3); that hexagon is 2r.
const CUBE_HALF_EDGE = GYRO.LATTICE_RADIUS / Math.SQRT2;
const PROJECTED_HEX = CUBE_HALF_EDGE * Math.sqrt(8 / 3);

export const GENESIS = Object.freeze({
  R: PROJECTED_HEX / 2, // one radius for every circle of the drawing
  SEED_CIRCLES: 7,
  FRUIT_CENTERS: 13,
  METATRON_LINES: 78,
  PHI: (1 + Math.sqrt(5)) / 2,
  VESICA_RATIO: Math.sqrt(3), // the lens: height / width
});

const at = (radius, angle) => ({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * The two crossing points of two circles of equal radius r. Pure.
 * @returns {Array<{x:number,y:number}>} [] when they do not cross
 */
export const circleCrossings = (a, b, r) => {
  const d = dist(a, b);
  if (d === 0 || d > 2 * r) return [];
  const h = Math.sqrt(r * r - (d * d) / 4);
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const ux = (b.x - a.x) / d;
  const uy = (b.y - a.y) / d;
  return [{ x: mx - uy * h, y: my + ux * h }, { x: mx + uy * h, y: my - ux * h }];
};

/**
 * The seed of life, in construction order: the center, the first petal
 * straight up, then each next petal at the crossing of the center circle
 * and the petal before it (going around). Every center after the second is
 * DERIVED from the crossings — never placed. Pure.
 * @returns {Array<{x:number,y:number}>} 7 centers
 */
export const seedCenters = () => {
  const { R } = GENESIS;
  const centers = [{ x: 0, y: 0 }, at(R, UP)];
  while (centers.length < GENESIS.SEED_CIRCLES) {
    const prev = centers[centers.length - 1];
    // Of the two crossings of the center circle and the previous petal, take
    // the one not already standing — counter-clockwise around the seed.
    const next = circleCrossings(centers[0], prev, R)
      .find((p) => !centers.some((c) => dist(c, p) < 1e-9 * (1 + R)) && cross(prev, p) > 0);
    centers.push(next);
  }
  return Object.freeze(centers);
};

// z of prev × p — positive when p is counter-clockwise of prev
const cross = (a, b) => a.x * b.y - a.y * b.x;

/**
 * The first vesica: the center circle and the first petal. Its lens runs
 * between the two crossings; its height/width is √3. Pure.
 * @returns {{a:{x,y}, b:{x,y}, crossings:Array<{x,y}>, width:number, height:number}}
 */
export const firstVesica = () => {
  const [a, b] = seedCenters();
  const crossings = circleCrossings(a, b, GENESIS.R);
  // The lens is as wide as the overlap along the centers' line (2r − d) and
  // as tall as the distance between the crossings.
  return Object.freeze({ a, b, crossings, width: 2 * GENESIS.R - dist(a, b), height: dist(crossings[0], crossings[1]) });
};

/**
 * The fruit of life's 13 centers: the center, the inner ring at 2r, the
 * outer ring at 4r, on the seed's six rays. Pure.
 * @returns {Array<{x:number,y:number}>}
 */
export const fruitCenters = () => {
  const { R } = GENESIS;
  const rays = Array.from({ length: 6 }, (_, k) => UP + (k * TAU) / 6);
  return Object.freeze([{ x: 0, y: 0 }, ...rays.map((a) => at(2 * R, a)), ...rays.map((a) => at(4 * R, a))]);
};

/**
 * Metatron's cube: every pair of the fruit's 13 centers — 78 lines, drawn
 * shortest first (the figure grows from its core outward). Pure.
 * @returns {Array<[number, number]>} index pairs into fruitCenters()
 */
export const metatronLines = () => {
  const c = fruitCenters();
  const pairs = [];
  for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) pairs.push([i, j]);
  return Object.freeze(pairs.sort((p, q) => dist(c[p[0]], c[p[1]]) - dist(c[q[0]], c[q[1]]) || p[0] - q[0] || p[1] - q[1]));
};

// ── THE LIFT ────────────────────────────────────────────────────────────
// A rotation carrying the cube's body diagonal (1,1,1)/√3 onto +Z (the
// camera axis), then turned about Z so a projected vertex stands on the
// first petal's ray. After it, a solid's z is its true depth and its (x,y)
// is exactly its place in the drawing.

const rotateToZ = (v) => {
  // Rodrigues: axis k = n × z, angle θ = acos(n·z), n = (1,1,1)/√3.
  const n = 1 / Math.sqrt(3);
  const k = { x: n / Math.hypot(n, n), y: -n / Math.hypot(n, n), z: 0 };
  const cos = n;
  const sin = Math.sqrt(1 - cos * cos);
  const kv = k.x * v.x + k.y * v.y + k.z * v.z;
  const cx = k.y * v.z - k.z * v.y;
  const cy = k.z * v.x - k.x * v.z;
  const cz = k.x * v.y - k.y * v.x;
  return {
    x: v.x * cos + cx * sin + k.x * kv * (1 - cos),
    y: v.y * cos + cy * sin + k.y * kv * (1 - cos),
    z: v.z * cos + cz * sin + k.z * kv * (1 - cos),
  };
};

// The turn about Z that stands the projected cube vertex (s, s, −s) on the
// first petal's ray.
const ALIGN = (() => {
  const p = rotateToZ({ x: CUBE_HALF_EDGE, y: CUBE_HALF_EDGE, z: -CUBE_HALF_EDGE });
  return UP - Math.atan2(p.y, p.x);
})();

/** pure — a gyro-frame point in the genesis frame (diagonal on the camera axis). */
export const toGenesisFrame = (v) => {
  const p = rotateToZ(v);
  const c = Math.cos(ALIGN);
  const s = Math.sin(ALIGN);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c, z: p.z };
};

const framed = (solid) => Object.freeze({ vertices: Object.freeze(solid.vertices.map(toGenesisFrame)), edges: solid.edges });

// A regular solid's faces, counted from its own vertices — never from Euler
// (which would make the V − E + F check a tautology). Triangular faces are
// mutually joined triples; the square and pentagonal solids read their face
// count off their dual, whose vertices stand one per face.
const triangleFaces = (edges) => {
  const adj = new Set(edges.map(([i, j]) => `${Math.min(i, j)},${Math.max(i, j)}`));
  const joined = (i, j) => adj.has(`${Math.min(i, j)},${Math.max(i, j)}`);
  const verts = [...new Set(edges.flat())];
  let n = 0;
  for (let a = 0; a < verts.length; a++) {
    for (let b = a + 1; b < verts.length; b++) {
      for (let c = b + 1; c < verts.length; c++) {
        if (joined(verts[a], verts[b]) && joined(verts[b], verts[c]) && joined(verts[a], verts[c])) n += 1;
      }
    }
  }
  return n;
};

const counts = (solid, faces) => Object.freeze({ V: solid.vertices.length, E: solid.edges.length, F: faces });

// The family in the genesis frame, each with its true V · E · F (faces
// counted, not assumed) and how it enters.
const inFrame = (s) => {
  const icosaFaces = triangleFaces(s.icosahedron.edges);
  return Object.freeze({
    cube: { ...framed(s.cube), counts: counts(s.cube, s.octahedron.vertices.length), enters: 'lift' },
    octahedron: { ...framed(s.octahedron), counts: counts(s.octahedron, triangleFaces(s.octahedron.edges)), enters: 'lift' },
    tetrahedra: s.tetrahedra.map((t) => ({ ...framed(t), counts: counts(t, triangleFaces(t.edges)), enters: 'lift' })),
    icosahedron: { ...framed(s.icosahedron), counts: counts(s.icosahedron, icosaFaces), enters: 'phi' },
    dodecahedron: { ...framed(s.dodecahedron), counts: counts(s.dodecahedron, s.icosahedron.vertices.length), enters: 'dual' },
  });
};

/**
 * The five solids in the genesis frame as the gyro holds them (the dual
 * pair a small nucleus): `lift` rises out of the drawing, `phi` is built on
 * the golden ratio (absent from the hexagonal drawing), `dual` is derived
 * from the icosahedron's faces. Pure.
 */
export const genesisSolids = () => inFrame(platonicSolids());

// THE NEST. The gyro's icosahedron is the cyclic (0, ±1, ±φ), on the
// octahedron's own axes; grown until its vertices touch the octahedron
// (|x| + |y| + |z| equal to the octahedron's corner), each stands on an
// octahedron edge and divides it 1 : φ — the φ-solid is drawn INSIDE the
// solid before it. Scaling keeps the dodecahedron its face-centroid dual.
const nested = (s) => {
  const corner = Math.max(...s.octahedron.vertices.map((v) => Math.abs(v.x) + Math.abs(v.y) + Math.abs(v.z)));
  const v = s.icosahedron.vertices[0];
  const k = corner / (Math.abs(v.x) + Math.abs(v.y) + Math.abs(v.z));
  const grow = (solid) => Object.freeze({ vertices: solid.vertices.map((p) => ({ x: p.x * k, y: p.y * k, z: p.z * k })), edges: solid.edges });
  return { ...s, icosahedron: grow(s.icosahedron), dodecahedron: grow(s.dodecahedron) };
};

/**
 * The five solids as GENESIS draws them: the family nested, the icosahedron
 * inscribed in the octahedron at 1 : φ and the dodecahedron its dual. Pure.
 */
export const genesisFamily = () => inFrame(nested(platonicSolids()));

/** The vector-equilibrium lattice (13 nodes, 36 struts) in the genesis frame. Pure. */
export const genesisLattice = () =>
  Object.freeze({ vertices: Object.freeze(metatronNodes().map(toGenesisFrame)), edges: metatronStruts() });
