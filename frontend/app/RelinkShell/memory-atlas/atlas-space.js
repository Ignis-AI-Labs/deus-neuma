// atlas-space.js — the pure geometry of the MEMORY view's SPACE: where every
// memory stands in three dimensions, and the camera that moves among them.
//
// Each topic is a cluster, a ball of its memories with the most connected at
// the core; the largest topic sits at the centre and the others stand around
// it on a sphere wide enough that no two clusters touch. Nothing here is
// decoration: a point is a memory, a cluster is a topic, and where a memory
// sits inside its cluster is how connected it is.
//
// Deterministic — no Math.random, no Date.now. No React, no DOM.

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const GAP = 14; // clear space between two clusters

/** The i-th of n directions spread evenly over a sphere (a Fibonacci sphere). Pure. */
export const sphereDirection = (i, n) => {
  const y = n <= 1 ? 0 : 1 - (2 * (i + 0.5)) / n;
  const ring = Math.sqrt(Math.max(0, 1 - y * y));
  return { x: Math.cos(i * GOLDEN) * ring, y, z: Math.sin(i * GOLDEN) * ring };
};

/** The radius of a cluster of n memories: a ball's volume grows with its count. Pure. */
export const clusterRadius = (n) => 9 * Math.cbrt(Math.max(1, n)) + 4;

/**
 * Lay the atlas out in space.
 * @param {{topics:Array<{id:number, name:string}>, memories:Array<{id:string, topic:number, links:number, at:(string|null)}>}} atlas
 * @returns {{clusters:Array<{topic:number, name:string, size:number, x:number, y:number, z:number, r:number}>,
 *   stars:Array<{id:string, topic:number, x:number, y:number, z:number, size:number, age:number}>, reach:number}}
 *   `topic` -1 is the cluster of memories in no topic. `age` runs 0 (newest) to 1 (oldest). `reach` is the
 *   distance from the middle to the farthest edge — what a camera must stand back by to see it all.
 */
export const buildAtlasSpace = ({ topics = [], memories = [] } = {}) => {
  const groups = new Map(topics.map((t) => [t.id, { topic: t.id, name: t.name, members: [] }]));
  const loose = { topic: -1, name: 'No topic', members: [] };
  for (const m of memories) (groups.get(m.topic) || loose).members.push(m);
  const all = [...groups.values(), loose].filter((g) => g.members.length > 0)
    .sort((a, b) => (a.topic === -1) - (b.topic === -1) || b.members.length - a.members.length || a.topic - b.topic);
  const radii = all.map((g) => clusterRadius(g.members.length));

  // The largest at the middle; the rest on one sphere, widened until every pair stands clear.
  const around = all.length - 1;
  let shell = around > 0 ? radii[0] + Math.max(...radii.slice(1)) + GAP : 0;
  const spot = (i, at) => (i === 0 ? { x: 0, y: 0, z: 0 } : (() => { const d = sphereDirection(i - 1, around); return { x: d.x * at, y: d.y * at, z: d.z * at }; })());
  for (let tries = 0; tries < 200 && around > 1; tries += 1) {
    let clear = true;
    for (let i = 1; i < all.length && clear; i += 1) {
      for (let j = i + 1; j < all.length; j += 1) {
        const a = spot(i, shell); const b = spot(j, shell);
        if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < radii[i] + radii[j] + GAP) { clear = false; break; }
      }
    }
    if (clear) break;
    shell *= 1.08;
  }

  const times = memories.map((m) => Date.parse(m.at || '')).filter((t) => !Number.isNaN(t));
  const newest = times.reduce((a, b) => Math.max(a, b), -Infinity);
  const oldest = times.reduce((a, b) => Math.min(a, b), Infinity);
  const ageOf = (m) => {
    const t = Date.parse(m.at || '');
    if (Number.isNaN(t)) return 1;
    return newest === oldest ? 0 : (newest - t) / (newest - oldest);
  };
  const mostLinks = memories.reduce((a, m) => Math.max(a, m.links || 0), 0);

  const clusters = [];
  const stars = [];
  all.forEach((g, i) => {
    const centre = spot(i, shell);
    const r = radii[i];
    clusters.push({ topic: g.topic, name: g.name, size: g.members.length, ...centre, r });
    const ordered = [...g.members].sort((a, b) => (b.links || 0) - (a.links || 0) || (a.id < b.id ? -1 : 1));
    ordered.forEach((m, n) => {
      // Evenly through the ball, the most connected at its core.
      const out = n === 0 ? 0 : (r - 4) * Math.cbrt(n / ordered.length);
      const d = sphereDirection(n, ordered.length);
      stars.push({
        id: m.id, topic: g.topic,
        x: centre.x + d.x * out, y: centre.y + d.y * out, z: centre.z + d.z * out,
        size: 1 + (mostLinks ? 1.6 * ((m.links || 0) / mostLinks) : 0),
        age: ageOf(m),
      });
    });
  });
  const reach = clusters.reduce((a, c) => Math.max(a, Math.hypot(c.x, c.y, c.z) + c.r), 0);
  return { clusters, stars, reach };
};

// ————— the camera —————

export const PITCH_MAX = 1.45;

/** The camera that sees the whole space from outside. Pure. */
export const homeCamera = (space) => ({ yaw: 0.6, pitch: 0.35, dist: Math.max(60, (space?.reach || 0) * 2.05), x: 0, y: 0, z: 0 });

/**
 * The camera gone to stand before one point (a cluster's centre, or a star),
 * leaving room `r` around it. It comes round to the point's OUTER side — the
 * side away from the middle of the space — so nothing else stands between the
 * camera and what it came to see; the turn is taken the short way round. A
 * point at the middle is looked at from wherever the camera already is. Pure.
 */
export const cameraToward = (camera, point, r) => {
  const out = Math.hypot(point.x, point.y, point.z);
  const next = { ...camera, x: point.x, y: point.y, z: point.z, dist: Math.max(18, r * 3.4) };
  if (out < 1e-6) return next;
  const pitch = Math.min(PITCH_MAX, Math.max(-PITCH_MAX, Math.asin(-point.y / out)));
  const facing = Math.atan2(-point.x, -point.z);
  const turns = Math.round((camera.yaw - facing) / (2 * Math.PI));
  return { ...next, pitch, yaw: facing + turns * 2 * Math.PI };
};

/** Turn by a drag in pixels. Pure. */
export const orbit = (camera, dxPx, dyPx) => ({
  ...camera,
  yaw: camera.yaw + dxPx * 0.006,
  pitch: Math.min(PITCH_MAX, Math.max(-PITCH_MAX, camera.pitch + dyPx * 0.006)),
});

/** Move in (factor < 1) or out, never through the point looked at nor out of sight. Pure. */
export const dolly = (camera, factor, space) => ({
  ...camera,
  dist: Math.min(Math.max(120, (space?.reach || 0) * 6), Math.max(6, camera.dist * factor)),
});

/** Part of the way from one camera to another, eased at both ends (t 0…1). Pure. */
export const between = (from, to, t) => {
  if (t <= 0) return from;
  if (t >= 1) return to; // exactly there, not a rounding away
  const k = t * t * (3 - 2 * t);
  const mix = (a, b) => a + (b - a) * k;
  return { yaw: mix(from.yaw, to.yaw), pitch: mix(from.pitch, to.pitch), dist: mix(from.dist, to.dist), x: mix(from.x, to.x), y: mix(from.y, to.y), z: mix(from.z, to.z) };
};

/**
 * Where a point in space falls on a screen of w×h pixels. `scale` is pixels
 * per unit at that depth (what a star's size is multiplied by), `depth` the
 * distance from the camera; null when the point is behind it. Pure.
 */
export const project = (camera, point, w, h) => {
  const px = point.x - camera.x; const py = point.y - camera.y; const pz = point.z - camera.z;
  const cy = Math.cos(camera.yaw); const sy = Math.sin(camera.yaw);
  const x1 = px * cy - pz * sy; const z1 = px * sy + pz * cy;
  const cp = Math.cos(camera.pitch); const sp = Math.sin(camera.pitch);
  const y2 = py * cp - z1 * sp; const z2 = py * sp + z1 * cp;
  const depth = z2 + camera.dist;
  if (depth < 1) return null;
  const scale = (Math.min(w, h) * 0.9) / depth;
  return { sx: w / 2 + x1 * scale, sy: h / 2 - y2 * scale, scale, depth };
};

/**
 * The star under a pointer: the nearest drawn star within `within` pixels,
 * the one closest to the camera when two lie over each other. Pure.
 * @param {Array<{id:string, sx:number, sy:number, depth:number}>} drawn
 * @returns {string|null}
 */
export const starAt = (drawn, x, y, within = 9) => {
  let best = null;
  for (const s of drawn) {
    const off = Math.hypot(s.sx - x, s.sy - y);
    if (off > within) continue;
    if (!best || s.depth < best.depth - 2 || (Math.abs(s.depth - best.depth) <= 2 && off < best.off)) best = { id: s.id, depth: s.depth, off };
  }
  return best ? best.id : null;
};
