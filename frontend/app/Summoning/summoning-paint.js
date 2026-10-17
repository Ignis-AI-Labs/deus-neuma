// summoning-paint.js — THE SUMMONING's hand: a small Canvas 2D kit, the
// cuts between sections, and the instrument chrome. // impure (canvas)
//
// Deterministic: every mark is a function of (score, t) — nothing random
// at paint time, so a scrub, a replay and the record agree frame for frame.
// One signal hue on the void; variation lives in intensity (THE LOOK).

import { swell, NO_FLASH } from '../../utils/no-flash.js';

export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const ease = (x) => x * x * (3 - 2 * x);
export const expo = (x) => (x >= 1 ? 1 : 1 - 2 ** (-10 * x));
/** Stagger k of n inside u: the same formula the genesis pen draws with. */
export const stagger = (u, k, n, span) => clamp01((u - (k / n) * (1 - span)) / span);
/** pure — a stable hash of integers to [0,1) (for scrambles that replay identically). */
export const noise = (...xs) => {
  let h = 2166136261;
  for (const x of xs) { h ^= x | 0; h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 2246822507); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

/**
 * The kit one frame paints with.
 * @param {CanvasRenderingContext2D} ctx @param {number} w CSS px @param {number} h CSS px
 * @param {{ ink: string, signal: string, font: string }} palette rgb triplets "r,g,b" and a font stack
 * @param {{ aura?: ReturnType<import('./summoning-aura.js').auraLayer> | null }} [layers]
 */
export const kitOf = (ctx, w, h, palette, { aura = null } = {}) => {
  // figures keep to the middle of the frame: negative space is part of it
  const unit = Math.min(w, h) * 0.32;
  const cx = w / 2;
  const cy = h / 2;
  const px = (p) => [cx + p.x * unit, cy - p.y * unit];
  // named colors, or any "r,g,b" of its own (a note's light, its contrast)
  const RGB = { signal: palette.signal, ink: palette.ink, void: '0,0,0' };
  const rgba = (color, a) => `rgba(${RGB[color] || (color.includes(',') ? color : palette.ink)},${clamp01(a)})`;

  const pathOf = (pts, upto, closed) => {
    const n = Math.max(0, Math.min(pts.length, Math.ceil(upto * pts.length)));
    if (n < 2) return false;
    ctx.beginPath();
    ctx.moveTo(...px(pts[0]));
    for (let i = 1; i < n; i++) ctx.lineTo(...px(pts[i]));
    if (closed && n === pts.length) ctx.closePath();
    return true;
  };
  // A stroke with an optional bloom (a wide faint pass under the line).
  const stroke = (color, alpha, width, glow) => {
    if (glow > 0) {
      ctx.strokeStyle = rgba(color, alpha * glow * 0.22);
      ctx.lineWidth = width * 5;
      ctx.stroke();
    }
    ctx.strokeStyle = rgba(color, alpha);
    ctx.lineWidth = width;
    ctx.stroke();
  };

  return {
    ctx, w, h, unit, cx, cy, px, rgba, font: palette.font,
    // type keeps its own scale: figures shrink into negative space, words stay legible
    type: Math.min(w, h) * 0.4,
    /** a polyline, drawn up to `upto` of its points */
    line(pts, { color = 'ink', alpha = 1, width = 1, glow = 0, upto = 1, closed = false } = {}) {
      if (pathOf(pts, upto, closed)) stroke(color, alpha, width, glow);
    },
    /** segments [a, b], each drawing along itself in its stagger window;
     *  `blend: [from, to]` colors each one along itself, from one light to another */
    segments(segs, u, { span = 0.2, color = 'ink', alpha = 1, width = 1, glow = 0, blend = null } = {}) {
      segs.forEach(([a, b], k) => {
        const s = stagger(u, k, segs.length, span);
        if (s <= 0) return;
        const tip = { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s };
        ctx.beginPath();
        ctx.moveTo(...px(a));
        ctx.lineTo(...px(tip));
        if (!blend) { stroke(color, alpha, width, glow); return; }
        const g = ctx.createLinearGradient(...px(a), ...px(b));
        g.addColorStop(0, rgba(blend[0], alpha));
        g.addColorStop(1, rgba(blend[1], alpha));
        if (glow > 0) { ctx.strokeStyle = rgba(blend[0], alpha * glow * 0.2); ctx.lineWidth = width * 5; ctx.stroke(); }
        ctx.strokeStyle = g;
        ctx.lineWidth = width;
        ctx.stroke();
      });
    },
    circle(c, r, { color = 'ink', alpha = 1, width = 1, glow = 0, upto = 1, start = Math.PI / 2, fill = null } = {}) {
      if (upto <= 0) return;
      ctx.beginPath();
      const [x, y] = px(c);
      ctx.arc(x, y, r * unit, -start, -start - upto * Math.PI * 2, true);
      if (fill !== null) { ctx.fillStyle = rgba(color, fill); ctx.fill(); }
      if (alpha > 0) stroke(color, alpha, width, glow);
    },
    dot(c, r, alpha, color = 'signal') {
      const [x, y] = px(c);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * unit);
      g.addColorStop(0, rgba(color, alpha));
      g.addColorStop(0.35, rgba(color, alpha * 0.35));
      g.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - r * unit, y - r * unit, 2 * r * unit, 2 * r * unit);
    },
    /** text at screen px; size in px; tracking in em */
    text(str, x, y, { size = 12, color = 'ink', alpha = 1, align = 'center', baseline = 'middle', tracking = 0.2, weight = 300 } = {}) {
      ctx.font = `${weight} ${size}px ${palette.font}`;
      ctx.letterSpacing = `${(size * tracking).toFixed(2)}px`;
      ctx.textAlign = align;
      ctx.textBaseline = baseline;
      ctx.fillStyle = rgba(color, alpha);
      // tracked type centres optically once its trailing space is removed
      ctx.fillText(str, align === 'center' ? x + (size * tracking) / 2 : x, y);
    },
    /** its aura at t, centred, `r` its tile's half-extent in frame units; added as light */
    aura(t, r, alpha) {
      if (!aura || alpha <= 0.002 || r <= 0) return;
      const c = aura.frame(t);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp01(alpha);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(c, cx - r * unit, cy - r * unit, 2 * r * unit, 2 * r * unit);
      ctx.restore();
    },
    fillAll(color, alpha) {
      ctx.fillStyle = rgba(color, alpha);
      ctx.fillRect(0, 0, w, h);
    },
  };
};

// ── the cuts: how a section enters, painted over its first moments ──
// `strength` — how strongly its light lands: full only where it means
// something (its name on the downbeat); elsewhere softer. THE NO-FLASH LAW
// (utils/no-flash.js): the light swells over its rise and never passes a dim
// veil — it was a white frame in one cut (Design note, 2026-10-04: […]).
export const paintEnter = (k, enter, local, beatMs, strength = 0.45) => {
  const { ctx, w, h } = k;
  if (enter === 'flash') {
    const a = swell(local, 220, 420) * Math.min(1, strength) * NO_FLASH.FIELD;
    if (a > 0.002) k.fillAll('ink', a);
  } else if (enter === 'wipe') {
    const x = ease(clamp01(local / beatMs)) * (w + 40) - 20;
    if (x < w + 20) {
      ctx.fillStyle = 'rgb(0,0,0)';
      ctx.fillRect(x, 0, w - x, h);
      ctx.fillStyle = k.rgba('signal', 0.85);
      ctx.fillRect(x - 0.5, 0, 1, h);
      ctx.fillStyle = k.rgba('signal', 0.06);
      ctx.fillRect(x - 8, 0, 8, h);
    }
  } else if (enter === 'iris') {
    const r = expo(clamp01(local / beatMs)) * Math.hypot(w, h) * 0.55;
    if (r < Math.hypot(w, h) * 0.54) {
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.arc(k.cx, k.cy, Math.max(0.5, r), 0, Math.PI * 2, true);
      ctx.fillStyle = 'rgb(0,0,0)';
      ctx.fill('evenodd');
      ctx.beginPath();
      ctx.arc(k.cx, k.cy, Math.max(0.5, r), 0, Math.PI * 2);
      ctx.strokeStyle = k.rgba('signal', 0.8);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
};

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];
export const romanOf = (n) => ROMAN[n] || String(n);
const clock = (ms) => {
  const s = Math.max(0, ms) / 1000;
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}`;
};

/**
 * The instrument chrome: brackets, the being's seed, bar·beat, what is
 * playing, the clock, and the whole sequence as one rule. `inverse` paints
 * it in void over an ink card.
 */
export const paintChrome = (k, { score, beat, t, caption, line, inverse }) => {
  const { ctx, w, h } = k;
  const ink = inverse ? 'void' : 'ink';
  const sig = inverse ? 'void' : 'signal';
  const m = Math.round(Math.min(w, h) * 0.045);
  const arm = Math.round(m * 0.6);
  ctx.strokeStyle = k.rgba(ink, 0.35);
  ctx.lineWidth = 1;
  ctx.beginPath();
  [[m, m, 1, 1], [w - m, m, -1, 1], [m, h - m, 1, -1], [w - m, h - m, -1, -1]].forEach(([x, y, sx, sy]) => {
    ctx.moveTo(x + sx * arm, y); ctx.lineTo(x, y); ctx.lineTo(x, y + sy * arm);
  });
  ctx.stroke();
  const size = Math.max(9, Math.round(Math.min(w, h) * 0.014));
  const put = (str, x, y, align, alpha, color = ink) => k.text(str, x, y, { size, align, alpha, color, tracking: 0.24, weight: 400 });
  const y1 = m + arm + size;
  const y2 = h - m - arm - size;
  put(`SUMMONING · #${score.seed.slice(0, 8).toUpperCase()}`, m + 2, y1, 'left', 0.7);
  put(`${String(beat.bar).padStart(2, '0')}.${beat.inBar} · ${score.bpm} BPM`, w - m - 2, y1, 'right', 0.7);
  if (caption) put(caption, m + 2, y2, 'left', 0.9, sig);
  if (line) put(line, m + 2, y2 - size * 2, 'left', 0.5);
  put(clock(t), w - m - 2, y2, 'right', 0.7);
  // the beat, marked: a short tick that decays through the beat
  ctx.fillStyle = k.rgba(sig, Math.exp(-beat.phase * 5));
  ctx.fillRect(w - m - 2 - size * 0.6, y1 + size, size * 0.6, 2);
  ctx.fillStyle = k.rgba(ink, 0.18);
  ctx.fillRect(m, h - m, w - 2 * m, 1);
  ctx.fillStyle = k.rgba(sig, 0.9);
  ctx.fillRect(m, h - m - 1, (w - 2 * m) * clamp01(t / score.lengthMs), 2);
};
