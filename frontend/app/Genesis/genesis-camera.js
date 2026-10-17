// genesis-camera.js — the genesis camera as a pure function of time.
//
// No damping, no clock of its own: the pose at t is read off keyframes, so
// any frame can be scrubbed to and the camera always agrees with the beat.
// The drawing is framed head-on (it IS a drawing) until the first solid
// needs an observer off its plane — the +1 vertex. Then the camera travels
// INTO the solids at cosmic scale, comes back to face the tree as it is
// built, sways across the two trees, and closes head-on on the offering.

import { BEATS, partStart } from './genesis-timeline.js';
import { GENESIS } from './genesis-geometry.js';
import { TREE } from './genesis-emanon.js';

export const FOV_DEG = 32;
const TAN_HALF = Math.tan((FOV_DEG * Math.PI) / 360);
// The distance at which a figure of half-extent e fills ~45% of the view's
// half-height.
const FILL = 0.45;
const frame = (e) => e / (FILL * TAN_HALF);

const at = Object.fromEntries(BEATS.map((b) => [b.id, b.at]));
const { R } = GENESIS;
const deg = (d) => (d * Math.PI) / 180;
const TURN = Math.PI * 2;
const pose = (dist, az = 0, el = 0, tx = 0) => ({ dist, az, el, tx });

// [t ms, pose] — eased across adjacent keys.
const KEYS = Object.freeze([
  [0, pose(frame(R * 1.25))],
  [at.vesica, pose(frame(R * 1.25))],
  [at.vesica + 1500, pose(frame(R * 2.2))],
  [at.fruit, pose(frame(R * 2.2))],
  [at.fruit + 3000, pose(frame(R * 5.3))],
  [at.simplex, pose(frame(R * 5.3))],
  [partStart('simplex', 'observer'), pose(frame(1.0), deg(32), deg(20))],
  [at.solids, pose(frame(1.0), deg(45), deg(22))],
  // Into the construct: it grows to cosmic scale around a camera that is
  // soon INSIDE the octahedron, then inside the cube, at the nucleus.
  [at.solids + 2400, pose(3.2, deg(80), deg(25))],
  [partStart('solids', 'dodecahedron'), pose(1.6, deg(140), deg(15))],
  [at.cosmos, pose(2.2, deg(170), deg(10))],
  // The tree is built head-on — while it is being constructed it IS a
  // drawing — then the observer sways across the two trees like a pendulum,
  // never past 45° from facing (edge-on they would collapse into lines).
  [at.tree, pose(frame(1.05), TURN)],
  [at.trees - 800, pose(frame(1.05), TURN)],
  [at.trees + 2600, pose(frame(1.2), TURN + deg(34), deg(20))],
  [at.oscillation, pose(frame(1.2), TURN + deg(38), deg(18))],
  [at.oscillation + 3500, pose(frame(1.2), TURN - deg(10), deg(24))],
  [at.offering, pose(frame(1.25), TURN - deg(36), deg(18))],
  [at.offering + 2400, pose(frame(1.35), TURN)],
  [partStart('offering', 'vesica'), pose(frame(1.35), TURN)],
  [partStart('offering', 'vesica') + 1800, pose(frame(1.45), TURN, 0, TREE.CIRCLE / 2)],
  [at.handoff + 1500, pose(frame(1.45), TURN, 0, TREE.CIRCLE / 2)],
]);

const smooth = (x) => x * x * (3 - 2 * x);
const lerp = (a, b, x) => a + (b - a) * x;

/**
 * The camera pose at genesis time t: a point on a sphere around the target
 * (distance, azimuth about +Y, elevation), looking at the target. Pure.
 * @param {number} t ms
 */
export const cameraAt = (t) => {
  let i = 0;
  while (i < KEYS.length - 1 && t >= KEYS[i + 1][0]) i += 1;
  const [t0, a] = KEYS[i];
  const [t1, b] = KEYS[Math.min(i + 1, KEYS.length - 1)];
  const x = t1 > t0 ? smooth(Math.min(1, Math.max(0, (t - t0) / (t1 - t0)))) : 0;
  const dist = lerp(a.dist, b.dist, x);
  const az = lerp(a.az, b.az, x);
  const el = lerp(a.el, b.el, x);
  const tx = lerp(a.tx, b.tx, x);
  return {
    x: tx + dist * Math.cos(el) * Math.sin(az),
    y: dist * Math.sin(el),
    z: dist * Math.cos(el) * Math.cos(az),
    target: { x: tx, y: 0, z: 0 },
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
 * up +Y). `ahead` is false for points behind the camera. Pure.
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
  return { x: ((nx + 1) / 2) * 100, y: ((1 - ny) / 2) * 100, ahead: depth > 0 };
};
