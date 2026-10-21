// genesis-framing.js — what each stretch of GENESIS is about, and how it
// sits in the frame. Pure.
//
// A camera that dives inside the solids while the captions still name them
// shows a beat about the cube as one stray edge. A beat is framed only if the
// figures it is ABOUT are wholly on screen at a size the eye can read:
// FEATURED names them per stretch of the clock, in world space, from the
// same state the stage draws; frameMetrics measures them through the camera
// the stage renders with. The declared crossings (genesis-camera.js
// CROSSINGS) are the only stretches where a figure may leave the frame — the
// camera passing through a shell.

import { partStart } from './genesis-timeline.js';
import { project, CROSSINGS } from './genesis-camera.js';
import { GENESIS, seedCenters, fruitCenters, firstVesica, genesisFamily, genesisLattice } from './genesis-geometry.js';
import { AT, drawingAt } from './genesis-state-drawing.js';
import { constructAt } from './genesis-state-construct.js';
import { emanonAt } from './genesis-state-emanon.js';
import { FUNCTIONS, TREE, nodeAt, pillarConstruction } from './genesis-emanon.js';

const { R } = GENESIS;
const SOLIDS = genesisFamily();
const LATTICE = genesisLattice();

/** The band a featured figure's larger side must hold, as a share of the frame's short side. */
export const OCCUPANCY = Object.freeze({ MIN: 0.15, MAX: 0.85 });
/** The tree is the frame's whole subject: it holds this band. */
export const TREE_BAND = Object.freeze({ MIN: 0.72, MAX: 0.88 });

// ── the measure ─────────────────────────────────────────────────────────

/**
 * How a set of world points sits in the frame of a camera at an aspect.
 * Pure.
 * @param {Array<{x:number,y:number,z:number}>} points
 * @param {ReturnType<typeof import('./genesis-camera.js').cameraAt>} cam
 * @param {number} aspect width / height
 * @returns {{ vertices: number, bounds: number, occupancy: number, offset: number }}
 *   vertices — share of points on screen (and ahead of the camera);
 *   bounds — share of the points' screen bounding box inside the frame;
 *   occupancy — the box's larger side over the frame's short side
 *   (Infinity when a point is behind the camera); offset — the box
 *   center's distance from the frame center, over the short side.
 */
export const frameMetrics = (points, cam, aspect) => {
  const p = points.map((q) => project(q, cam, aspect));
  const onScreen = p.filter((q) => q.ahead && q.x >= 0 && q.x <= 100 && q.y >= 0 && q.y <= 100).length;
  if (p.some((q) => !q.ahead)) return { vertices: onScreen / p.length, bounds: 0, occupancy: Infinity, offset: Infinity };
  // screen units: width = aspect, height = 1
  const xs = p.map((q) => (q.x / 100) * aspect);
  const ys = p.map((q) => q.y / 100);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const area = Math.max(1e-12, (x1 - x0) * (y1 - y0));
  const inside = Math.max(0, Math.min(x1, aspect) - Math.max(x0, 0)) * Math.max(0, Math.min(y1, 1) - Math.max(y0, 0));
  const short = Math.min(aspect, 1);
  return {
    vertices: onScreen / p.length,
    bounds: x1 - x0 < 1e-9 || y1 - y0 < 1e-9 ? (onScreen === p.length ? 1 : 0) : inside / area,
    occupancy: Math.max(x1 - x0, y1 - y0) / short,
    offset: Math.hypot((x0 + x1) / 2 - aspect / 2, (y0 + y1) / 2 - 0.5) / short,
  };
};

// ── the featured figures, in world space ────────────────────────────────

const ring = (c, r, z = 0, n = 24) => Array.from({ length: n }, (_, k) => {
  const a = (k / n) * Math.PI * 2;
  return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a), z };
});
// a sphere's extremes on its three axes
const ball = (c, r) => [[r, 0, 0], [-r, 0, 0], [0, r, 0], [0, -r, 0], [0, 0, r], [0, 0, -r]]
  .map(([x, y, z]) => ({ x: c.x + x, y: c.y + y, z: c.z + z }));

// A solid as the stage draws it: depth scaled by its lift, the whole
// construct by its scale (genesis-shaders THE LIFT; genesis-figures).
const solidAt = (solid, key) => (t) => {
  const c = constructAt(t);
  const lift = c[key].lift;
  return solid.vertices.map((v) => ({ x: v.x * c.scale, y: v.y * c.scale, z: v.z * lift * c.scale }));
};
const tetraA = solidAt(SOLIDS.tetrahedra[0], 'tetrahedron');
const tetraB = solidAt(SOLIDS.tetrahedra[1], 'stella');
const cube = solidAt(SOLIDS.cube, 'cube');
const octa = solidAt(SOLIDS.octahedron, 'octahedron');
const icosa = solidAt(SOLIDS.icosahedron, 'icosahedron');
const dodeca = solidAt(SOLIDS.dodecahedron, 'dodecahedron');
const lattice = solidAt(LATTICE, 'lattice');

const seed = seedCenters();
const fruit = fruitCenters();
const vesica = firstVesica();
const circles = (centers, r = R) => centers.flatMap((c) => ring(c, r));
const chord = () => {
  const [a, b] = vesica.crossings;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const reach = 1.6 * R;
  return [-1, 1].map((s) => ({ x: mid.x + (s * reach * (b.x - a.x)) / len, y: mid.y + (s * reach * (b.y - a.y)) / len, z: 0 }));
};
// the fruit's circles where they stand at t (they walk out along the rays)
const fruitNow = (t) => {
  const { reach } = drawingAt(t).fruit;
  return fruit.slice(1).flatMap((f) => {
    const d = Math.hypot(f.x, f.y);
    const r = R + (d - R) * reach;
    return ring({ x: (f.x / d) * r, y: (f.y / d) * r }, R);
  });
};

// Metatron's lines: the plane the first solid rises out of
const plane = () => fruit.map((c) => ({ x: c.x, y: c.y, z: 0 }));

const column = () => pillarConstruction().centers.flatMap((c) => ring(c, TREE.UNIT));
const trees = (t) => {
  const split = emanonAt(t).split;
  return FUNCTIONS.flatMap((f) => [1, -1].flatMap((tree) => {
    const n = nodeAt(f.id, tree);
    return ball({ ...n, z: n.z * split }, TREE.SPHERE);
  }));
};
const holding = () => ring({ x: 0, y: 0 }, TREE.CIRCLE, 0, 48);
const other = () => ring({ x: TREE.CIRCLE, y: 0 }, TREE.CIRCLE, 0, 48);

const all = (...fs) => (t) => fs.flatMap((f) => f(t));
// band: the occupancy it must hold; settle: ms a zoom may take, at the
// stretch's start, to reach the band's floor (it stays whole throughout)
const stretch = (id, from, to, points, { crossing = false, band = OCCUPANCY, settle = 0 } = {}) => Object.freeze({ id, from, to, points, crossing, band, settle });

/**
 * Every stretch of the clock and the figures it is about. The field's
 * vibration is a front that leaves by design and the monad is one point:
 * neither has a size to hold. The one crossing, the recession, holds nothing
 * in frame: the construct itself becomes the backdrop.
 */
export const FEATURED = Object.freeze([
  stretch('THE FIRST CIRCLE', AT.circle, AT.vesica, () => ring({ x: 0, y: 0 }, R)),
  stretch('VESICA', AT.vesica, AT.line, () => circles(seed.slice(0, 2))),
  stretch('THE FIRST LINE', AT.line, AT.seed, () => [...circles(seed.slice(0, 2)), ...chord()]),
  stretch('SEED', AT.seed, AT.fruit, () => circles(seed)),
  stretch('FRUIT', AT.fruit, AT.metatron, (t) => [...circles(seed), ...fruitNow(t)]),
  stretch('METATRON', AT.metatron, AT.simplex, () => circles(fruit)),
  stretch('TETRAHEDRON', AT.simplex, partStart('simplex', 'observer'), all(tetraA, plane)),
  stretch('THE OBSERVER', partStart('simplex', 'observer'), AT.solids, all(tetraA, plane)),
  stretch('STELLA', AT.solids, partStart('solids', 'cube'), all(tetraA, tetraB)),
  stretch('CUBE', partStart('solids', 'cube'), partStart('solids', 'octahedron'), all(cube, tetraA, tetraB)),
  stretch('OCTAHEDRON', partStart('solids', 'octahedron'), partStart('solids', 'icosahedron'), all(octa, cube)),
  // the φ-solid on the octahedron's edges, then its dual inside it
  stretch('ICOSAHEDRON', partStart('solids', 'icosahedron'), partStart('solids', 'dodecahedron'), all(icosa, octa)),
  stretch('DODECAHEDRON', partStart('solids', 'dodecahedron'), AT.cosmos, all(dodeca, icosa, octa)),
  stretch('THE COSMOS', AT.cosmos, CROSSINGS.recession.from, all(octa, cube, lattice, icosa)),
  stretch('THE RECESSION', CROSSINGS.recession.from, CROSSINGS.recession.to, () => [], { crossing: true }),
  stretch('THE PILLAR', AT.tree, partStart('tree', 'spheres'), column, { band: TREE_BAND }),
  stretch('ELEVEN SPHERES', partStart('tree', 'spheres'), partStart('tree', 'heart'), all(column, trees), { band: TREE_BAND }),
  stretch('THE TREE', partStart('tree', 'heart'), AT.trees, trees, { band: TREE_BAND, settle: 1200 }),
  stretch('TWO TREES', AT.trees, AT.offering, trees, { band: TREE_BAND }),
  stretch('THE OFFERING', AT.offering, partStart('offering', 'vesica'), all(holding, trees)),
  stretch('THE VESICA', partStart('offering', 'vesica'), AT.handoff + 1500, all(holding, other)),
]);
