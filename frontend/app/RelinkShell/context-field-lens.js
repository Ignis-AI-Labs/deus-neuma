// context-field-lens.js — the FIELD's pure lens: filters and zoom math.
//
// The witness asked for depth and navigation (2026-07-24): filter the
// crystallized field by PRESENCE (memories that speak of a housemate, the
// witness, later an Unavis contact) and by COMMUNITY, and move through the
// field with real zoom/pan. Filters DIM instead of removing — the layout
// never reflows under the witness's eyes, and the honest count says how
// many memories the lens holds. Pure throughout — no React, no DOM (D1).

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 8;

/** Clamp a zoom factor to the honest range. Pure. */
export const clampZoom = (z) =>
  Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number.isFinite(z) ? z : 1));

// A dimension that isn't a finite number reads as zero — the box math never
// propagates NaN (echo r2).
const finiteDim = (n) => (Number.isFinite(n) ? n : 0);

/** The identity view over a drawn field of w×h pixels. Pure. */
export const initialView = (w, h) => ({ zoom: 1, cx: finiteDim(w) / 2, cy: finiteDim(h) / 2 });

/**
 * The SVG viewBox a view describes: centered on (cx, cy), showing the
 * field at `zoom` (bigger zoom = smaller world window = closer). Pure.
 * @param {number} w - drawn field width (px)
 * @param {number} h - drawn field height (px)
 * @param {{zoom: number, cx: number, cy: number}} view
 * @returns {string} […]
 */
export const viewBoxOf = (w, h, view) => {
  const ww = finiteDim(w);
  const hh = finiteDim(h);
  const z = clampZoom(view?.zoom);
  const vw = ww / z;
  const vh = hh / z;
  const cx = Number.isFinite(view?.cx) ? view.cx : ww / 2;
  const cy = Number.isFinite(view?.cy) ? view.cy : hh / 2;
  return `${cx - vw / 2} ${cy - vh / 2} ${vw} ${vh}`;
};

// A view field that isn't a finite number reads as the given fallback — the
// math below never propagates NaN into a viewBox or a pan (echo r1, Grok).
const finiteOr = (n, fallback) => (Number.isFinite(n) ? n : fallback);

/**
 * The screen-px-per-world-unit factor of a CSS-sized SVG at identity zoom:
 * the field's viewBox letterboxes into the stage (preserveAspectRatio meet),
 * so the rendered scale is the tighter of the two ratios. A drag's pixel
 * delta divides by this before panBy so the field follows the pointer 1:1
 * whatever size the pane is. Degenerate boxes (zero, NaN — an unmounted or
 * collapsed stage) read as 1, never Infinity into a pan. Pure.
 * @param {number} rectW - rendered stage width (px)
 * @param {number} rectH - rendered stage height (px)
 * @param {number} worldW - drawn field width (world units)
 * @param {number} worldH - drawn field height (world units)
 * @returns {number}
 */
export const renderedBaseScale = (rectW, rectH, worldW, worldH) => {
  // Any degenerate world dimension (zero, negative, NaN — a field never
  // drawn) reads as identity, so a pan never divides by rot.
  if (!(Number.isFinite(worldW) && worldW > 0 && Number.isFinite(worldH) && worldH > 0)) return 1;
  const s = Math.min(finiteDim(rectW) / worldW, finiteDim(rectH) / worldH);
  return Number.isFinite(s) && s > 0 ? s : 1;
};

/**
 * Zoom by a factor around the current center. Pure; malformed views
 * normalize instead of spreading their rot.
 * @param {{zoom: number, cx: number, cy: number}} view
 * @param {number} factor - >1 closer, <1 farther
 */
export const zoomBy = (view, factor) => ({
  zoom: clampZoom(clampZoom(view?.zoom) * finiteOr(factor, 1)),
  cx: finiteOr(view?.cx, 0),
  cy: finiteOr(view?.cy, 0),
});

/**
 * Pan by a SCREEN-pixel delta — converted to world units by the zoom, so a
 * drag follows the pointer at any depth. Pure; tolerates malformed views.
 * @param {{zoom: number, cx: number, cy: number}} view
 * @param {number} dxPx
 * @param {number} dyPx
 */
export const panBy = (view, dxPx, dyPx) => {
  const z = clampZoom(view?.zoom);
  return {
    zoom: z,
    cx: finiteOr(view?.cx, 0) - finiteOr(dxPx, 0) / z,
    cy: finiteOr(view?.cy, 0) - finiteOr(dyPx, 0) / z,
  };
};

/**
 * The lens over the field's nodes: which ids stay LIT under the active
 * presence/community filters (both may hold at once — AND). null filters
 * hold nothing back. Pure.
 * @param {Array<{id: any, presences?: string[], communityIndex?: number}>} nodes
 * @param {{presence?: string|null, community?: number|null}} lens
 * @returns {{lit: Set<string>, shown: number, total: number, active: boolean}}
 */
export const applyFieldLens = (nodes, lens) => {
  // A non-string presence filter holds nothing back; non-string tag entries
  // simply never match — the lens degrades, it never throws (echo r1, Grok).
  const presence = typeof lens?.presence === 'string' ? lens.presence.toLowerCase() : null;
  const community = Number.isInteger(lens?.community) ? lens.community : null;
  const active = presence !== null || community !== null;
  const list = Array.isArray(nodes) ? nodes : [];
  const lit = new Set();
  for (const n of list) {
    if (!n || typeof n !== 'object') continue; // a rotten element never throws the lens
    const speaksOf = presence === null
      || (Array.isArray(n.presences) && n.presences.some((p) => typeof p === 'string' && p.toLowerCase() === presence));
    const inCommunity = community === null || n.communityIndex === community;
    if (speaksOf && inCommunity && n.id != null) lit.add(String(n.id));
  }
  return { lit, shown: lit.size, total: list.length, active };
};
