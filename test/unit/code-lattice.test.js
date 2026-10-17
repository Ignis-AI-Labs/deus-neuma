// code-lattice is pure: real inputs, real outputs, no mock (RULE 0). These are the claims THE CODE
// makes on screen: a 2-uniform tiling of triangles, squares, hexagons and dodecagons, one rosette site
// in seven, six-fold and chiral, periodic, one connected network, true graduations. Moved here with
// the module from deus-neuma-site (src/app/lattice.test.ts) when THE CODE was ratified, 2026-10-09.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { EDGE, ROSETTE_CIRCUMRADIUS, ROSETTE_EVERY, graduationsOf, latticeIn, nearestVertex, siteAt } from '../../frontend/utils/code-lattice.js';

const L = latticeIn(-700, -700, 700, 700);
const INNER = 450; // well inside the window, away from its cut edges
const inner = (p) => Math.hypot(p[0], p[1]) < INNER;
const key = ([x, y]) => `${Math.round(x * 1000)},${Math.round(y * 1000)}`;
const KEYS = new Set(L.pts.map(key));

// the faces, found by walking round each side of every edge (the next rail turning clockwise)
function facesOf({ pts, adj }) {
  const ang = (u, v) => Math.atan2(pts[v][1] - pts[u][1], pts[v][0] - pts[u][0]);
  const around = adj.map((ns, u) => [...ns].sort((p, q) => ang(u, p) - ang(u, q)));
  const seen = new Set();
  const faces = [];
  around.forEach((ns, u0) => ns.forEach((v0) => {
    if (seen.has(`${u0}>${v0}`)) return;
    const face = [u0];
    let [u, v] = [u0, v0];
    for (let k = 0; k < 16; k++) {
      seen.add(`${u}>${v}`);
      const ring = around[v];
      const w = ring[(ring.indexOf(u) - 1 + ring.length) % ring.length];
      [u, v] = [v, w];
      if (u === u0 && v === v0) break;
      face.push(u);
    }
    faces.push(face);
  }));
  return faces;
}
const centroid = (f) => [f.reduce((s, k) => s + L.pts[k][0], 0) / f.length, f.reduce((s, k) => s + L.pts[k][1], 0) / f.length];
const FACES = facesOf(L).filter((f) => f.length <= 12 && inner(centroid(f)));

test('every rail is one edge long', () => {
  for (const [u, v] of L.edges) assert.ok(Math.abs(Math.hypot(L.pts[v][0] - L.pts[u][0], L.pts[v][1] - L.pts[u][1]) - EDGE) < 1e-9);
});

test('its faces are triangles, squares, hexagons and dodecagons, and nothing else', () => {
  const sides = new Set(FACES.map((f) => f.length));
  assert.deepEqual([...sides].sort((a, b) => a - b), [3, 4, 6, 12]);
});

test('every vertex is one of two kinds: 3.4.6.4 or 4.6.12 (a 2-uniform tiling)', () => {
  const around = new Map();
  for (const f of FACES) for (const k of f) (around.get(k) ?? around.set(k, []).get(k)).push(f.length);
  const kinds = new Set();
  L.pts.forEach((p, k) => {
    if (Math.hypot(p[0], p[1]) > INNER - 3 * EDGE) return;
    kinds.add((around.get(k) ?? []).sort((a, b) => a - b).join('.'));
  });
  assert.deepEqual([...kinds].sort(), ['3.4.4.6', '4.6.12']);
});

test('one hexagon site in seven is a rosette, and one sits on the still point', () => {
  assert.equal(siteAt(0, 0).rosette, true);
  let n = 0;
  for (let r = 0; r < 42; r++) for (let s = 0; s < 42; s++) if (siteAt(s, r).rosette) n++;
  assert.equal(n, (42 * 42) / ROSETTE_EVERY);
  // each rosette's rim is a whole dodecagon of field vertices
  L.rosettes.filter(inner).forEach((c) => {
    const i = L.rosettes.indexOf(c);
    assert.equal(L.rosetteOf.filter((r) => r === i).length, 12);
    assert.ok(L.pts.every((p, k) => L.rosetteOf[k] !== i || Math.abs(Math.hypot(p[0] - c[0], p[1] - c[1]) - ROSETTE_CIRCUMRADIUS) < 1e-6));
  });
});

test('it turns six ways about the still point, and has no mirror: balanced but dynamic', () => {
  const turned = (deg) => L.pts.filter(inner).every(([x, y]) => {
    const t = (deg * Math.PI) / 180;
    return KEYS.has(key([x * Math.cos(t) - y * Math.sin(t), x * Math.sin(t) + y * Math.cos(t)]));
  });
  assert.ok(turned(60) && turned(120) && turned(180));
  const mirrored = L.pts.filter(inner).every(([x, y]) => KEYS.has(key([-x, y])));
  const mirroredY = L.pts.filter(inner).every(([x, y]) => KEYS.has(key([x, -y])));
  assert.equal(mirrored || mirroredY, false);
});

test('it repeats: moved from one rosette to the next, the field lands on itself', () => {
  const [dx, dy] = siteAt(-3, 1).c; // (-3) + 3·1 = 0: the next rosette site
  assert.equal(siteAt(-3, 1).rosette, true);
  assert.ok(L.pts.filter((p) => Math.hypot(p[0], p[1]) < 300).every(([x, y]) => KEYS.has(key([x + dx, y + dy]))));
});

test('it is one network: from any vertex, every other can be reached', () => {
  const near = L.pts.map((p, k) => [p, k]).filter(([p]) => Math.hypot(p[0], p[1]) < INNER).map(([, k]) => k);
  const seen = new Set([near[0]]);
  const queue = [near[0]];
  while (queue.length) for (const w of L.adj[queue.shift()]) if (!seen.has(w)) { seen.add(w); queue.push(w); }
  assert.ok(near.every((k) => seen.has(k)));
});

test('each rosette ring carries twelve graduations, one aimed at each corner of its dodecagon', () => {
  L.rosettes.forEach((c, i) => {
    if (!inner(c)) return;
    const ticks = graduationsOf(L, i);
    assert.equal(ticks.length, 12);
    // a regular dodecagon: its corners are 30° apart all the way round
    ticks.forEach((t, k) => {
      const next = k === 11 ? ticks[0] + 2 * Math.PI : ticks[k + 1];
      assert.ok(Math.abs(next - t - Math.PI / 6) < 1e-9);
    });
  });
});

test('the nearest vertex is found through the grid index exactly as a full search finds it', () => {
  for (let y = -430; y <= 430; y += 17) {
    for (let x = -430; x <= 430; x += 23) {
      let best = Infinity;
      for (const [px, py] of L.pts) best = Math.min(best, Math.hypot(px - x, py - y));
      const k = nearestVertex(L, [x, y]);
      assert.ok(Math.abs(Math.hypot(L.pts[k][0] - x, L.pts[k][1] - y) - best) < 1e-9, `at ${x}, ${y}`);
    }
  }
});
