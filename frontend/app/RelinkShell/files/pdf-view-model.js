// pdf-view-model — the reader's pure law.
//
// Everything the viewer decides that does not touch a canvas: which page is
// current, how far the zoom reaches, and the instrument labels. The impure
// render (PdfView.jsx) calls these; the tests pin them without a DOM.

/** The zoom's honest reach — past these the page is illegible either way. */
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;
export const ZOOM_STEP = 1.25;

/**
 * The current page, clamped into the document (pure). A document that never
 * loaded (count 0) holds page 1 — there is nothing to show, and nothing
 * to navigate away from.
 * @param {number} page
 * @param {number} count
 * @returns {number}
 */
export const clampPage = (page, count) =>
  Math.min(Math.max(1, Math.floor(Number(page)) || 1), Math.max(1, Math.floor(Number(count)) || 1));

/**
 * One zoom act, clamped (pure). `dir` +1 in, −1 out; the step multiplies so
 * the reach feels even across the range.
 * @param {number} zoom
 * @param {1|-1} dir
 * @returns {number}
 */
export const stepZoom = (zoom, dir) => {
  const next = dir >= 0 ? zoom * ZOOM_STEP : zoom / ZOOM_STEP;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(next * 100) / 100));
};

/** The zoom as the instrument reads it (pure). */
export const zoomLabel = (zoom) => `${Math.round(zoom * 100)}%`;

/** The page as the instrument reads it (pure): `2 / 14`. */
export const pageLabel = (page, count) => `${clampPage(page, count)} / ${Math.max(1, Math.floor(Number(count)) || 1)}`;
