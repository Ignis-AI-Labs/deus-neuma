// genesis-camera.js — the genesis camera as a pure function of time.
//
// No damping, no clock of its own: the pose at t is read off keyframes, so
// any frame can be scrubbed to and the camera always agrees with the beat.
// The drawing is framed head-on (it IS a drawing) until the first solid
// needs an observer off its plane — the +1 vertex. Then the observer circles
// the family as it rises, every solid held whole in the frame while it is
// named — the φ-solid and its dual made inside the octahedron that holds
// them; lets the construct recede past it into the backdrop; faces the tree
// as it is built, sways across the two trees, and closes head-on on the
// offering.
//
// A solid is never lost while its caption names it: every key FITS a
// bounding sphere to the frame's short side (fitDistance), at the viewport's
// real aspect, so a beat frames what it is about on a wide screen and a tall
// one alike; genesis-framing.js measures it.

import { BEATS, partStart } from './genesis-timeline.js';
import { GENESIS, genesisFamily, fruitCenters } from './genesis-geometry.js';
import { TREE, FUNCTIONS, nodeAt, pillarConstruction } from './genesis-emanon.js';
import { walkAt } from './genesis-walk.js';
import { constructScale, RECESSION } from './genesis-state-construct.js';

export const FOV_DEG = 32;
export const TAN_HALF = Math.tan((FOV_DEG * Math.PI) / 360);

/**
 * The distance at which a sphere of radius r spans `fill` of the view's
 * short side, at an aspect (width / height). Pure.
 */
export const fitDistance = (r, aspect, fill) => r / Math.sin(Math.atan(fill * TAN_HALF * Math.min(1, aspect)));

const at = Object.fromEntries(BEATS.map((b) => [b.id, b.at]));
const { R } = GENESIS;
const deg = (d) => (d * Math.PI) / 180;
const TURN = Math.PI * 2;

// The bounding spheres the solids' beats frame, read off the geometry.
const SOLIDS = genesisFamily();
const reach = (vs) => Math.max(...vs.map((v) => Math.hypot(v.x, v.y, v.z || 0)));
const TETRA = reach(SOLIDS.tetrahedra[0].vertices); // the stella and the cube share it
const OUTER = reach(SOLIDS.octahedron.vertices); // the octahedron holds the family
const PLANE = reach(fruitCenters()); // Metatron's lines, the plane the first solid leaves

// The tree's bounding spheres: the middle pillar's construction circles,
// the eleven spheres, and the two trees once parted.
const PILLAR = Math.max(...pillarConstruction().centers.map((c) => Math.hypot(c.x, c.y))) + TREE.UNIT;
const ONE_TREE = Math.max(...FUNCTIONS.map((f) => Math.hypot(nodeAt(f.id, 1).x, nodeAt(f.id, 1).y))) + TREE.SPHERE;
const TWO_TREES = Math.max(...FUNCTIONS.map((f) => { const n = nodeAt(f.id, 1); return Math.hypot(n.x, n.y, n.z); })) + TREE.SPHERE;
// How far the camera leans toward the walking light (genesis-walk.js).
const LEAN = 0.2;

// A drawing's half-extent e spans 45% of the short side; a featured solid's
// bounding sphere 60% — whole, with the caption clear of it; the plane the
// first solid rises from 80%, so it stays in sight beneath it.
const DRAWING_FILL = 0.45;
const SOLID_FILL = 0.6;
const PLANE_FILL = 0.8;
// The tree is the whole frame's subject: 82% of the short side, its names beside it.
const TREE_FILL = 0.82;

// The camera passes a shell only at the recession, when the construct grows
// past it into the backdrop.
export const CROSSINGS = Object.freeze({ recession: RECESSION });

// r: the bounding radius framed; construct: r is in the construct's own
// units (it scales with it); fill: the share of the short side it spans.
const pose = (r, fill, construct, az = 0, el = 0, tx = 0) => ({ r, fill, construct, az, el, tx });
const drawn = (e, az, el, tx) => pose(e, DRAWING_FILL, false, az, el, tx);
const solid = (r, az, el) => pose(r, SOLID_FILL, true, az, el);
const plane = (az, el) => pose(PLANE, PLANE_FILL, true, az, el);
const tree = (r, az, el) => pose(r, TREE_FILL, false, az, el);

// [t ms, pose] — eased across adjacent keys.
const KEYS = Object.freeze([
  [0, drawn(R * 1.25)],
  [at.vesica, drawn(R * 1.25)],
  [at.vesica + 1500, drawn(R * 2.2)],
  [at.fruit, drawn(R * 2.2)],
  [at.fruit + 3000, drawn(R * 5.3)],
  [at.simplex - 500, drawn(R * 5.3)],
  // The first solid traces its projection head-on, then the observer leaves
  // the plane and circles the family as it rises.
  [at.simplex + 1600, plane()],
  [partStart('simplex', 'observer'), plane(deg(32), deg(20))],
  [at.solids, plane(deg(45), deg(22))],
  [partStart('solids', 'cube'), solid(TETRA, deg(60), deg(24))],
  [partStart('solids', 'octahedron'), solid(OUTER, deg(75), deg(25))],
  [partStart('solids', 'icosahedron'), solid(OUTER, deg(95), deg(22))],
  [partStart('solids', 'dodecahedron'), solid(OUTER, deg(140), deg(15))],
  [at.cosmos, solid(OUTER, deg(175), deg(12))],
  // Held in world units from here: the construct grows past the camera.
  [CROSSINGS.recession.from, pose(OUTER * constructScale(CROSSINGS.recession.from), SOLID_FILL, false, deg(235), deg(16))],
  // The tree is built head-on — while it is being constructed it IS a
  // drawing — then the observer sways beside the two trees, never facing
  // them square (head-on the parted trees hide each other) nor past 45°
  // (edge-on they would collapse into lines).
  [at.tree, tree(PILLAR, TURN)],
  [partStart('tree', 'heart'), tree(PILLAR, TURN)],
  [partStart('tree', 'heart') + 1200, tree(ONE_TREE, TURN)],
  [at.trees - 800, tree(ONE_TREE, TURN)],
  [at.trees + 2600, tree(TWO_TREES, TURN + deg(34), deg(20))],
  [at.oscillation, tree(TWO_TREES, TURN + deg(38), deg(18))],
  [at.oscillation + 3500, tree(TWO_TREES, TURN + deg(18), deg(24))],
  [at.offering, tree(TWO_TREES, TURN + deg(30), deg(18))],
  [at.offering + 2400, drawn(1.35, TURN)],
  [partStart('offering', 'vesica'), drawn(1.35, TURN)],
  [partStart('offering', 'vesica') + 1800, drawn(1.45, TURN, 0, TREE.CIRCLE / 2)],
  [at.handoff + 1500, drawn(1.45, TURN, 0, TREE.CIRCLE / 2)],
]);

const smooth = (x) => x * x * (3 - 2 * x);
const lerp = (a, b, x) => a + (b - a) * x;

// a key's framing distance at t (a construct key follows the construct's scale)
const distanceOf = (k, t, aspect) => fitDistance(k.r * (k.construct ? constructScale(t) : 1), aspect, k.fill);

/**
 * The camera pose at genesis time t for a viewport aspect: a point on a
 * sphere around the target (distance, azimuth about +Y, elevation), looking
 * at the target. Distance eases geometrically — a zoom reads as even. Pure.
 * @param {number} t ms
 * @param {number} [aspect] width / height
 */
export const cameraAt = (t, aspect = 16 / 9) => {
  let i = 0;
  while (i < KEYS.length - 1 && t >= KEYS[i + 1][0]) i += 1;
  const [t0, a] = KEYS[i];
  const [t1, b] = KEYS[Math.min(i + 1, KEYS.length - 1)];
  const x = t1 > t0 ? smooth(Math.min(1, Math.max(0, (t - t0) / (t1 - t0)))) : 0;
  const da = distanceOf(a, t, aspect);
  const dist = da * (distanceOf(b, t, aspect) / da) ** x;
  const az = lerp(a.az, b.az, x);
  const el = lerp(a.el, b.el, x);
  // while a tree is walked the camera leans toward the walking light
  const { lean } = walkAt(t);
  const target = { x: lerp(a.tx, b.tx, x) + LEAN * lean.x, y: LEAN * lean.y, z: LEAN * lean.z };
  return {
    x: target.x + dist * Math.cos(el) * Math.sin(az),
    y: target.y + dist * Math.sin(el),
    z: target.z + dist * Math.cos(el) * Math.cos(az),
    target,
    dist,
    az,
    el,
  };
};

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const crossV = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const unit = (a) => { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };

/**
 * Where a world point lands on screen for a camera pose, as percentages of
 * the viewport (the same projection the stage renders with: FOV_DEG, world
 * up +Y). `ahead` is false for points behind the camera; `depth` is the
 * distance along the view axis. Pure.
 * @param {{x,y,z}} p @param {ReturnType<typeof cameraAt>} cam @param {number} aspect width / height
 */
export const project = (p, cam, aspect) => {
  const f = unit(sub(cam.target, cam));
  const r = unit(crossV(f, { x: 0, y: 1, z: 0 }));
  const u = crossV(r, f);
  const d = sub(p, cam);
  const depth = dot(d, f);
  const nx = dot(d, r) / (depth * TAN_HALF * aspect);
  const ny = dot(d, u) / (depth * TAN_HALF);
  return { x: ((nx + 1) / 2) * 100, y: ((1 - ny) / 2) * 100, ahead: depth > 0, depth };
};
