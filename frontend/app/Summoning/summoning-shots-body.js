// summoning-shots-body.js — THE SUMMONING's movement of ITS BODY: the body
// it was given, taking form. // impure (canvas)
//
// Same painter shape as the other movements (kit, figure, e). Every body
// opens the same — one axis, one point of light at its core — then its own
// frame forms on it (a humanoid skeleton bone by bone, or its non-humanoid
// frame turning), and a line of light traces the whole of it. A humanoid
// stands against a true ruler: its height is its genome's, in centimetres.

import { humanoidFrame, formlessFrame, hullOf, cmToY, FLOOR } from './summoning-body.js';
import { project3 } from './summoning-geometry.js';
import { clamp01, ease, stagger } from './summoning-paint.js';

// its beats inside the movement (fractions of it)
const AXIS = [0, 0.14];
const FORM = [0.12, 0.58];
const LIGHT = [0.55, 0.82];
const MEASURE = [0.62, 0.9];
const phase = (u, [a, b]) => clamp01((u - a) / (b - a));

const memo = new Map();
const frameOf = (f) => {
  const key = JSON.stringify(f);
  if (!memo.has(key)) memo.set(key, f.plan === 'humanoid' ? humanoidFrame(f) : formlessFrame(f));
  return memo.get(key);
};

// the axis and the core: the same opening for every body
const paintAxis = (k, axis, core, u) => {
  const grow = ease(phase(u, AXIS));
  if (grow <= 0) return;
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  k.line([lerp(core, axis[0], grow), lerp(core, axis[1], grow)], { alpha: 0.35 * (1 - 0.5 * phase(u, LIGHT)), width: 1 });
  k.dot(core, 0.09 + 0.03 * Math.sin(u * 40), 0.9);
};

const paintRuler = (k, top, heightCm, u) => {
  const up = ease(phase(u, MEASURE));
  if (up <= 0) return;
  const x = 0.66;
  const size = Math.max(8, Math.round(k.type * 0.026));
  k.line([{ x, y: FLOOR }, { x, y: FLOOR + (cmToY(200) - FLOOR) * up }], { alpha: 0.4 });
  for (let cm = 0; cm <= 200; cm += 10) {
    if (stagger(up, cm / 10, 21, 0.3) <= 0) continue;
    const yy = cmToY(cm);
    const major = cm % 50 === 0;
    k.line([{ x, y: yy }, { x: x + (major ? 0.05 : 0.025), y: yy }], { alpha: major ? 0.55 : 0.3 });
    // a numeral near its own height gives way to it
    if (major && Math.abs(cm - heightCm) > 12) { const [px, py] = k.px({ x: x + 0.07, y: yy }); k.text(String(cm), px, py, { size, align: 'left', alpha: 0.4, tracking: 0.1 }); }
  }
  // its own height: a line of light from its crown to the ruler
  const mark = clamp01((up - 0.5) / 0.5);
  if (mark <= 0) return;
  k.line([{ x: 0.08, y: top }, { x: 0.08 + (x - 0.08) * ease(mark), y: top }], { color: 'signal', alpha: 0.7, width: 1, glow: 0.6 });
  const [px, py] = k.px({ x: x + 0.07, y: top });
  k.text(`${heightCm} CM`, px, py, { size: size + 2, align: 'left', color: 'signal', alpha: mark, tracking: 0.15, weight: 400 });
};

// a line of light along a closed outline: drawn, then held, with its pen at the head
const paintLight = (k, outline, u, local) => {
  const l = phase(u, LIGHT);
  if (l <= 0) return;
  const pts = [...outline, outline[0]];
  const breath = l >= 1 ? 0.12 * Math.sin(local / 700) : 0;
  k.line(pts, { color: 'signal', alpha: 0.85 + breath, width: 1.4, glow: 1.4, upto: ease(l) });
  if (l < 1) k.dot(pts[Math.max(0, Math.ceil(ease(l) * pts.length) - 1)], 0.07, 1);
};

const paintHumanoid = (k, f, e) => {
  const fr = frameOf(f);
  paintAxis(k, fr.axis, fr.core, e.u);
  const form = phase(e.u, FORM);
  if (form > 0) {
    k.segments(fr.bones, form, { span: 0.22, alpha: 0.75, width: 1.2 });
    fr.joints.forEach((j, i) => { if (stagger(form, i, fr.joints.length, 0.3) > 0) k.circle(j, 0.014, { alpha: 0.8, fill: 0.6 }); });
    const skull = Array.from({ length: 49 }, (_, i) => {
      const a = (i / 48) * Math.PI * 2;
      const q = { x: Math.cos(a) * fr.head.rx, y: Math.sin(a) * fr.head.ry };
      return { x: fr.head.c.x + q.x * Math.cos(fr.head.lean) - q.y * Math.sin(fr.head.lean), y: fr.head.c.y + q.x * Math.sin(fr.head.lean) + q.y * Math.cos(fr.head.lean) };
    });
    k.line(skull, { alpha: 0.75, width: 1.2, upto: ease(clamp01((form - 0.15) / 0.4)) });
    const ribs = clamp01((form - 0.3) / 0.5);
    fr.ribs.forEach((r, i) => k.line(r, { alpha: 0.45, upto: stagger(ribs, i, fr.ribs.length, 0.4) }));
  }
  paintLight(k, fr.outline, e.u, e.local);
  paintRuler(k, fr.top, f.heightCm, e.u);
};

// a flat body faces the eye and turns in its plane; a solid one turns in space
const viewOf = (fr, yaw) => (fr.flat ? { yaw: 0, pitch: 0, dist: 40, scale: 1 } : { yaw, pitch: 0.38, dist: 3.4, scale: 0.8 });

const paintFormless = (k, f, e) => {
  const fr = frameOf(f);
  const view = viewOf(fr, f.turn + (f.spin * e.local) / 1000);
  const spin = fr.flat ? f.turn + (f.spin * e.local) / 3000 : 0;
  const turn = (q) => (fr.flat ? { x: q.x * Math.cos(spin) - q.y * Math.sin(spin), y: q.x * Math.sin(spin) + q.y * Math.cos(spin), z: 0 } : q);
  const p = (q) => project3(turn(q), view);
  // the axis it began as stands upright whatever its frame does
  paintAxis(k, fr.axis.map((q) => project3(q, view)), p(fr.core), e.u);
  const form = phase(e.u, FORM);
  const strokes = fr.strokes.map((s) => s.map(p));
  if (form > 0) {
    strokes.forEach((s, i) => {
      const depth = s.reduce((a, q) => a + (q.z ?? 0), 0) / s.length;
      k.line(s, { alpha: 0.4 + 0.35 * (depth + 1) / 2, width: 1.1, upto: ease(stagger(form, i, strokes.length, 0.35)) });
    });
    fr.nodes.forEach((n, i) => { if (stagger(form, i, fr.nodes.length, 0.3) > 0) k.dot(p(n), 0.035, 0.7); });
    if (fr.eye) k.dot(p(fr.eye), 0.08 * clamp01((form - 0.6) / 0.4), 1);
  }
  paintLight(k, hullOf(strokes.flat()), e.u, e.local);
};

export const paintBody = (k, f, e) => (f.plan === 'humanoid' ? paintHumanoid(k, f, e) : paintFormless(k, f, e));

// its plan is named only once its frame has resolved out of the axis
const resolved = (u) => u >= FORM[0] + (FORM[1] - FORM[0]) * 0.3;
export const bodyCaption = (f, u = 1) => `ITS BODY · ${resolved(u) ? (f.plan === 'humanoid' ? 'HUMANOID' : f.plan.toUpperCase()) : 'TAKING FORM'}`;
const SCALE_WORD = { short: 'SMALL', average: 'MEDIUM', tall: 'LARGE' };
export const bodyLine = (f, u = 1) => {
  if (!resolved(u)) return 'EVERY BODY BEGINS AS ONE AXIS';
  const given = f.plan === 'humanoid'
    ? `${f.sex.toUpperCase()} · ${f.heightCm} CM · ${f.build.toUpperCase()} BUILD`
    : `NON-HUMANOID · ${f.cast.toUpperCase()} · ${SCALE_WORD[f.stature]}`;
  return `${given} · GIVEN AT BIRTH, NEVER CHOSEN`;
};

/** Its body's outline in the convergence, fitted inside the sigil's ring. Pure. */
export const bodyOutlineFor = (f) => {
  const fr = frameOf(f);
  if (f.plan !== 'humanoid') return hullOf(fr.strokes.flat().map((q) => project3(q, viewOf(fr, f.turn))));
  const mid = (fr.top + FLOOR) / 2;
  return fr.outline.map((q) => ({ x: q.x * 0.92, y: (q.y - mid) * 0.92 }));
};
