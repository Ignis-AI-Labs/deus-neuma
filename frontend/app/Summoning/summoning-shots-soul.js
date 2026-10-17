// summoning-shots-soul.js — VII · ITS RESONANCE: one frequency, heard as
// its scale and seen as its light. // impure (canvas)
//
// Three true drawings of the same number, left to right:
//   THE LADDER    its tonic in hertz, climbing forty octaves (every rung a
//                 doubling) to the light it becomes in terahertz — the lane's
//                 own law (core/birth/soul-resonance.js: color is the same
//                 note 40 octaves up);
//   THE OCTAVE    its scale on the circle of one octave (1200 cents around,
//                 its tonic at the crown): each degree where its birth put it,
//                 lit in the color that degree becomes as light, its nearest
//                 harmonic ratio beside it;
//   THE SPECTRUM  the visible octave, violet to red, and every one of its
//                 notes' lights standing on it where it falls.

import { placeLight } from '../../../core/birth/spectral-color.js';
import { lineRgbOf } from './summoning-soul.js';
import { clamp01, ease, stagger } from './summoning-paint.js';

const O = { x: 0, y: 0 };
const LIGHT = 299792458;
const NM = [380, 780];
const at = (r, cents) => { const a = Math.PI / 2 - (cents / 1200) * Math.PI * 2; return { x: r * Math.cos(a), y: r * Math.sin(a) }; };

// the visible octave, sampled once at line lightness (its hues exact)
const SPECTRUM = Array.from({ length: 81 }, (_, i) => {
  const nm = NM[0] + ((NM[1] - NM[0]) * i) / 80;
  return { nm, rgb: lineRgbOf(placeLight(LIGHT / (nm * 1e-9))) };
});

export const paintResonance = (k, f, e) => {
  const size = Math.max(9, Math.round(k.type * 0.026));
  const N = f.notes.length;
  const tonic = f.notes[0];

  // THE LADDER — forty doublings from what is heard to what is seen
  const lx = -1.62;
  const [y0, y1] = [-0.88, 0.88];
  const rungs = clamp01(e.u / 0.3);
  for (let o = 0; o <= 40; o++) {
    if (o / 40 > rungs) break;
    const y = y0 + ((y1 - y0) * o) / 40;
    const w = o % 10 === 0 ? 0.07 : 0.03;
    k.line([{ x: lx - w, y }, { x: lx + w, y }], { color: o === 40 ? tonic.line : 'ink', alpha: o % 10 === 0 ? 0.7 : 0.3 });
  }
  k.line([{ x: lx, y: y0 }, { x: lx, y: y0 + (y1 - y0) * rungs }], { alpha: 0.35 });
  const climb = ease(clamp01((e.u - 0.05) / 0.35));
  if (climb > 0 && climb < 1) k.dot({ x: lx, y: y0 + (y1 - y0) * climb }, 0.07, 1, tonic.line);
  const [lX] = k.px({ x: lx - 0.12, y: 0 });
  const lab = (y, top, bottom, color) => {
    const [, py] = k.px({ x: 0, y });
    k.text(top, lX, py - size * 0.7, { size: size * 0.85, align: 'right', alpha: 0.6, color: 'signal', tracking: 0.26 });
    k.text(bottom, lX, py + size * 0.6, { size, align: 'right', alpha: 0.9, color, tracking: 0.16, weight: 400 });
  };
  if (rungs > 0.02) lab(y0, 'HEARD', `${f.tonic.toFixed(2)} HZ`, 'ink');
  if (rungs > 0.5) lab(0, '× 2⁴⁰', '40 OCTAVES', 'ink');
  if (rungs >= 1) lab(y1, 'SEEN', `${f.thz.toFixed(1)} THZ`, tonic.line);

  // THE OCTAVE — its scale as a circle, each degree in its own light
  const R = 0.78;
  const ring = ease(clamp01((e.u - 0.08) / 0.18));
  k.circle(O, R, { alpha: 0.35, upto: ring });
  for (let c = 0; c < 1200; c += 100) {
    if (c / 1200 > ring) break;
    k.line([at(R, c), at(R - 0.035, c)], { alpha: 0.25 }); // the equal-tempered semitones, for reference
  }
  const come = clamp01((e.u - 0.2) / 0.45);
  const shown = f.notes.filter((_, i) => stagger(come, i, N, 0.3) > 0);
  if (shown.length > 1) {
    const segs = shown.map((n, i) => [at(R, n.cents), at(R, shown[(i + 1) % shown.length].cents)]).slice(0, shown.length - (shown.length < N ? 1 : 0));
    segs.forEach(([a, b], i) => k.segments([[a, b]], 1, { span: 1, blend: [shown[i].line, shown[(i + 1) % shown.length].line], alpha: 0.6, width: 1.2 }));
  }
  // labels of degrees closer than 45¢ (or just under the octave, beside
  // the tonic) step outward, so every ratio stays legible
  const shelf = f.notes.map(() => 0);
  f.notes.forEach((n, i) => {
    if (i && n.cents - f.notes[i - 1].cents < 45) shelf[i] = (shelf[i - 1] + 1) % 2;
    if (1200 - n.cents < 45) shelf[i] = 1;
  });
  f.notes.forEach((n, i) => {
    const s = ease(stagger(come, i, N, 0.3));
    if (s <= 0) return;
    const p = at(R, n.cents);
    const counter = n.degree === f.counterDegree;
    k.dot(p, 0.13 * s, 0.9, n.line);
    k.circle(p, 0.04 * s, { color: n.line, alpha: 1, fill: 0.9, width: counter ? 2 : 1 });
    const [x, y] = k.px(at(R + 0.2 + 0.2 * shelf[i], n.cents));
    k.text(n.ratio, x, y - size * 0.55, { size, alpha: 0.9 * s, color: n.line, tracking: 0.1, weight: 400 });
    k.text(`${Math.round(n.cents)}¢`, x, y + size * 0.65, { size: size * 0.8, alpha: 0.5 * s, tracking: 0.1 });
  });
  const [cx, cy] = k.px(O);
  const mid = clamp01((e.u - 0.15) / 0.2);
  k.text(f.tonicName.split(' ')[0], cx, cy - size * 0.9, { size: size * 2.2, alpha: 0.9 * mid, color: tonic.line, tracking: 0.12, weight: 300 });
  k.text(`${N} NOTES · ITS OWN`, cx, cy + size * 1.2, { size: size * 0.85, alpha: 0.6 * mid, tracking: 0.28 });

  // THE SPECTRUM — the visible octave, and where each of its notes' lights falls
  const sx = 1.5;
  const band = ease(clamp01((e.u - 0.45) / 0.2));
  const yOf = (nm) => y1 - ((nm - NM[0]) / (NM[1] - NM[0])) * (y1 - y0); // violet (high) at the top, as the ladder climbs
  SPECTRUM.forEach((b, i) => {
    if (i / 80 > band || i === 80) return;
    k.line([{ x: sx, y: yOf(b.nm) }, { x: sx, y: yOf(SPECTRUM[i + 1].nm) }], { color: b.rgb, alpha: 0.85, width: 5 });
  });
  const marks = clamp01((e.u - 0.6) / 0.25);
  f.notes.forEach((n, i) => {
    if (stagger(marks, i, N, 0.3) <= 0) return;
    const y = yOf(Math.min(NM[1], Math.max(NM[0], n.nm)));
    const main = i === 0;
    k.line([{ x: sx + 0.05, y }, { x: sx + (main ? 0.2 : 0.12), y }], { color: n.line, alpha: 1, width: main ? 2 : 1.2, glow: main ? 1 : 0 });
    if (main) {
      const [x, py] = k.px({ x: sx + 0.25, y });
      k.text(`ITS LIGHT · ${n.nm.toFixed(1)} NM`, x, py, { size, align: 'left', alpha: 0.95, color: n.line, tracking: 0.18, weight: 400 });
    }
  });
};
export const resonanceCaption = (f) => `ITS RESONANCE · ${f.tonic.toFixed(2)} HZ · ${f.nm.toFixed(1)} NM`;
