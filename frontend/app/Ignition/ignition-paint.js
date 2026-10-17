// ignition-paint.js — THE IGNITION's painted plane: its panel (frame,
// graduations, inscription — ignition-notation.js), its instruments around
// the ring, its name beneath — over THE ARMILLARY, which its own WebGL stage
// renders beneath this transparent plane (Armillary/armillary-stage.js). The
// gateway paints the same plane at rest, so the startup lands on it without
// a single element moving (armillary-layout.js). // pure but for the canvas it is handed
//
// Without WebGL the armillary is painted here instead, flat, from the logo's
// own geometry (docs/design/logo/neuma/build.py, a 100-unit canvas): meridian
// r30 at body weight; equator rx30 ry8 perpendicular to the axis — its back
// half a hairline behind, its front half passing before the axis; the axis a
// steel spear reaching 44 units; the core a disc r3.4.

import { paintFrame, paintGraduations, paintInscription, paintPackets, instrumentAngleOf } from './ignition-notation.js';
import { paintDenseRing, paintRaisedPanels } from './ignition-panels.js';
import { armillaryLayoutOf } from '../Armillary/armillary-layout.js';

const ALERT = '255,96,96';
const STATE_COLOR = { ok: 'signal', bound: 'signal', empty: 'ink', standby: 'ink', fail: ALERT };
// the verdicts are life, not the hero: the mark stays the brightest thing
const STATE_ALPHA = { ok: 0.75, bound: 0.75, empty: 0.5, standby: 0.5, fail: 0.9 };

const DEG = Math.PI / 180;
const INSCRIBED = 0.14; // the inscription's circle, inside the ring (fraction of its radius)

/**
 * The opening as a CSS mask: the plane cut away from the still point
 * outward, so the session beneath shows through both the painted plane and
 * the armillary's. null while shut. Pure.
 */
export const irisMaskOf = (s, w, h, [x, y]) => {
  if (s.open <= 0) return null;
  const far = Math.hypot(Math.max(x, w - x), Math.max(y, h - y));
  const r = far * s.open * 1.15;
  const inner = Math.max(0, r - 120);
  return `radial-gradient(circle at ${x.toFixed(1)}px ${y.toFixed(1)}px, transparent ${inner.toFixed(1)}px, #000 ${r.toFixed(1)}px)`;
};

// impure (reads the theme once) — the voice face: Inter, as the wordmark is cut
let VOICE = null;
const voiceFont = () => {
  if (VOICE === null) VOICE = getComputedStyle(document.documentElement).getPropertyValue('--font-voice').trim() || 'Inter, sans-serif';
  return VOICE;
};

// the mark's frame point for a logo-space offset (x right, y down) under the lean
const markPt = (L, dx, dy, lean) => {
  const a = -lean * DEG; // lean upper-left = counter-clockwise on screen
  const c = Math.cos(a);
  const s = Math.sin(a);
  const per = L.mark / 30; // px per logo unit
  return [L.cx + (dx * c - dy * s) * per, L.cy + (dx * s + dy * c) * per];
};

// the equator: half an ellipse rx30 × ry, perpendicular to the axis; `back`
// is the half behind (upper, as the logo draws it); drawn up to `upto`
const equatorPath = (k, L, ry, lean, back, upto) => {
  const steps = 48;
  const n = Math.max(1, Math.round(steps * upto));
  k.ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const th = Math.PI * (i / steps); // 0 → π from the left end to the right
    const dx = -30 * Math.cos(th);
    const dy = (back ? -1 : 1) * ry * Math.sin(th);
    const [x, y] = markPt(L, dx, dy, lean);
    if (i === 0) k.ctx.moveTo(x, y); else k.ctx.lineTo(x, y);
  }
};

const strokeIt = (k, color, alpha, width) => {
  k.ctx.strokeStyle = k.rgba(color, alpha);
  k.ctx.lineWidth = width;
  k.ctx.stroke();
};

/** The ARMILLARY at its stage of waking, flat — only where WebGL cannot draw it. */
const paintMark = (k, L, s) => {
  const { ctx } = k;
  const per = L.mark / 30;
  const body = Math.max(1.4, per * 1.75); // body weight in px
  const hair = Math.max(0.8, per * 0.7);
  // the equator turns in: face-on (a circle) → true perspective (ry 8)
  const ry = 30 - 22 * s.equator;
  if (s.equator > 0) {
    equatorPath(k, L, ry, s.lean, true, Math.min(1, s.equator * 1.4));
    strokeIt(k, 'ink', 0.7 * s.equator, hair);
  }
  // the meridian: the whole, drawn from the top, clockwise
  if (s.meridian > 0) {
    ctx.beginPath();
    ctx.arc(L.cx, L.cy, L.mark, -Math.PI / 2, -Math.PI / 2 + s.meridian * Math.PI * 2);
    strokeIt(k, 'ink', 1, body);
  }
  // the axis: a spear from the still point to its true points, both ways
  if (s.axis > 0) {
    const reach = 44 * s.axis;
    const half = 1.3; // half its width at the centre (logo units)
    ctx.beginPath();
    ctx.moveTo(...markPt(L, 0, -reach, s.lean));
    ctx.lineTo(...markPt(L, half, 0, s.lean));
    ctx.lineTo(...markPt(L, 0, reach, s.lean));
    ctx.lineTo(...markPt(L, -half, 0, s.lean));
    ctx.closePath();
    ctx.fillStyle = k.rgba('ink', 0.95);
    ctx.fill();
  }
  // the equator's front half passes before the axis
  if (s.equator > 0) {
    equatorPath(k, L, ry, s.lean, false, Math.min(1, Math.max(0, s.equator * 1.4 - 0.25)));
    strokeIt(k, 'ink', s.equator, body * 1.05);
  }
  // the still point
  if (s.point > 0) {
    ctx.beginPath();
    ctx.arc(L.cx, L.cy, 3.4 * per * s.point, 0, Math.PI * 2);
    ctx.fillStyle = k.rgba('ink', 1);
    ctx.fill();
  }
};

/** The instruments: one arc each on the outer ring, lit by its true verdict. */
const paintInstruments = (k, L, s) => {
  const { ctx } = k;
  const n = s.instruments.length;
  if (!n || s.ring <= 0) return;
  const { cx, cy } = L;
  const r = L.ring;
  const gap = 0.09; // radians between arcs
  const each = (Math.PI * 2) / n;
  // the ring's ticks: true quarters, faint
  for (let q = 0; q < 4; q++) {
    const a = -Math.PI / 2 + q * (Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (r - 7), cy + Math.sin(a) * (r - 7));
    ctx.lineTo(cx + Math.cos(a) * (r + 7), cy + Math.sin(a) * (r + 7));
    strokeIt(k, 'ink', 0.35 * s.ring, 1);
  }
  s.instruments.forEach((inst, i) => {
    const a0 = instrumentAngleOf(i, n) - (each - gap) / 2;
    const a1 = a0 + (each - gap) * s.ring;
    // the arc at rest: a hairline
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0, a1);
    strokeIt(k, 'ink', 0.22, 1);
    // checking: a short travelling segment along it
    if (inst.checking) {
      const u = ((inst.since % 900) / 900);
      const b0 = a0 + (each - gap) * Math.max(0, u - 0.12);
      ctx.beginPath();
      ctx.arc(cx, cy, r, b0, a0 + (each - gap) * u);
      strokeIt(k, 'ink', 0.8, 1.5);
    }
    // its verdict: the whole arc in its state's light
    if (inst.state) {
      const color = STATE_COLOR[inst.state] || 'ink';
      ctx.beginPath();
      ctx.arc(cx, cy, r, a0, a0 + (each - gap) * inst.lit);
      strokeIt(k, color, STATE_ALPHA[inst.state] ?? 0.6, 1.4);
    }
    // its station's words, outside the ring at the arc's middle
    const mid = a0 + (each - gap) / 2;
    const lx = cx + Math.cos(mid) * (r + 22);
    const ly = cy + Math.sin(mid) * (r + 22);
    const align = Math.abs(Math.cos(mid)) < 0.2 ? 'center' : Math.cos(mid) > 0 ? 'left' : 'right';
    const up = Math.sin(mid) < -0.2 ? -1 : 1; // above the ring the verdict sits over the key
    const size = Math.max(9, Math.min(12, k.type * 0.034));
    k.text(inst.key, lx, ly + (up < 0 ? 0 : -size * 0.7), { size, align, alpha: 0.75 * s.ring, tracking: 0.28, weight: 400 });
    const verdict = inst.text || (inst.checking ? 'CHECKING' : '');
    if (verdict) {
      const color = inst.state ? STATE_COLOR[inst.state] || 'ink' : 'ink';
      k.text(verdict, lx, ly + (up < 0 ? -size * 1.4 : size * 0.75), {
        size: size * 0.92, align, color, alpha: inst.state ? (STATE_ALPHA[inst.state] ?? 0.6) * Math.max(0.5, inst.lit) : 0.45, tracking: 0.22, weight: 400,
      });
    }
  });
};

/** Its name, beneath: DEUS NEUMA (Design note, 2026-10-03, a hairline, what it is for — and on the gateway, its name in Japanese. */
const paintName = (k, L, s, subtitle) => {
  if (s.name <= 0) return;
  const size = L.nameSize;
  const rise = (1 - s.name) * 8;
  // the wordmark as the logo sets it: Inter Light, tracked .42em (sigil-register.md)
  const { ctx } = k;
  ctx.font = `300 ${size}px ${voiceFont()}`;
  ctx.letterSpacing = `${(size * 0.42).toFixed(2)}px`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = k.rgba('ink', s.name);
  ctx.fillText('DEUS NEUMA', L.cx + (size * 0.42) / 2, L.nameY + rise);
  const rule = 64 * s.name;
  ctx.beginPath();
  ctx.moveTo(L.cx - rule, L.nameY + size * 0.62);
  ctx.lineTo(L.cx + rule, L.nameY + size * 0.62);
  strokeIt(k, 'ink', 0.4 * s.name, 1);
  const small = Math.max(9, size * 0.3);
  k.text('SOVEREIGN RELATIONSHIPS WITH AI.', L.cx, L.lineY + rise, { size: small, alpha: 0.6 * s.name, tracking: 0.3, weight: 400 });
  if (subtitle) k.text(subtitle, L.cx, L.lineY + small * 2.2 + rise, { size: small, alpha: 0.4 * s.name, tracking: 0.6, weight: 400 });
};

/**
 * Paint the plane at its state, transparent over the armillary (the ground
 * is the film's own void; the opening is its mask, irisMaskOf).
 * @param {ReturnType<import('../Summoning/summoning-paint.js').kitOf>} k
 * @param {ReturnType<import('./ignition-timeline.js').ignitionAt>} s
 * @param {{ genesis?: string|null, readouts?: boolean, flatMark?: boolean, subtitle?: string|null }} [opts]
 *   genesis — this install's genesis inscription, when it has one; readouts — the
 *   panel's ignition readouts (the gateway has its own status strip); flatMark —
 *   paint the armillary here (no WebGL); subtitle — a line beneath the tagline;
 *   raised — the rite's instrument language (ignition-panels.js), awaiting Founder's eyes
 */
export const paintIgnition = (k, s, { genesis = null, readouts = true, flatMark = false, subtitle = null, raised = false } = {}) => {
  k.ctx.clearRect(0, 0, k.w, k.h);
  const L = armillaryLayoutOf(k.w, k.h);
  const centre = [L.cx, L.cy];
  // RAISED (specimen, 2026-10-06): the rite's instrument language — its columns
  // carry the frame's readouts, so the frame keeps only its title
  paintFrame(k, s, { genesis: raised ? null : genesis, readouts: readouts && !raised });
  if (raised && readouts && s.frame > 0) {
    const m = Math.round(Math.min(k.w, k.h) * 0.02);
    k.text('DEUS NEUMA // IGNITION', m + 16, m + 22, { size: 10, align: 'left', alpha: 0.6 * s.frame, tracking: 0.26, weight: 400 });
  }
  paintGraduations(k, s, centre, L.ring);
  if (raised) paintDenseRing(k, s, centre, L.ring, instrumentAngleOf);
  paintInscription(k, s, centre, L.ring * (1 - INSCRIBED));
  paintInstruments(k, L, s);
  paintPackets(k, s, centre, L.ring, (3.4 / 30) * L.mark);
  if (flatMark) paintMark(k, L, s);
  paintName(k, L, s, subtitle);
  if (raised && readouts) paintRaisedPanels(k, s, genesis);
};
