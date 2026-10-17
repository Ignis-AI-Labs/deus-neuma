// gyro-geometry.js — the ignition gyro's true measurements. Pure.
//
// The gyro is the boot's centerpiece: a nested sacred-geometry construct in
// slow counter-rotation (SACRED GEOMETRY, study 04b — every form has a job,
// captions state true counts). VOLUMETRIC DOCTRINE (2026-07-19, Founder): every
// layer is a true three-dimensional figure — no flat plane tumbling in
// space reads as an object. The forms admitted, composed:
//   THE LATTICE  — Metatron's cube in its solid form: the VECTOR
//                  EQUILIBRIUM (cuboctahedron) — 13 nodes (one center,
//                  twelve vertices all one radius out), 78 channels (K13),
//                  36 struts (24 rim edges + 12 spokes, all exactly one
//                  radius long — the equilibrium's defining property).
//   THE SEED     — seed of life as its original construction: seven
//                  SPHERES of one radius, petal centers one radius out.
//   THE VESICA   — two SPHERES, each center on the other's surface.
//   THE SHELLS   — an armillary cage: meridians, equator, and latitude
//                  rings on one true sphere — the gyro's spherical body.
// Counts are true because they come from here; the renderer only draws them.
// All radii are normalized to the gyro's unit radius (1).

import { EMBLEM, seedOfLife, vesica } from '../../utils/emblem-geometry.js';

export const GYRO = Object.freeze({
  METATRON_NODES: 13,
  METATRON_CHANNELS: 78, // 13 choose 2
  METATRON_STRUTS: 36, // 24 cuboctahedron edges + 12 spokes, all one radius
  LATTICE_RADIUS: 0.6, // vector equilibrium circumradius = edge = spoke
  SEED_RADIUS: 0.14, // one radius for all seven spheres
  SEED_TILT_DEG: 63.4, // the seed plane leans out of the lattice plane
  VESICA_RADIUS: 0.22,
  SHELL_RADIUS: 0.96, // inside the unit bound
  // The armillary cage: meridian count and latitude band angles (degrees).
  ARMILLARY_MERIDIANS: 6,
  ARMILLARY_LATITUDES: Object.freeze([-60, -30, 30, 60]),
  // Rotation doctrine (CYCLE): continuous, 8–60s per working axis; the slow
  // precessions may breathe in minutes like any ambient cycle.
  RATES: Object.freeze({
    LATTICE_Y: (2 * Math.PI) / 48, // rad/s
    LATTICE_X: (2 * Math.PI) / 90, // precession
    SEED_Y: -(2 * Math.PI) / 36, // counter-rotating
    VESICA_A: (2 * Math.PI) / 24,
    VESICA_B: -(2 * Math.PI) / 30,
    VESICA_TILT_A: (2 * Math.PI) / 70, // crossed-axis precession
    VESICA_TILT_B: -(2 * Math.PI) / 85,
    SHELL_Y: (2 * Math.PI) / 60,
    SHELL_X: (2 * Math.PI) / 140, // the cage's slow lean
    NUCLEUS_BREATH_S: 6, // sinusoidal, one breath per 6s
  }),
});

/**
 * The 13 Metatron nodes in the solid form: the center, then the twelve
 * vertices of the vector equilibrium (cuboctahedron) — every permutation of
 * (±s, ±s, 0) across the three axes, all exactly one lattice radius out.
 * The flat 13-circle Metatron figure is this solid's projection; the gyro
 * carries the solid itself.
 * @returns {Array<{x:number,y:number,z:number}>}
 */
export const metatronNodes = () => {
  const s = GYRO.LATTICE_RADIUS / Math.SQRT2;
  const nodes = [{ x: 0, y: 0, z: 0 }];
  for (const [i, j] of [
    [0, 1],
    [0, 2],
    [1, 2],
  ]) {
    for (const si of [1, -1]) {
      for (const sj of [1, -1]) {
        const v = [0, 0, 0];
        v[i] = si * s;
        v[j] = sj * s;
        nodes.push({ x: v[0], y: v[1], z: v[2] });
      }
    }
  }
  return nodes;
};

/**
 * The 78 channels — every pair of centers joined exactly once (K13).
 * @returns {Array<[number, number]>} node-index pairs, i < j
 */
export const metatronChannels = () => {
  const edges = [];
  for (let i = 0; i < GYRO.METATRON_NODES; i++) {
    for (let j = i + 1; j < GYRO.METATRON_NODES; j++) edges.push([i, j]);
  }
  return edges;
};

/**
 * The 36 struts — the channels whose true length is exactly one lattice
 * radius: the cuboctahedron's 24 rim edges plus the 12 spokes from the
 * center (edge = circumradius — the vector equilibrium's own signature).
 * @returns {Array<[number, number]>} node-index pairs, i < j
 */
export const metatronStruts = () => {
  const nodes = metatronNodes();
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  return metatronChannels().filter(
    ([i, j]) => Math.abs(d(nodes[i], nodes[j]) - GYRO.LATTICE_RADIUS) < 1e-9
  );
};

/**
 * The seed of life as seven true SPHERES (one radius), centers on the XZ
 * plane one radius out — the original compass construction is spheres, not
 * circles; the renderer draws each as a full sphere read.
 * @returns {Array<{x:number,y:number,z:number,r:number}>}
 */
export const seedSpheres = () =>
  seedOfLife(0, 0, GYRO.SEED_RADIUS).map((s) => ({ x: s.x, y: 0, z: s.y, r: s.r }));

/**
 * The vesica as two SPHERE specs — each center exactly on the other's
 * surface (one radius apart on X).
 * @returns {Array<{x:number,y:number,z:number,r:number}>}
 */
export const vesicaSpheres = () =>
  vesica(0, 0, GYRO.VESICA_RADIUS).map((v) => ({ x: v.x, y: 0, z: v.y, r: v.r }));

/**
 * The armillary cage — the gyro's spherical body as rings on ONE true
 * sphere: `ARMILLARY_MERIDIANS` meridians fanned evenly, the equator, and
 * latitude bands whose radius and height keep them exactly on the shell
 * (r² + y² = R²). Great circles carry `great: true` (meridians + equator).
 * @returns {Array<{radius:number, y:number, tiltX:number, rotY:number, great:boolean}>}
 */
export const armillaryRings = () => {
  const R = GYRO.SHELL_RADIUS;
  const meridians = Array.from({ length: GYRO.ARMILLARY_MERIDIANS }, (_, k) => ({
    radius: R,
    y: 0,
    tiltX: Math.PI / 2,
    rotY: (k * Math.PI) / GYRO.ARMILLARY_MERIDIANS,
    great: true,
  }));
  const equator = { radius: R, y: 0, tiltX: 0, rotY: 0, great: true };
  const latitudes = GYRO.ARMILLARY_LATITUDES.map((deg) => {
    const phi = (deg * Math.PI) / 180;
    return { radius: R * Math.cos(phi), y: R * Math.sin(phi), tiltX: 0, rotY: 0, great: false };
  });
  return [...meridians, equator, ...latitudes];
};

// The seed petal count rides the emblem's own constant (6 around 1).
export const SEED_RING_COUNT = EMBLEM.SEED_PETALS + 1;

// ── THE PLATONIC FAMILY (2026-09-25) ─────────────────────────────────────
// Founder: […] The five regular solids, placed by their TRUE
// relations to the lattice, never by eye:
//   • The vector equilibrium is the RECTIFICATION of both the cube and the
//     octahedron: its twelve nodes are exactly the edge midpoints of the
//     cube (vertices (±s,±s,±s)) AND of the octahedron (vertices 2s on each
//     axis), s = lattice radius / √2. The cube and octahedron are duals, and
//     here their edges bisect each other at the lattice's nodes.
//   • The two tetrahedra of the stella octangula stand on the cube's
//     alternate vertices — the tetrahedron is its own dual; its six edges
//     are the cube's face diagonals.
//   • The nucleus holds the last dual pair: the icosahedron, and the
//     dodecahedron whose twenty vertices are the icosahedron's face centers.
// Edges are derived, never listed: in a regular solid they are exactly the
// vertex pairs at the minimum distance. Counts (V/E): tetrahedron 4/6,
// cube 8/12, octahedron 6/12, dodecahedron 20/30, icosahedron 12/30.

export const NUCLEUS_RADIUS = 0.1; // the icosahedron's circumradius

const PHI = (1 + Math.sqrt(5)) / 2;
const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** pure — the edges of a regular solid: every vertex pair at the minimum distance. */
export const regularEdges = (vertices) => {
  let min = Infinity;
  for (let i = 0; i < vertices.length; i++) {
    for (let j = i + 1; j < vertices.length; j++) min = Math.min(min, d3(vertices[i], vertices[j]));
  }
  const edges = [];
  for (let i = 0; i < vertices.length; i++) {
    for (let j = i + 1; j < vertices.length; j++) {
      if (Math.abs(d3(vertices[i], vertices[j]) - min) < 1e-9) edges.push([i, j]);
    }
  }
  return edges;
};

const solid = (vertices) => Object.freeze({ vertices, edges: regularEdges(vertices) });

/**
 * The five Platonic solids in their true relations to the lattice (see
 * above). Pure.
 * @returns {{cube, octahedron, tetrahedra: [object, object], icosahedron, dodecahedron}}
 *   each {vertices: {x,y,z}[], edges: [i, j][]}
 */
export const platonicSolids = () => {
  const s = GYRO.LATTICE_RADIUS / Math.SQRT2;
  const cube = [];
  for (const x of [s, -s]) for (const y of [s, -s]) for (const z of [s, -s]) cube.push({ x, y, z });
  const octahedron = [
    { x: 2 * s, y: 0, z: 0 }, { x: -2 * s, y: 0, z: 0 },
    { x: 0, y: 2 * s, z: 0 }, { x: 0, y: -2 * s, z: 0 },
    { x: 0, y: 0, z: 2 * s }, { x: 0, y: 0, z: -2 * s },
  ];
  const sign = (v) => Math.sign(v.x * v.y * v.z);
  const tetraA = cube.filter((v) => sign(v) > 0);
  const tetraB = cube.filter((v) => sign(v) < 0);
  // The icosahedron: the cyclic permutations of (0, ±1, ±φ), to the nucleus radius.
  const k = NUCLEUS_RADIUS / Math.hypot(1, PHI);
  const icosa = [];
  for (const a of [1, -1]) {
    for (const b of [PHI, -PHI]) {
      icosa.push({ x: 0, y: a * k, z: b * k }, { x: a * k, y: b * k, z: 0 }, { x: b * k, y: 0, z: a * k });
    }
  }
  const icosahedron = solid(icosa);
  // Its dual: one dodecahedron vertex at the centroid of every icosahedron
  // face (the faces are the edge-connected triples).
  const adj = new Set(icosahedron.edges.map(([i, j]) => `${i},${j}`));
  const joined = (i, j) => adj.has(i < j ? `${i},${j}` : `${j},${i}`);
  const dodeca = [];
  for (let i = 0; i < icosa.length; i++) {
    for (let j = i + 1; j < icosa.length; j++) {
      for (let m = j + 1; m < icosa.length; m++) {
        if (joined(i, j) && joined(j, m) && joined(i, m)) {
          dodeca.push({
            x: (icosa[i].x + icosa[j].x + icosa[m].x) / 3,
            y: (icosa[i].y + icosa[j].y + icosa[m].y) / 3,
            z: (icosa[i].z + icosa[j].z + icosa[m].z) / 3,
          });
        }
      }
    }
  }
  return Object.freeze({
    cube: solid(cube),
    octahedron: solid(octahedron),
    tetrahedra: Object.freeze([solid(tetraA), solid(tetraB)]),
    icosahedron,
    dodecahedron: solid(dodeca),
  });
};
