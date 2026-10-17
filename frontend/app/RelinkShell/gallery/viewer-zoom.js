// viewer-zoom.js — how a work hangs on the wall, and how close you may lean in.
//
// Design note, 2026-08-05: […]
//
// Two separate things, kept separate here:
//
//   • THE HANG is the browser's own — `max-width/max-height: 100%` draws the
//     work as large as the frame allows and stops at its own resolution,
//     because a max never magnifies. Resizing the window rehangs it for free,
//     with no measurement and no state. That is the whole of the first ask.
//   • THE LEAN is this module — a multiplier ON TOP of the hang. zoom === 1 is
//     the hung size whatever the frame is now, so the two never fight: the
//     operator's lean survives a resize instead of being recomputed away.
//
// `base` is the hung size in CSS px (the element's layout box), `natural` the
// work's own pixels, `frame` the stage. All pure: no DOM, no clock.

/** The furthest in: eight times the work's own pixels. Past that is mush. */
export const MAX_DISPLAY = 8;

/** The hang — the whole work, centred, at whatever size the frame allows. */
export const FIT = Object.freeze({ zoom: 1, x: 0, y: 0 });

/** The centre — where the transform's origin sits, and the zero of every
 *  cursor and pan measurement. Frozen so a shared zero never drifts. */
export const ORIGIN = Object.freeze({ x: 0, y: 0 });

/** A zero box — the size of a thing not yet measured. Distinct from ORIGIN
 *  (a point) so each shared constant means exactly one thing. */
export const ZERO_BOX = Object.freeze({ w: 0, h: 0 });

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
// `+ 0` folds -0 back to 0. Clamping a negative offset against a zero limit
// yields -0 — equal to 0 under `===`, but not under Object.is or any deep
// compare, so a centred view would read as two different centred views.
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v)) + 0;

/**
 * How large the hung work is drawn against its own resolution. Pure.
 * 1 means every pixel of the file is on screen; 0.4 means it is shown at
 * two-fifths and there is detail the operator has not been given yet.
 */
export const fitRatio = (base, natural) => {
  const bw = num(base?.w);
  const nw = num(natural?.w);
  return bw > 0 && nw > 0 ? bw / nw : 1;
};

/** The ceiling on the lean, in hang-multiples. Never below 1 (the hang). */
export const zoomCeiling = (base, natural) => {
  const r = fitRatio(base, natural);
  return r > 0 ? Math.max(1, MAX_DISPLAY / r) : 1;
};

/**
 * What the readout says: percent of the work's OWN resolution, not of the
 * frame. 100% is one file pixel per screen pixel — the only percentage that
 * means anything about an image.
 */
export const displayPercent = (base, natural, zoom) =>
  Math.max(1, Math.round(fitRatio(base, natural) * (num(zoom) || 1) * 100));

/**
 * One wheel event → a zoom multiplier. Pure.
 *
 * Exponential because zoom is multiplicative: the same notch has to feel the
 * same at 20% and at 400%. Line and page deltas are normalized to pixels, then
 * clipped — a flung trackpad or a chunky page scroll must not teleport the
 * operator to the ceiling in one event.
 */
export const wheelFactor = (deltaY, deltaMode = 0) => {
  const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1;
  const step = clamp(num(deltaY) * unit, -600, 600);
  return Math.exp(-step * 0.002);
};

/**
 * How far the work may be dragged: to its own edge and no further. Pure.
 * An axis on which it still fits is pinned to 0 — a work smaller than the wall
 * hangs centred, it does not slide around.
 */
export const panLimit = (base, zoom, frame) => ({
  x: Math.max(0, (num(base?.w) * (num(zoom) || 1) - num(frame?.w)) / 2),
  y: Math.max(0, (num(base?.h) * (num(zoom) || 1) - num(frame?.h)) / 2),
});

/**
 * The view, made legal for the geometry it is being shown in. Pure.
 *
 * Called again on every resize, which is what keeps a lean honest: the work
 * rehangs at the new frame size and the pan is pulled back inside its edges
 * rather than leaving a strip of empty wall.
 *
 * @param {{zoom:number, x:number, y:number}} view
 * @param {{base:{w,h}, natural:{w,h}, frame:{w,h}}} geom
 */
export const clampView = (view, geom) => {
  const zoom = clamp(num(view?.zoom) || 1, 1, zoomCeiling(geom?.base, geom?.natural));
  const lim = panLimit(geom?.base, zoom, geom?.frame);
  return { zoom, x: clamp(num(view?.x), -lim.x, lim.x), y: clamp(num(view?.y), -lim.y, lim.y) };
};

/** Whether two views are the same view — so a re-clamp that changes nothing
 *  can return the SAME object and let React bail out of the render. Pure. */
export const sameView = (a, b) =>
  num(a?.zoom) === num(b?.zoom) && num(a?.x) === num(b?.x) && num(a?.y) === num(b?.y);

/**
 * Zoom by `factor`, keeping whatever is under the cursor under the cursor. Pure.
 *
 * This is the difference between a viewer that feels like a lens and one that
 * feels like a slider: you point at the detail you want and it grows where it
 * already is. `cursor` is measured from the CENTRE of the frame, because that
 * is where the transform's origin sits.
 */
export const zoomAbout = (view, factor, cursor, geom) => {
  const from = num(view?.zoom) || 1;
  const zoom = clamp(from * (num(factor) || 1), 1, zoomCeiling(geom?.base, geom?.natural));
  const k = zoom / from;
  const cx = num(cursor?.x);
  const cy = num(cursor?.y);
  return clampView({ zoom, x: cx - (cx - num(view?.x)) * k, y: cy - (cy - num(view?.y)) * k }, geom);
};

/** Drag the work by a pointer delta. Pure. */
export const panBy = (view, dx, dy, geom) =>
  clampView({ ...view, zoom: num(view?.zoom) || 1, x: num(view?.x) + num(dx), y: num(view?.y) + num(dy) }, geom);

/**
 * The lean-in a double-click asks for: the work's own pixels, 1:1. Pure.
 *
 * A work already hung at full resolution has no 1:1 to go to, so it gets a
 * plain doubling instead — a double-click that does nothing reads as broken.
 */
export const leanIn = (geom) => {
  const r = fitRatio(geom?.base, geom?.natural);
  const target = Math.max(r > 0 ? 1 / r : 1, 2);
  return clamp(target, 1, zoomCeiling(geom?.base, geom?.natural));
};

/** The CSS transform for a view. Pure — scale about the centre, then slide. */
export const transformOf = (view) =>
  `translate(${num(view?.x)}px, ${num(view?.y)}px) scale(${num(view?.zoom) || 1})`;
