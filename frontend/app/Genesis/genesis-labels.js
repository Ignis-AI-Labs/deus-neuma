// genesis-labels.js — where the names on the tree stand on screen. Pure.
//
// A name sits BESIDE its sphere, never on it: outward from its pillar first
// (the force pillar's names to the left, the form pillar's to the right),
// stepping further out on a leader line when the place beside the sphere is
// taken, then the other side, then above or below. A place is free
// only if it is inside the frame, clear of every drawn sphere of both trees,
// of every name already placed, and of the caption spine. Names are placed
// in the order they are first spoken (rank), so a name arriving never moves
// one already standing. The overlay draws exactly these boxes.

import { project, TAN_HALF } from './genesis-camera.js';
import { FUNCTIONS, TREE, nodeAt } from './genesis-emanon.js';

const VISIBLE = 0.05; // below this a name or sphere does not take up room
const GAP = 6; // px between a sphere's edge and its name
const MARGIN = 8; // px a name keeps from the frame's edge
const PAD = 2; // px kept between two names
const PUSH = Object.freeze(Array.from({ length: 15 }, (_, k) => 8 * k)); // px further out, on a leader line

/** pure — a name's font size at a viewport width (Genesis.css .gen-label). */
export const labelFont = (w) => Math.min(12, Math.max(10, 0.008 * w));

/** pure — the box a name takes: JetBrains Mono advances 0.6 em, plus its tracking. */
export const labelSize = (text, kind, w) => {
  const fs = labelFont(w);
  return { w: text.length * fs * (0.6 + (kind === 'hidden' ? 0.34 : 0.22)), h: Math.ceil(fs * 1.3) };
};

const clamp = (lo, v, hi) => Math.min(hi, Math.max(lo, v));

/**
 * pure — the caption spine's box at a viewport (Genesis.css .gen-caption:
 * movement 11px, title and line in JetBrains Mono at their tracking, the
 * line wrapping at min(64ch, 70vw)), which no name covers.
 * @param {{w: number, h: number}} size @param {{movement, title, line}|null} caption
 */
export const captionBox = ({ w, h }, caption) => {
  if (!caption) return null;
  const left = clamp(24, 0.05 * w, 72);
  const bottom = h - clamp(88, 0.14 * h, 160);
  const title = clamp(13, 0.012 * w, 16);
  const line = clamp(12, 0.01 * w, 14);
  const wrap = Math.min(64 * line * 0.6, 0.7 * w);
  const lineW = caption.line.length * line * 0.74;
  const rows = Math.max(1, Math.ceil(lineW / wrap));
  const width = 16 + Math.max(caption.movement.length * 11 * 0.9, caption.title.length * title * 0.94, Math.min(lineW, wrap));
  const height = 11 * 1.3 + title * 1.3 + rows * line * 1.6 + 16;
  return { x: left, y: bottom - height, w: width, h: height };
};

const overlaps = (a, b, pad = 0) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

// a world point on screen, in px, with the screen radius of a sphere there
const onScreen = (at, cam, size) => {
  const p = project(at, cam, size.w / size.h);
  return { x: (p.x / 100) * size.w, y: (p.y / 100) * size.h, r: (TREE.SPHERE / (p.depth * TAN_HALF)) * (size.h / 2), ahead: p.ahead };
};

/**
 * Every drawn sphere of both trees, as a screen box. Pure.
 * @param {ReturnType<import('./genesis-state-emanon.js').emanonAt>} emanon
 */
export const glyphsAt = (emanon, cam, size) => FUNCTIONS.flatMap((f, k) => {
  const s = emanon.spheres[k];
  if (!(s.draw > 0 && s.opacity > VISIBLE)) return [];
  return [1, -1].map((tree) => {
    const n = nodeAt(f.id, tree);
    const g = onScreen({ ...n, z: n.z * emanon.split }, cam, size);
    return { id: f.id, tree, x: g.x - g.r, y: g.y - g.r, w: 2 * g.r, h: 2 * g.r };
  });
});

const SIDES = Object.freeze({
  left: ['left', 'right', 'above', 'below'],
  right: ['right', 'left', 'above', 'below'],
});
// outward from its pillar; a middle-pillar name steps away from its twin in
// the other tree (to the left while the trees are one)
const sidesOf = (l, anchor, twin) => {
  const x = nodeAt(l.id, 1).x;
  if (x < 0) return SIDES.left;
  if (x > 0) return SIDES.right;
  return twin && twin.x < anchor.x - 1 ? SIDES.right : SIDES.left;
};

const boxAt = (side, a, box, push) => {
  const out = a.r + GAP + push;
  if (side === 'right') return { x: a.x + out, y: a.y - box.h / 2 };
  if (side === 'left') return { x: a.x - out - box.w, y: a.y - box.h / 2 };
  if (side === 'above') return { x: a.x - box.w / 2, y: a.y - out - box.h };
  return { x: a.x - box.w / 2, y: a.y + out };
};

/**
 * Place every visible name. Pure.
 * @param {Array<{id, tree, rank, text, at, opacity, kind}>} labels
 * @param {Array<{x, y, w, h}>} glyphs from glyphsAt
 * @param {ReturnType<import('./genesis-camera.js').cameraAt>} cam
 * @param {{w: number, h: number}} size the viewport in px
 * @param {{movement, title, line}|null} caption the caption on screen
 * @returns {Array<{key, text, kind, opacity, x, y, w, h, anchor: {x, y, r}, leader: boolean, free: boolean}>}
 */
export const layoutLabels = (labels, glyphs, cam, size, caption) => {
  const frame = { x: MARGIN, y: MARGIN, w: size.w - 2 * MARGIN, h: size.h - 2 * MARGIN };
  const inFrame = (b) => b.x >= frame.x && b.y >= frame.y && b.x + b.w <= frame.x + frame.w && b.y + b.h <= frame.y + frame.h;
  const blocked = [...glyphs, captionBox(size, caption)].filter(Boolean);
  const placed = [];
  const visible = labels.filter((l) => l.opacity > VISIBLE).sort((a, b) => a.rank - b.rank);
  for (const l of visible) {
    const anchor = onScreen(l.at, cam, size);
    if (!anchor.ahead) continue;
    const box = labelSize(l.text, l.kind, size.w);
    const twin = onScreen({ x: l.at.x, y: l.at.y, z: -l.at.z }, cam, size);
    const candidates = sidesOf(l, anchor, twin).flatMap((side) => PUSH.map((push) => ({ ...boxAt(side, anchor, box, push), ...box, push })));
    const free = (b) => inFrame(b) && !blocked.some((g) => overlaps(b, g)) && !placed.some((p) => overlaps(b, p, PAD));
    const pick = candidates.find(free);
    const b = pick || candidates[0];
    placed.push({
      key: `${l.kind}-${l.text}`, text: l.text, kind: l.kind, opacity: l.opacity,
      x: b.x, y: b.y, w: b.w, h: b.h, anchor, leader: b.push > 0, free: Boolean(pick),
    });
  }
  return placed;
};
