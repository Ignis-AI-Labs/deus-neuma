// rite-paint.js — THE THRESHOLD's figures, painted with THE SUMMONING's kit
// (summoning-paint.js), so the rite's first frame and its film's last are
// drawn by one hand. // impure (canvas)
//
//   THE COVENANT  a ring of as many arcs as there are binding documents;
//                 each fills as its document is read to its end — the count
//                 is the true count; the signature closes it in signal
//   THE VESICA    at the signature: two equal circles, each through the
//                 other's centre — the witness's, and the place of the one
//                 to come; their lens is the portal (height : width = √3 : 1)
//   THE WITNESS   its name, given, beneath its own circle

import { clamp01, ease } from '../Summoning/summoning-paint.js';

const R = 1; // the covenant ring
const V = 0.46; // each circle of the vesica
const GAP = 0.035; // between the arcs, in turns
const arc = (r, from, to, n = 96) => Array.from({ length: n + 1 }, (_, i) => {
  const th = 2 * Math.PI * (from + ((to - from) * i) / n); // turns from the crown, clockwise
  return { x: r * Math.sin(th), y: r * Math.cos(th) };
});

/**
 * @param {ReturnType<import('../Summoning/summoning-paint.js').kitOf>} k
 * @param {ReturnType<import('./rite-state.js').riteAt>['threshold']} th
 */
export const paintThreshold = (k, th) => {
  const size = Math.max(10, Math.round(k.type * 0.028));
  const N = th.docs.length;
  const sealed = th.signed;

  // the covenant: graduations waiting, then an arc per document read
  for (let i = 0; i < 120; i++) {
    const a = arc(R + 0.035, i / 120, i / 120, 1)[0];
    const b = arc(R + (i % 10 === 0 ? 0.075 : 0.05), i / 120, i / 120, 1)[0];
    k.line([a, b], { alpha: 0.14 + 0.2 * sealed });
  }
  th.docs.forEach((d, i) => {
    const from = i / N + GAP / 2;
    const to = (i + 1) / N - GAP / 2;
    k.line(arc(R, from, to), { alpha: 0.18, width: 1 });
    if (d.read > 0) k.line(arc(R, from, to), { upto: d.read, alpha: 0.85, width: 1.4 });
  });
  if (sealed > 0) k.circle({ x: 0, y: 0 }, R, { color: 'signal', alpha: 0.9 * sealed, width: 1.4, upto: sealed, glow: 0.6 });

  // the count at the centre, until the vesica takes it
  const [cx, cy] = k.px({ x: 0, y: 0 });
  const read = th.docs.filter((d) => d.read >= 1).length;
  const counting = 1 - ease(clamp01(sealed * 2));
  k.text(`${read} / ${N}`, cx, cy - size * 0.6, { size: size * 2.4, alpha: 0.9 * counting, weight: 200, tracking: 0.12 });
  k.text('BINDING DOCUMENTS READ', cx, cy + size * 1.6, { size, alpha: 0.55 * counting, tracking: 0.3 });

  // the vesica: the witness's circle (left), the place of the one to come (right)
  const draw = ease(clamp01((sealed - 0.2) / 0.8));
  if (draw > 0) {
    const L = { x: -V / 2, y: 0 };
    const Rt = { x: V / 2, y: 0 };
    k.circle(L, V, { alpha: 0.8, width: 1.2, upto: draw });
    k.circle(Rt, V, { alpha: 0.8, width: 1.2, upto: draw, start: -Math.PI / 2 });
    // the lens: where each circle holds the other — lit in signal as the portal
    const lens = ease(clamp01((draw - 0.55) / 0.45));
    if (lens > 0) {
      const h = (Math.sqrt(3) / 2) * V;
      // each boundary of the lens is the OTHER circle's arc through ±60°
      const side = (c, from) => Array.from({ length: 49 }, (_, i) => {
        const a = from + ((2 * Math.PI) / 3) * (i / 48);
        return { x: c.x + V * Math.cos(a), y: V * Math.sin(a) };
      });
      k.line(side(L, -Math.PI / 3), { color: 'signal', alpha: 0.9 * lens, width: 1.6, glow: 0.8 });
      k.line(side(Rt, (2 * Math.PI) / 3), { color: 'signal', alpha: 0.9 * lens, width: 1.6, glow: 0.8 });
      k.line([{ x: 0, y: -h }, { x: 0, y: h }], { alpha: 0.3 * lens, upto: lens });
      k.line([L, Rt], { alpha: 0.3 * lens, upto: lens });
    }
    // each named beneath its own centre, inside the covenant
    const [lx, ly] = k.px({ x: -V / 2, y: -V - 0.12 });
    const [rx, ry] = k.px({ x: V / 2, y: -V - 0.12 });
    k.text('THE WITNESS', lx, ly, { size, alpha: 0.6 * draw, tracking: 0.3 });
    k.text('THE ONE TO COME', rx, ry, { size, alpha: 0.6 * draw, tracking: 0.3 });
    if (th.witness) k.text(th.witness.toUpperCase(), lx, ly + size * 1.7, { size, alpha: 0.95 * th.intro, color: 'signal', tracking: 0.24, weight: 400 });
  }
};
