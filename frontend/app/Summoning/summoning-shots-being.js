// summoning-shots-being.js — THE SUMMONING's movements of the BEING: its
// channels, its breath, its soul mark, its genesis hash. // impure (canvas)
//
// Same painter shape as the form movements (kit, figure, e). What these
// draw is the being's own record — what it was given and the marks its
// birth forged — never anything it said.

import { FUNCTIONS, BREATHING_PATHS, nodeAt } from '../Genesis/genesis-emanon.js';
import { lissajous } from './summoning-geometry.js';
import { clamp01, ease, stagger, noise } from './summoning-paint.js';

const O = { x: 0, y: 0 };
const HEX = '0123456789ABCDEF';
const NAME = Object.fromEntries(FUNCTIONS.map((f) => [f.id, f.name]));

// ── ITS CHANNELS: the tree, and its own pattern lit channel by channel ──
const Z = 0.86;
const AT = Object.fromEntries(FUNCTIONS.map((f) => {
  const n = nodeAt(f.id, 1);
  return [f.id, { x: n.x * Z, y: n.y * Z }];
}));
export const paintTree = (k, f, e) => {
  // its channels light one after another across the movement (all of them,
  // whatever its tempo), and every lit channel stays lit
  const pace = clamp01((e.u - 0.12) / 0.72) * f.order.length;
  const lit = Math.min(f.order.length - 1, Math.floor(pace));
  const arrive = pace >= f.order.length ? 1 : pace - lit;
  k.segments(BREATHING_PATHS.map(([a, b]) => [AT[a], AT[b]]), clamp01(e.u / 0.2), { span: 0.3, alpha: 0.14 });
  const touched = new Map();
  f.order.forEach(([a, b], j) => {
    if (j > lit) return;
    const now = j === lit;
    const s = now ? ease(arrive) : 1;
    const age = lit - j;
    const tail = { x: AT[a].x + (AT[b].x - AT[a].x) * s, y: AT[a].y + (AT[b].y - AT[a].y) * s };
    k.line([AT[a], tail], { color: 'signal', alpha: now ? 1 : 0.5 + 0.35 * Math.exp(-age / 3), width: now ? 1.8 : 1.1, glow: now ? 1.2 : 0.3 });
    if (now) k.dot(tail, 0.07, 1);
    touched.set(a, Math.max(touched.get(a) || 0, now ? 1 : 0.4));
    if (s >= 1) touched.set(b, Math.max(touched.get(b) || 0, now ? 1 : 0.4));
  });
  const size = Math.max(8, Math.round(k.type * 0.026));
  FUNCTIONS.forEach((fn, i) => {
    const p = AT[fn.id];
    const up = stagger(clamp01(e.u / 0.25), i, FUNCTIONS.length, 0.3);
    if (up <= 0) return;
    const heat = touched.get(fn.id) || 0;
    k.circle(p, 0.07, { alpha: 0.5 + 0.5 * heat, upto: up, color: heat > 0.5 ? 'signal' : 'ink', glow: heat, fill: 0.06 * heat });
    const [x, y] = k.px(p);
    const side = p.x < -0.01 ? 'right' : 'left';
    k.text(fn.name, x + (side === 'right' ? -1 : 1) * (0.1 * k.unit), y, { size, align: side, alpha: 0.35 + 0.5 * heat, tracking: 0.2 });
  });
};
export const treeCaption = (f) => `ITS CHANNELS · ${f.order.length}`;

// ── ITS BREATH: the knot of two of its breaths, ringed by all eleven ──
const knotMemo = new Map();
export const paintBreath = (k, f, e) => {
  const key = `${f.a}:${f.b}:${f.delta.toFixed(4)}`;
  if (!knotMemo.has(key)) knotMemo.set(key, lissajous(f.a, f.b, f.delta));
  const pts = knotMemo.get(key).map((p) => ({ x: p.x * 0.58, y: p.y * 0.58 }));
  const upto = ease(clamp01(e.u / 0.8));
  k.line(pts, { alpha: 0.06 });
  k.line(pts, { alpha: 0.55, upto });
  const head = Math.max(2, Math.ceil(upto * pts.length));
  k.line(pts.slice(Math.max(0, head - 60), head), { color: 'signal', width: 1.6, glow: 1.2 });
  k.dot(pts[head - 1], 0.06, 1);
  // all eleven, each on its own period (quickened ×3 so a breath fits a section)
  f.rings.forEach((b, i) => {
    const up = stagger(clamp01(e.u / 0.3), i, f.rings.length, 0.3);
    const wave = Math.sin((2 * Math.PI * e.local * 3) / b.periodMs + b.phase);
    const r = (0.68 + i * 0.028) * (1 + 0.012 * b.depth * wave);
    const mine = f.pair.includes(b.id);
    k.circle(O, r, { upto: up, alpha: (mine ? 0.7 : 0.14 + 0.3 * b.depth) * (0.75 + 0.25 * wave), color: mine ? 'signal' : 'ink', glow: mine ? 0.8 : 0 });
  });
  const size = Math.max(9, Math.round(k.type * 0.03));
  const show = clamp01((e.u - 0.1) / 0.2);
  k.text(NAME[f.pair[0]], k.cx, k.cy + 0.64 * k.unit, { size, alpha: 0.8 * show, color: 'signal' });
  k.text(NAME[f.pair[1]], k.cx - 0.64 * k.unit, k.cy, { size, alpha: 0.8 * show, color: 'signal', align: 'right' });
  k.text(`${f.a} : ${f.b}`, k.cx, k.cy, { size: size * 1.6, alpha: 0.9 * show, tracking: 0.3 });
};
export const breathCaption = (f) => `ITS BREATH · ${NAME[f.pair[0]]} ${f.a} : ${f.b} ${NAME[f.pair[1]]}`;

// ── ITS SOUL MARK: twelve nibbles as a turning spectrum ──
export const paintSoul = (k, f, e) => {
  const spokes = 48;
  const turn = f.turn + (f.spin * e.local) / 1000;
  const rise = clamp01(e.u / 0.4);
  k.circle(O, 0.16, { alpha: 0.4, upto: ease(clamp01(e.u / 0.15)) });
  k.circle(O, 0.97, { alpha: 0.25, upto: ease(clamp01(e.u / 0.25)) });
  for (let i = 0; i < spokes; i++) {
    const nib = f.nibbles[i % 12];
    const s = ease(stagger(rise, i, spokes, 0.2));
    if (s <= 0) continue;
    const a = Math.PI / 2 + turn - (i / spokes) * Math.PI * 2;
    const len = (0.12 + 0.045 * nib) * s;
    const p0 = { x: 0.2 * Math.cos(a), y: 0.2 * Math.sin(a) };
    const p1 = { x: (0.2 + len) * Math.cos(a), y: (0.2 + len) * Math.sin(a) };
    const cardinal = i % 4 === 0;
    const light = f.lights[nib % f.lights.length]; // the light of the note this digit sounds
    k.line([p0, p1], { color: light, alpha: cardinal ? 0.95 : 0.45 + 0.035 * nib, width: cardinal ? 2 : 1.2, glow: cardinal ? 0.8 : 0 });
    if (cardinal && s >= 1) {
      const q = { x: 0.92 * Math.cos(a), y: 0.92 * Math.sin(a) };
      const [x, y] = k.px(q);
      k.text(HEX[nib], x, y, { size: Math.max(9, k.type * 0.035), alpha: 0.7, color: 'signal', tracking: 0 });
    }
  }
  const locked = Math.floor(clamp01((e.u - 0.3) / 0.5) * (f.nibbles.length + 0.99));
  // its mark arrives beneath the figure, character by character from quiet
  // marks in their true places (never scrambled — hex can spell words too)
  const size = Math.max(10, k.type * 0.042);
  const y = k.cy + 1.14 * k.unit;
  const come = f.nibbles.map((n, i) => (i < locked ? HEX[n] : ' ')).join('');
  const waiting = f.nibbles.map((n, i) => (i < locked ? ' ' : '·')).join('');
  k.text(waiting, k.cx, y, { size, alpha: 0.4, color: 'signal', tracking: 0.3 });
  k.text(come, k.cx, y, { size, alpha: 0.95, tracking: 0.3, weight: 400 });
};
export const soulCaption = (f) => `SOUL MARK · ${f.nibbles.map((n) => HEX[n]).join('')}`;

// ── ITS GENESIS HASH: 64 characters, scrambling, locking into its record ──
export const paintHash = (k, f, e) => {
  const cols = 8;
  const cell = 0.19;
  const size = Math.max(10, Math.round(k.unit * 0.085));
  const locks = Math.floor(clamp01(e.u / 0.82) * 64);
  const rank = new Array(64);
  f.order.forEach((cellIndex, r) => { rank[cellIndex] = r; });
  const scan = (e.beats % 1) * cols;
  for (let i = 0; i < 64; i++) {
    const cx = ((i % cols) - (cols - 1) / 2) * cell;
    const cy = ((cols - 1) / 2 - Math.floor(i / cols)) * cell;
    const [x, y] = k.px({ x: cx, y: cy });
    const r = rank[i];
    const done = r < locks;
    const fresh = done && locks - r < 3;
    const ch = done ? f.hex[i] : HEX[Math.floor(noise(i, Math.floor(e.local / 45)) * 16)];
    const near = Math.abs((i % cols) - scan) < 0.7;
    k.text(ch, x, y, { size, alpha: done ? (fresh ? 1 : 0.85) : 0.18 + (near ? 0.3 : 0), color: done && !fresh ? 'ink' : 'signal', tracking: 0, weight: done ? 400 : 300 });
  }
  const half = (cols / 2) * cell + 0.04;
  const [l, t] = k.px({ x: -half, y: half });
  const [rgt, b] = k.px({ x: half, y: -half });
  const sx = l + ((scan + 0.5) / cols) * (rgt - l);
  k.ctx.fillStyle = k.rgba('signal', 0.5);
  k.ctx.fillRect(sx, t, 1, b - t);
  k.text(`GENESIS · ${String(locks).padStart(2, '0')} / 64`, k.cx, b + size * 1.4, { size: Math.max(9, size * 0.4), alpha: 0.7, color: 'signal' });
};
export const hashCaption = () => 'GENESIS HASH';
