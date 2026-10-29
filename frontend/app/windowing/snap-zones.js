// snap-zones.js — OS-style aero snapping, as pure data + functions.
//
// Given the snap bounds and the pointer during a drag, decide which zone
// (if any) the window locks to, and the rect that zone fills. The zone set
// is a 2x2 grid plus maximize: edges -> halves, corners -> quarters, the
// top edge -> maximize. Swap ZONES / thresholds here to add thirds or a
// custom N x M grid later — nothing else needs to change.

import { MIN } from './geometry.js';

// THE DELIBERATE SNAP (ruling, 2026-07-29): […] Snapping is a decision made AT the boundary,
// never an accident of travel — the pointer must press the edge itself,
// not merely pass nearby.
const EDGE = 8; // px from a side counts as "at the edge" — a press, not a pass
const CORNER = 24; // a CORNER x CORNER box at each corner counts as "in the corner" (40 until 2026-10-05: too easy to land in)

// THE HELD SNAP (Design note, 2026-10-05: […]; then […] — the
// hold went 450 → 600 ms and a split on a sibling now also needs Shift held,
// use-window-frame.js). Reaching a zone no longer decides
// anything: the pointer has to STAY in the same zone this long before it arms
// — only then does its preview light, and only an armed zone is applied on
// release. Travel through a corner, past the top edge or across a sibling's
// seam leaves the window exactly where it was let go.
export const SNAP_DWELL_MS = 600;

/**
 * What the pointer is hinting at, as one comparable key — a desk zone, or a
 * sibling's split side (that sibling named by where it stands). The SAME key
 * held for SNAP_DWELL_MS arms it; any change starts the wait again. Pure.
 * @param {string|null} zone
 * @param {{side:string, target:{rect:{x,y}}}|null} split
 * @returns {string|null}
 */
export const hintKey = (zone, split) => (zone
  ? `zone:${zone}`
  : split ? `split:${split.side}:${split.target.rect.x},${split.target.rect.y}` : null);

/**
 * The rect a zone fills within bounds.
 * @param {string} id left|right|bottom|tl|tr|bl|br|max
 * @param {{x,y,w,h}} b
 * @returns {{x,y,w,h}|null}
 */
export const rectForZone = (id, b) => {
  const hw = b.w / 2;
  const hh = b.h / 2;
  switch (id) {
    case 'left':   return { x: b.x,       y: b.y,       w: hw,  h: b.h };
    case 'right':  return { x: b.x + hw,  y: b.y,       w: hw,  h: b.h };
    case 'bottom': return { x: b.x,       y: b.y + hh,  w: b.w, h: hh };
    case 'tl':     return { x: b.x,       y: b.y,       w: hw,  h: hh };
    case 'tr':     return { x: b.x + hw,  y: b.y,       w: hw,  h: hh };
    case 'bl':     return { x: b.x,       y: b.y + hh,  w: hw,  h: hh };
    case 'br':     return { x: b.x + hw,  y: b.y + hh,  w: hw,  h: hh };
    case 'max':    return { ...b };
    default:       return null;
  }
};

/**
 * Which zone the pointer is hinting at, or null. Corners win over edges;
 * the top edge maximizes (classic aero), the bottom edge half-fills.
 * @param {{x,y}} p pointer in canvas space
 * @param {{x,y,w,h}} b snap bounds
 * @returns {string|null}
 */
export const hitZone = (p, b) => {
  const inL = p.x <= b.x + CORNER;
  const inR = p.x >= b.x + b.w - CORNER;
  const inT = p.y <= b.y + CORNER;
  const inB = p.y >= b.y + b.h - CORNER;

  if (inT && inL) return 'tl';
  if (inT && inR) return 'tr';
  if (inB && inL) return 'bl';
  if (inB && inR) return 'br';

  if (p.x <= b.x + EDGE) return 'left';
  if (p.x >= b.x + b.w - EDGE) return 'right';
  if (p.y <= b.y + EDGE) return 'max';
  if (p.y >= b.y + b.h - EDGE) return 'bottom';
  return null;
};

// --- Window-on-window splitting (the editor-group idiom) ---
// Dragging one window over ANOTHER offers to divide the target's space
// perfectly in half (Design note, 2026-07-24: hover between two spaces → divide).
// Pure companions to hitZone/rectForZone: which side of the target the
// pointer hints at, and the two half-rects a drop commits.

const SPLIT_BAND = 0.125; // the outer eighth of a side hints a split — a deliberate aim at the seam; the calm middle never surprises

/**
 * Which side of a target window a pointer hints a split at, or null.
 * A side whose half would dip below the minimum window size never offers
 * (an unusable sliver is not a split); the nearest offering side within
 * the band wins, ties resolved in left→right→top→bottom order.
 * @param {{x,y}} p pointer in canvas space
 * @param {{x,y,w,h}} r the target window's rect
 * @returns {string|null} left|right|top|bottom
 */
export const splitZone = (p, r, min = MIN) => {
  const fx = (p.x - r.x) / r.w;
  const fy = (p.y - r.y) / r.h;
  if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null;
  const sides = [];
  if (r.w / 2 >= min.w) sides.push(['left', fx], ['right', 1 - fx]);
  if (r.h / 2 >= min.h) sides.push(['top', fy], ['bottom', 1 - fy]);
  const best = sides.reduce((a, s) => (a && a[1] <= s[1] ? a : s), null);
  return best && best[1] <= SPLIT_BAND ? best[0] : null;
};

/**
 * The two halves a split commits: `taken` for the dragged window (the side
 * that was hinted), `kept` for the target — together exactly the target's
 * old rect, divided perfectly in half.
 * @param {string} side left|right|top|bottom
 * @param {{x,y,w,h}} r the target window's rect
 * @returns {{taken:{x,y,w,h}, kept:{x,y,w,h}}|null}
 */
export const splitRects = (side, r) => {
  const hw = r.w / 2;
  const hh = r.h / 2;
  switch (side) {
    case 'left':   return { taken: { x: r.x, y: r.y, w: hw, h: r.h }, kept: { x: r.x + hw, y: r.y, w: hw, h: r.h } };
    case 'right':  return { taken: { x: r.x + hw, y: r.y, w: hw, h: r.h }, kept: { x: r.x, y: r.y, w: hw, h: r.h } };
    case 'top':    return { taken: { x: r.x, y: r.y, w: r.w, h: hh }, kept: { x: r.x, y: r.y + hh, w: r.w, h: hh } };
    case 'bottom': return { taken: { x: r.x, y: r.y + hh, w: r.w, h: hh }, kept: { x: r.x, y: r.y, w: r.w, h: hh } };
    default:       return null;
  }
};
