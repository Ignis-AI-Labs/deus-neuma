// geometry.js — pure window-rectangle math.
//
// A rect is { x, y, w, h } in canvas pixels; bounds is the same shape (the
// snap area the window must stay inside). No DOM, no state — every function
// is a pure transform, so the windowing behaviour is unit-testable.

export const MIN = Object.freeze({ w: 320, h: 220 });

/**
 * Keep a rect inside bounds and no smaller than min. Used after a move.
 * @returns {{x,y,w,h}}
 */
export const clampRect = (rect, bounds, min = MIN) => {
  const w = Math.max(min.w, Math.min(rect.w, bounds.w));
  const h = Math.max(min.h, Math.min(rect.h, bounds.h));
  const x = Math.min(Math.max(rect.x, bounds.x), bounds.x + bounds.w - w);
  const y = Math.min(Math.max(rect.y, bounds.y), bounds.y + bounds.h - h);
  return { x, y, w, h };
};

/** Translate a rect by (dx, dy), clamped to bounds. */
export const moveRect = (rect, dx, dy, bounds) =>
  clampRect({ ...rect, x: rect.x + dx, y: rect.y + dy }, bounds);

/**
 * Resize from an edge/corner handle by (dx, dy). The anchored (opposite)
 * edge stays put; min-size pins the moving edge; bounds clip without
 * dragging the anchor.
 * @param {string} edge one of n,s,e,w,ne,nw,se,sw
 */
export const resizeRect = (rect, edge, dx, dy, bounds, min = MIN) => {
  let { x, y, w, h } = rect;
  if (edge.includes('e')) w = rect.w + dx;
  if (edge.includes('s')) h = rect.h + dy;
  if (edge.includes('w')) { w = rect.w - dx; x = rect.x + dx; }
  if (edge.includes('n')) { h = rect.h - dy; y = rect.y + dy; }

  // min size — pin the moving (north/west) edge so the anchor holds
  if (w < min.w) { if (edge.includes('w')) x = rect.x + rect.w - min.w; w = min.w; }
  if (h < min.h) { if (edge.includes('n')) y = rect.y + rect.h - min.h; h = min.h; }

  // clip to bounds without moving the anchored edge
  const right = bounds.x + bounds.w;
  const bottom = bounds.y + bounds.h;
  if (x < bounds.x) { w -= bounds.x - x; x = bounds.x; }
  if (y < bounds.y) { h -= bounds.y - y; y = bounds.y; }
  if (x + w > right) w = right - x;
  if (y + h > bottom) h = bottom - y;
  w = Math.max(min.w, w);
  h = Math.max(min.h, h);
  return { x, y, w, h };
};

/** The maximized rect fills the bounds. */
export const maxRect = (bounds) => ({ ...bounds });

/** A sensible opening rect: centred, roughly two-thirds, clamped. */
export const defaultRect = (bounds) => {
  const w = Math.min(560, bounds.w);
  const h = Math.min(680, bounds.h);
  return {
    x: bounds.x + (bounds.w - w) / 2,
    y: bounds.y + (bounds.h - h) / 2,
    w,
    h,
  };
};

/**
 * The snap/drag bounds inside a region box (the desk's window region beside
 * the Explorer panel, or the viewport when no region is registered): the box
 * shrunk by the inset, floored at min so a tiny region still yields workable
 * bounds. Box and result share one coordinate space (viewport px), the same
 * space pointer events and persisted window x/y live in.
 * @param {{x,y,w,h}} box
 * @param {{top:number,right:number,bottom:number,left:number}} inset
 * @returns {{x,y,w,h}}
 */
export const insetBounds = (box, inset, min = MIN) => ({
  x: box.x + inset.left,
  y: box.y + inset.top,
  w: Math.max(min.w, box.w - inset.left - inset.right),
  h: Math.max(min.h, box.h - inset.top - inset.bottom),
});
