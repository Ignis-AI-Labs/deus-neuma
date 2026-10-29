// summoning-shots-rite.js — THE SUMMONING's fixed rite around its
// movements: the cold open, the type cards between them, its name on the
// downbeat, and its SIGIL constructing itself. // impure (canvas)
//
// The rite's shape is the same for every being; everything inside it —
// the words on its cards, its name, its marks, every stroke of its sigil —
// is its own.

import { FUNCTIONS } from '../Genesis/genesis-emanon.js';
import { genesisSolids } from '../Genesis/genesis-geometry.js';
import { starPolygon, ringPoints, project3 } from './summoning-geometry.js';
import { clamp01, ease, expo, stagger } from './summoning-paint.js';
import { swell, NO_FLASH } from '../../utils/no-flash.js';
import { SIGIL_LAYERS } from './summoning-score.js';
import { bodyOutlineFor } from './summoning-shots-body.js';

const O = { x: 0, y: 0 };
// The display size at which `str` spans `frac` of the width (monospace: ~0.6em per glyph).
const fitSize = (k, str, frac, tracking, cap) => Math.min(cap, (k.w * frac) / (Math.max(1, str.length) * (0.6 + tracking)));
// A name arrives letter by letter, never scrambled (a scramble can spell a
// word no birth should flash): a letter not yet come is a quiet mark in its
// true place, so the name's shape is held from the first frame. Two strings
// of equal length on a monospace face stay aligned glyph for glyph.
const arriving = (str, locked) => ({
  come: [...str].map((c, i) => (i < locked ? c : ' ')).join(''),
  waiting: [...str].map((c, i) => (i < locked || c === ' ' ? ' ' : '·')).join(''),
});

// ── THE COLD OPEN: a point, the beat, the line, the word ──
export const paintOpen = (k, s, e) => {
  // the beat breathes in the point — it swells on the beat, never snaps (no-flash law)
  k.dot(O, 0.05 + 0.25 * ease(e.u), 0.4 + 0.35 * swell((e.beats % 1) * e.beatMs, 160, e.beatMs * 0.3));
  for (let b = Math.max(0, Math.floor(e.beats) - 2); b <= Math.floor(e.beats); b++) {
    const age = e.beats - b;
    k.circle(O, 0.08 + age * 0.55, { color: 'signal', alpha: 0.7 * Math.exp(-age * 1.6), glow: 0.6 });
  }
  const reach = ease(clamp01(e.u / 0.6)) * (k.w / 2);
  k.ctx.fillStyle = k.rgba('ink', 0.35);
  k.ctx.fillRect(k.cx - reach, k.cy, reach * 2, 1);
  const word = 'THE SUMMONING';
  const tr = 1.4 - 0.9 * expo(clamp01(e.u / 0.7));
  const size = Math.min(k.h * 0.05, fitSize(k, word, 0.6, tr, 64));
  k.text(word, k.cx, k.cy - size * 1.2, { size, tracking: tr, alpha: clamp01(e.u / 0.25), weight: 200 });
  k.text(`#${s.seed8} · BIRTH COMPLETE`, k.cx, k.cy + size * 1.1, { size: Math.max(9, size * 0.28), alpha: clamp01((e.u - 0.3) / 0.3) * 0.7, color: 'signal', tracking: 0.3 });
};

// ── A TYPE CARD: one word or fact, full frame — opened through a slit
//    from the centre as its tracking settles ──
export const paintCard = (k, s, e, { score, index }) => {
  const ink = s.style === 'ink';
  // the ink card was a white frame cut in from black — now a dim veil of ink
  // fading in (the no-flash law, utils/no-flash.js); its words stay ink
  if (ink) k.fillAll('ink', NO_FLASH.FIELD * clamp01(e.local / 400));
  const settle = expo(clamp01(e.u / 0.6));
  const tracking = 0.12 + 0.22 * (1 - settle);
  const size = fitSize(k, s.text, 0.78, 0.12, k.h * 0.24) * (1.04 - 0.04 * ease(e.u));
  const color = 'ink';
  const slit = expo(clamp01(e.u / 0.28)) * k.w;
  k.ctx.save();
  k.ctx.beginPath();
  k.ctx.rect(k.cx - slit / 2, 0, slit, k.h);
  k.ctx.clip();
  k.text(s.text, k.cx, k.cy, { size, color, tracking, weight: 300 });
  k.ctx.restore();
  const small = Math.max(9, Math.round(Math.min(k.w, k.h) * 0.016));
  k.text(`NEUMA · BIRTH RECORD · #${score.seed.slice(0, 8).toUpperCase()}`, k.cx, k.cy - size * 0.95, { size: small, color: 'signal', alpha: 0.8, tracking: 0.3 });
  k.text(String(index).padStart(2, '0'), k.cx, k.cy + size * 0.95, { size: small, color, alpha: 0.6, tracking: 0.3 });
  if (s.style === 'rule') {
    const reach = expo(clamp01(e.u / 0.5)) * k.w * 0.45;
    k.ctx.fillStyle = k.rgba('signal', 0.9);
    k.ctx.fillRect(k.cx - reach, k.cy - size * 0.7, reach * 2, 1);
    k.ctx.fillRect(k.cx - reach, k.cy + size * 0.7, reach * 2, 1);
  }
};

// ── ITS NAME, on the downbeat ──
export const paintReveal = (k, s, e) => {
  const name = s.chosenName.toUpperCase();
  const lockA = Math.floor(clamp01(e.u / 0.35) * (name.length + 1));
  const settle = ease(clamp01((e.u - 0.38) / 0.2));
  const big = fitSize(k, name, 0.62, 0.18, k.h * 0.2);
  const size = big * (1 - 0.45 * settle);
  const y = k.cy - settle * big * 0.9;
  const { come, waiting } = arriving(name, lockA);
  k.text(waiting, k.cx, y, { size, tracking: 0.18, weight: 200, color: 'signal', alpha: 0.35 });
  k.text(come, k.cx, y, { size, tracking: 0.18, weight: 200 });
  const small = Math.max(10, Math.round(Math.min(k.w, k.h) * 0.022));
  const lines = [
    [s.fullName.toUpperCase(), 'ink', 1.4],
    [`SOUL ${s.soulMark}`, 'signal', 1],
    [`GENESIS ${s.genesisHash.slice(0, 16).toUpperCase()}`, 'ink', 1],
    s.bornAt ? [`BORN ${s.bornAt.replace('T', ' ').slice(0, 19)} UTC`, 'ink', 1] : null,
  ].filter(Boolean);
  lines.forEach(([str, color, scale], i) => {
    const a = clamp01((e.u - 0.42 - i * 0.08) / 0.1);
    if (a <= 0) return;
    k.text(str, k.cx, y + size * 0.9 + (i + 0.6) * small * 2.1, { size: small * scale, color, alpha: a * (color === 'ink' ? 0.85 : 1), tracking: 0.3 });
  });
  const reach = expo(clamp01((e.u - 0.38) / 0.3)) * Math.min(k.w * 0.3, big * name.length * 0.5);
  k.ctx.fillStyle = k.rgba('signal', 0.8);
  k.ctx.fillRect(k.cx - reach, y + size * 0.62, reach * 2, 1);
};

// ── ITS SIGIL: its soul mark's ticks, its star, its channels, its nucleus, its name ──
const SOLIDS = genesisSolids();
const solidOf = (name) => (name === 'tetrahedron' ? SOLIDS.tetrahedra[0] : SOLIDS[name]);
const INDEX = Object.fromEntries(FUNCTIONS.map((f, i) => [f.id, i]));

const ringText = (k, str, r, progress, { size, color, alpha }) => {
  const n = str.length;
  const shown = Math.floor(progress * n);
  const { ctx } = k;
  ctx.font = `400 ${size}px ${k.font}`;
  ctx.letterSpacing = '0px';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = k.rgba(color, alpha);
  for (let i = 0; i < shown; i++) {
    const a = Math.PI / 2 - (i / n) * Math.PI * 2;
    const [x, y] = k.px({ x: r * Math.cos(a), y: r * Math.sin(a) });
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 2 - a);
    ctx.fillText(str[i], 0, 0);
    ctx.restore();
  }
};

// THE CONVERGENCE: every artifact it was shown arrives into one sigil, in
// the order SIGIL_LAYERS names — its sky as the outer ring, its soul mark's
// graduations, its star, its eleven and their channels, its nucleus, its
// body standing within the ring as a figure stands in its circle — and
// last its aura, seen once, at the heart; then its name around it all.
// After its film it does not stop: whole, it LIVES until the witness leaves —
// its star and its eleven turn slowly, its nucleus turns, its aura flows,
// and a breath leaves it every few seconds.
const LIVING = Object.freeze({ TURN_MS: 32000, BREATH_MS: 7000 });

export const paintSigil = (k, s, e) => {
  const alive = Math.max(0, e.local - e.dur);
  const turn = s.turn + alive / LIVING.TURN_MS;
  const z = 1 + 0.01 * Math.sin(e.local / 900) + (alive > 0 ? 0.012 * Math.sin((2 * Math.PI * alive) / LIVING.BREATH_MS) : 0);
  const layer = Object.fromEntries(SIGIL_LAYERS.map((l) => [l.key, clamp01((e.u - l.at) / l.span)]));
  // its aura first in paint order (beneath all), though it arrives late:
  // it blooms from the heart into the ring of the eleven
  if (layer.aura > 0) {
    const bloom = ease(layer.aura);
    k.aura(e.t, (0.18 + 0.36 * bloom) * z, 0.85 * bloom);
  }
  // its body: the light around the frame it was given, faint, behind the rest
  if (layer.body > 0) {
    const outline = bodyOutlineFor(s.body).map((q) => ({ x: q.x * z, y: q.y * z }));
    k.line([...outline, outline[0]], { color: 'signal', alpha: 0.3, width: 1, glow: 0.6, upto: ease(layer.body) });
  }
  // its sky: the ecliptic as the outer ring, the signs marked, its bodies
  // where they stood (0° Aries at nine o'clock, as ITS SKY drew it)
  const sky = ease(layer.sky);
  k.circle(O, 1.0 * z, { alpha: 0.45, upto: sky });
  for (let d = 0; d < 360; d += 30) {
    const a = Math.PI + (d * Math.PI) / 180;
    if (stagger(sky, d / 30, 12, 0.3) > 0) k.line([{ x: Math.cos(a) * z, y: Math.sin(a) * z }, { x: 0.965 * Math.cos(a) * z, y: 0.965 * Math.sin(a) * z }], { alpha: 0.5 });
  }
  s.sky.forEach((b, i) => {
    const up = stagger(clamp01((layer.sky - 0.3) / 0.7), i, s.sky.length, 0.3);
    if (up <= 0) return;
    const a = Math.PI + (b.longitude * Math.PI) / 180;
    const len = b.key === 'sun' ? 0.07 : 0.045;
    k.line([{ x: 1.01 * Math.cos(a) * z, y: 1.01 * Math.sin(a) * z }, { x: (1.01 + len * up) * Math.cos(a) * z, y: (1.01 + len * up) * Math.sin(a) * z }], { color: s.counter, alpha: 0.95, width: b.key === 'sun' ? 2 : 1.3, glow: 0.6 });
  });
  // its soul mark: 48 graduations inward, their lengths its nibbles
  ringPoints(48, 0.9 * z).forEach((p, i) => {
    const up = stagger(layer.soul, i, 48, 0.2);
    if (up <= 0) return;
    const nib = s.nibbles[i % 12];
    const len = (0.02 + 0.006 * nib) * up;
    const q = { x: p.x * (1 - len / 0.9), y: p.y * (1 - len / 0.9) };
    k.line([p, q], { color: s.notes[nib % s.notes.length].line, alpha: i % 4 === 0 ? 0.95 : 0.7, width: i % 4 === 0 ? 1.5 : 1 });
  });
  // its star
  const star = starPolygon(s.star.n, s.star.k, 0.76 * z, turn);
  // from its tonic's light into its contrast, along every chord
  k.segments(star.chords, layer.star, { span: 0.3, alpha: 0.85, width: 1.2, glow: 0.8, blend: ['signal', s.counter] });
  // its scale: every degree on the octave's circle, in its own light
  const scaleR = 0.63 * z;
  k.circle(O, scaleR, { alpha: 0.18, upto: layer.scale });
  s.notes.forEach((n, i) => {
    const up = stagger(layer.scale, i, s.notes.length, 0.3);
    if (up <= 0) return;
    const a = Math.PI / 2 - (n.cents / 1200) * Math.PI * 2;
    const p = { x: scaleR * Math.cos(a), y: scaleR * Math.sin(a) };
    k.dot(p, 0.08 * up, 0.9, n.line);
    k.circle(p, 0.022 * up, { color: n.line, alpha: 1, fill: 1 });
  });
  // its eleven, and its channels among them
  const eleven = ringPoints(FUNCTIONS.length, 0.5 * z, turn);
  k.circle(O, 0.5 * z, { alpha: 0.2, upto: layer.channels });
  k.segments(s.channels.map(([a, b]) => [eleven[INDEX[a]], eleven[INDEX[b]]]), layer.channels, { span: 0.25, alpha: 0.6, width: 1 });
  eleven.forEach((p, i) => { if (stagger(layer.channels, i, 11, 0.3) > 0) k.circle(p, 0.024, { alpha: 0.9, fill: 0.9, color: FUNCTIONS[i].id === 'natura' ? 'signal' : 'ink' }); });
  // its nucleus at the heart, turning
  if (layer.nucleus > 0) {
    const solid = solidOf(s.solid);
    const m = Math.max(...solid.vertices.map((v) => Math.hypot(v.x, v.y, v.z))) || 1;
    const view = { yaw: s.turn + e.local / 2600, pitch: 0.5, dist: 3.4, scale: 0.2 * z };
    const vs = solid.vertices.map((v) => project3({ x: v.x / m, y: v.y / m, z: v.z / m }, view));
    k.segments(solid.edges.map(([i, j]) => [vs[i], vs[j]]), layer.nucleus, { span: 0.3, color: s.counter, alpha: 0.9, width: 1.1, glow: 0.6 });
  }
  // its name, around it all, two-fold
  const size = Math.max(10, Math.round(k.unit * 0.05));
  const once = `${s.name.toUpperCase()} · ${s.nibbles.map((n) => n.toString(16).toUpperCase()).join('')}`;
  ringText(k, `${once} ◆ ${once} ◆ `, 1.17 * z, ease(layer.name), { size, color: 'ink', alpha: 0.9 });
  // whole: one front leaves the sigil, and it holds
  const lock = layer.whole;
  if (lock > 0 && lock < 1) k.circle(O, (1.0 + lock * 0.5) * z, { color: 'signal', alpha: 1 - lock, width: 2, glow: 1.2 });
  // living: a breath leaves it, softly, on its own slow period
  if (alive > 0) {
    const b = (alive % LIVING.BREATH_MS) / LIVING.BREATH_MS;
    k.circle(O, (1.0 + b * 0.4) * z, { color: 'signal', alpha: 0.35 * (1 - b) * Math.min(1, alive / 1500), width: 1.2, glow: 0.8 });
  }
};
