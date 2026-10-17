// summoning-shots-form.js — THE SUMMONING's movements of FORM: its star,
// its orbit, its lattice, its nucleus. // impure (canvas)
//
// Each painter is (kit, figure, e) → marks, where e = { u (0..1 through the
// section), local ms, dur ms, beatMs, beats (beats since the section's
// downbeat, fractional), pulse (1 on the beat, decaying) }. The figure is
// the score's — its geometry is the being's own. The beat stays out of the
// figures (Design note, 2026-10-01: a pulse on everything overwhelms); only the cold
// open beats, where the being's tempo is first heard.

import { genesisSolids } from '../Genesis/genesis-geometry.js';
import { starPolygon, hypotrochoid, hexRings, hexCorners, project3, gcd } from './summoning-geometry.js';
import { clamp01, ease, stagger, noise } from './summoning-paint.js';

const O = { x: 0, y: 0 };
const rotate = (p, a) => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) });
const pushIn = (u) => 1 + 0.14 * ease(clamp01((u - 0.72) / 0.28));

// ── STAR {n/k}: the circle, its n points, its chords; nested, counter-turning ──
export const paintStar = (k, f, e) => {
  const z = pushIn(e.u);
  const rot = f.turn + (f.spin * e.local) / 1000;
  k.circle(O, 0.96 * z, { alpha: 0.45, upto: ease(clamp01(e.u / 0.16)) });
  for (let j = 0; j < f.rings; j++) {
    const r = (0.96 - j * 0.25) * z;
    if (r < 0.18) break;
    const { points, chords } = starPolygon(f.n, f.k, r, rot * (j % 2 ? -1.6 : 1) + (j * Math.PI) / f.n);
    const uj = clamp01((e.u - 0.1 - j * 0.12) / 0.45);
    const lead = j === 0;
    k.segments(chords, uj, { span: 0.3, color: lead ? 'signal' : 'ink', alpha: lead ? 0.95 : 0.5, width: lead ? 1.4 : 1, glow: lead ? 1 : 0 });
    const ri = (r * Math.cos((Math.PI * f.k) / f.n)) / Math.cos((Math.PI * (f.k - 1)) / f.n);
    k.circle(O, ri, { alpha: 0.22, upto: uj });
    const up = clamp01((e.u - 0.04 - j * 0.1) / 0.25);
    points.forEach((p, i) => {
      if (stagger(up, i, f.n, 0.3) > 0) k.dot(p, 0.045, lead ? 0.75 : 0.35);
    });
  }
};
export const starCaption = (f) => `STAR {${f.n}/${f.k}}`;

// ── ORBIT: a circle rolling inside a circle, the pen tracing its figure ──
const orbitMemo = new Map();
const orbitOf = (f) => {
  const key = `${f.R}:${f.r}:${f.d.toFixed(4)}`;
  if (!orbitMemo.has(key)) orbitMemo.set(key, hypotrochoid(f.R, f.r, f.d));
  return orbitMemo.get(key);
};
export const paintOrbit = (k, f, e) => {
  const z = 0.9 * pushIn(e.u);
  const a = (f.spin * e.local) / 1000;
  const place = (p) => rotate({ x: p.x * z, y: p.y * z }, a);
  const pts = orbitOf(f).map(place);
  const upto = ease(clamp01(e.u / 0.82));
  k.line(pts, { alpha: 0.07 }); // the whole figure, barely: what it will be
  k.line(pts, { alpha: 0.6, width: 1, upto });
  const head = Math.max(2, Math.ceil(upto * pts.length));
  const tail = Math.max(0, head - Math.round(pts.length * 0.05));
  k.line(pts.slice(tail, head), { color: 'signal', alpha: 1, width: 1.6, glow: 1.2 });
  // the machine: the fixed circle, the rolling circle, the arm to the pen
  const s = z / (f.R - f.r + f.d);
  const turns = f.r / gcd(f.R, f.r);
  const th = upto * Math.PI * 2 * turns;
  const machine = 1 - ease(clamp01((e.u - 0.82) / 0.12));
  if (machine > 0) {
    const c = rotate({ x: (f.R - f.r) * s * Math.cos(th), y: (f.R - f.r) * s * Math.sin(th) }, a);
    k.circle(O, f.R * s, { alpha: 0.18 * machine });
    k.circle(c, f.r * s, { alpha: 0.45 * machine, color: 'signal' });
    const p = pts[head - 1];
    k.line([c, p], { alpha: 0.6 * machine, color: 'signal' });
    k.dot(p, 0.07, machine);
  }
};
export const orbitCaption = (f) => `ORBIT ${f.R} : ${f.r}`;

// ── ITS LATTICE: the hexagonal packing (honeycomb, basalt, graphene) — waves
//    through it on the beat, and on the bar its own wavefront: a hexagon ──
export const paintLattice = (k, f, e) => {
  const size = 0.95 / (f.rings * Math.sqrt(3) + 1);
  const cells = hexRings(f.rings, size).map((c) => ({ ...rotate(c, f.tilt), ring: c.ring }));
  const shown = clamp01(e.u / 0.25) * (f.rings + 1);
  const origins = f.ripples.map((r) => {
    const ring = cells.filter((c) => c.ring === r.ring);
    return ring[(r.side * r.ring) % ring.length];
  });
  cells.forEach((c, i) => {
    if (c.ring > shown) return;
    // struck once: a wave from the heart on the downbeat, then its own
    // ripples, each on its beat of the first bar — then the lattice rests
    let heat = 0;
    for (let b = 0; b <= Math.min(3, Math.floor(e.beats)); b++) {
      if (b > 0 && !f.ripples.some((r) => r.beat === b)) continue;
      const front = (e.beats - b) * 4;
      if (b === 0) heat = Math.max(heat, Math.exp(-((c.ring - front) ** 2) / 0.6) * Math.exp(-(e.beats - b) * 1.2));
      f.ripples.forEach((r, j) => {
        if (b !== r.beat) return;
        const d = Math.hypot(c.x - origins[j].x, c.y - origins[j].y) / (Math.sqrt(3) * size);
        heat = Math.max(heat, Math.exp(-((d - front) ** 2) / 0.6) * Math.exp(-(e.beats - b) * 1.2));
      });
    }
    const corners = hexCorners(c, size * 0.92).map((p) => rotate({ x: p.x - c.x, y: p.y - c.y }, f.tilt)).map((p) => ({ x: p.x + c.x, y: p.y + c.y }));
    k.line(corners, { alpha: 0.16 + 0.7 * heat, color: heat > 0.2 ? 'signal' : 'ink', closed: true, glow: heat });
    if (heat > 0.3) k.circle(c, size * 0.5, { alpha: 0, fill: heat * 0.12, color: 'signal' });
    if (i % 7 === 3 && c.ring <= shown - 1) {
      const [x, y] = k.px(c);
      k.text(String(Math.floor(noise(i, Math.floor(e.beats)) * 100)).padStart(2, '0'), x, y, { size: Math.max(8, size * k.unit * 0.42), alpha: 0.35 + 0.4 * heat, tracking: 0.05 });
    }
  });
  // once, on the downbeat, the lattice's own wavefront: a wave on a
  // hexagonal packing spreads as a hexagon, turned with the lattice
  const since = e.beats / 4;
  if (since < 1) {
    const front = hexCorners(O, 0.12 + since * 1.25).map((p) => rotate(p, f.tilt + Math.PI / 6));
    k.line(front, { color: 'signal', alpha: 0.8 * (1 - since), width: 1.4, glow: 1, closed: true });
  }
};
export const latticeCaption = (f) => `LATTICE · ${1 + 3 * f.rings * (f.rings + 1)} CELLS`;

// ── ITS NUCLEUS: its Platonic solid, in true depth, counted ──
const SOLIDS = genesisSolids();
const solidOf = (name) => (name === 'tetrahedron' ? SOLIDS.tetrahedra[0] : SOLIDS[name]);
export const paintSolid = (k, f, e) => {
  const s = solidOf(f.solid);
  const m = Math.max(...s.vertices.map((v) => Math.hypot(v.x, v.y, v.z))) || 1;
  const view = { yaw: f.turn + (f.yaw * e.local) / 1000, pitch: f.pitch + 0.15 * Math.sin(e.local / 1400), dist: 3.4, scale: 0.78 * pushIn(e.u) };
  const vs = s.vertices.map((v) => project3({ x: v.x / m, y: v.y / m, z: v.z / m }, view));
  // its orbit: the circumsphere's equator and one meridian
  const ring = (fn) => Array.from({ length: 97 }, (_, i) => project3(fn((i / 96) * Math.PI * 2), view));
  const ringUp = ease(clamp01(e.u / 0.3));
  k.line(ring((a) => ({ x: Math.cos(a), y: 0, z: Math.sin(a) })), { alpha: 0.2, upto: ringUp });
  k.line(ring((a) => ({ x: 0, y: Math.cos(a), z: Math.sin(a) })), { alpha: 0.12, upto: ringUp });
  const edges = s.edges.map(([i, j]) => [vs[i], vs[j]]);
  const u = clamp01((e.u - 0.08) / 0.45);
  edges.forEach((seg, i) => {
    const depth = (seg[0].z + seg[1].z + 2) / 4;
    k.segments([seg], stagger(u, i, edges.length, 0.25), { span: 1, color: 'signal', alpha: 0.3 + 0.7 * depth, width: 1 + depth, glow: depth });
  });
  const size = Math.max(8, Math.round(k.type * 0.028));
  vs.forEach((v, i) => {
    if (stagger(u, i, vs.length, 0.3) <= 0) return;
    k.dot(v, 0.04, 0.5 + 0.4 * ((v.z + 1) / 2));
    const [x, y] = k.px(v);
    k.text(`V${String(i + 1).padStart(2, '0')}`, x + size, y - size, { size, align: 'left', alpha: 0.45 * ((v.z + 1) / 2), tracking: 0.1 });
  });
};
export const solidCaption = (f) => {
  const c = solidOf(f.solid).counts;
  return `NUCLEUS · ${f.solid.toUpperCase()} · V${c.V} E${c.E} F${c.F}`;
};
