// ignition-notation.js — THE IGNITION's instrument panel: the viewport
// frame and its readouts, the graduated ring, the inscription, and each
// verdict's light on its ray inward. // pure but for the canvas it is handed
//
// The gateway's own notation (Opening/OpeningField: the chamfered frame,
// sixty graduations, EMBLEM.INSCRIPTION) drawn here as it comes into being,
// so the gateway the ignition opens onto is the panel that just assembled.
// SHINKEI: every readout states something true — the time since ignition,
// how many instruments have truly declared, this install's genesis record.

import { EMBLEM } from '../../utils/emblem-geometry.js';

const ALERT = '255,96,96';
const LIGHT_OF = { ok: 'signal', bound: 'signal', empty: 'ink', standby: 'ink', fail: ALERT };
const TAU = Math.PI * 2;
const CHAMFER = 26; // the frame's TR + BL cuts, as the gateway's .of-frame
const ORBIT_MS = 120000; // the inscription's slow orbit, as the gateway's

const clamp01 = (x) => Math.min(1, Math.max(0, x));

/**
 * The middle of instrument i's arc, of n: the first at the top, the rest
 * evenly round — so none sits at the bottom, where the name is. Pure.
 */
export const instrumentAngleOf = (i, n) => -Math.PI / 2 + i * (TAU / n);
const easeIn = (x) => x * x;
const pad2 = (n) => String(Math.floor(n)).padStart(2, '0');

/** The frame and its readouts: its edge draws itself around from the top-left. */
export const paintFrame = (k, s, { genesis = null, readouts = true } = {}) => {
  if (s.frame <= 0) return;
  const { ctx, w, h } = k;
  const m = Math.round(Math.min(w, h) * 0.02); // 2vmin, as the gateway's frame
  const pts = [[m, m], [w - m - CHAMFER, m], [w - m, m + CHAMFER], [w - m, h - m], [m + CHAMFER, h - m], [m, h - m - CHAMFER], [m, m]];
  const lengths = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  const total = lengths.reduce((a, b) => a + b, 0);
  ctx.save();
  ctx.setLineDash([total * s.frame, total]);
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.strokeStyle = k.rgba('ink', 0.16);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  if (!readouts) return;
  const size = 10;
  const a = 0.6 * s.frame;
  const top = m + 22;
  const declared = s.instruments.filter((i) => i.state).length;
  const sec = s.t / 1000;
  k.text('DEUS NEUMA // IGNITION', m + 16, top, { size, align: 'left', alpha: a, tracking: 0.26, weight: 400 });
  k.text(`INSTRUMENTS · ${declared}/${s.instruments.length} DECLARED`, w / 2, top, { size, alpha: a, tracking: 0.26, weight: 400 });
  k.text(`T+ ${pad2(sec)}.${pad2((sec % 1) * 100)} S`, w - m - CHAMFER - 16, top, { size, align: 'right', alpha: a, tracking: 0.26, weight: 400 });
  if (genesis) k.text(genesis, m + 16, h - m - 22, { size, align: 'left', alpha: 0.45 * s.frame, tracking: 0.22, weight: 400 });
};

/** Sixty graduations inside the instruments' ring, swept in clockwise from the top. */
export const paintGraduations = (k, s, [cx, cy], r) => {
  if (s.notation <= 0) return;
  const { ctx } = k;
  const n = EMBLEM.TICK_COUNT;
  const every = n / EMBLEM.CARDINAL_COUNT;
  const shown = Math.ceil(s.notation * n);
  for (let i = 0; i < shown; i++) {
    const a = -Math.PI / 2 + (i / n) * TAU;
    const cardinal = i % every === 0;
    const r0 = r - 10;
    const r1 = r0 - (cardinal ? 14 : 6);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    ctx.strokeStyle = k.rgba('ink', cardinal ? 0.55 : 0.28);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
};

/** The gateway's inscription, typing itself around the ring as it orbits. */
export const paintInscription = (k, s, [cx, cy], r) => {
  if (s.inscription <= 0) return;
  const { ctx } = k;
  const text = EMBLEM.INSCRIPTION;
  const shown = Math.floor(s.inscription * text.length);
  const step = TAU / text.length;
  const orbit = (s.t / ORBIT_MS) * TAU;
  const size = Math.max(8, Math.min(10, k.type * 0.026));
  ctx.save();
  ctx.font = `400 ${size}px ${k.font}`;
  ctx.letterSpacing = '0px';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < shown; i++) {
    const a = -Math.PI / 2 + orbit + i * step;
    // the newest letter arrives bright, then settles to the ring's ink
    const fresh = clamp01(1 - (shown - 1 - i) / 6);
    ctx.save();
    ctx.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.rotate(a + Math.PI / 2);
    ctx.fillStyle = k.rgba('ink', 0.36 + 0.4 * fresh);
    ctx.fillText(text[i], 0, 0);
    ctx.restore();
  }
  ctx.restore();
};

/**
 * Each verdict's light, travelling its ray from its arc to the still point
 * (gathering speed, as energy falls inward); where it arrives the construct
 * answers (ignition-construct.js). A failure sends no light — it only shows.
 */
export const paintPackets = (k, s, [cx, cy], r, core) => {
  const { ctx } = k;
  const n = s.instruments.length;
  s.instruments.forEach((inst, i) => {
    if (inst.packet <= 0 || inst.packet >= 1 || inst.state === 'fail') return;
    const a = instrumentAngleOf(i, n);
    const head = r - (r - core) * easeIn(inst.packet);
    const tail = Math.min(r, head + (r - core) * 0.24);
    const color = LIGHT_OF[inst.state] || 'ink';
    const g = ctx.createLinearGradient(cx + Math.cos(a) * tail, cy + Math.sin(a) * tail, cx + Math.cos(a) * head, cy + Math.sin(a) * head);
    g.addColorStop(0, k.rgba(color, 0));
    g.addColorStop(1, k.rgba(color, 0.95));
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * tail, cy + Math.sin(a) * tail);
    ctx.lineTo(cx + Math.cos(a) * head, cy + Math.sin(a) * head);
    ctx.strokeStyle = g;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    k.ctx.save();
    k.ctx.globalCompositeOperation = 'lighter';
    const hx = cx + Math.cos(a) * head;
    const hy = cy + Math.sin(a) * head;
    const glow = ctx.createRadialGradient(hx, hy, 0, hx, hy, 9);
    glow.addColorStop(0, k.rgba(color, 0.8));
    glow.addColorStop(1, k.rgba(color, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(hx - 9, hy - 9, 18, 18);
    k.ctx.restore();
  });
};
