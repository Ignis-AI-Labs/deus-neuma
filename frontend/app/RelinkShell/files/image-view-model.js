// image-view-model — the pure decisions behind the image window.
//
// Kept apart from the view for the same reason pdf-view-model is: the file that
// owns IO and pixels must not also own arithmetic, or neither can be tested
// without the other.

/** The formats a browser can decode without help. `.pdf` is NOT here — it has
 *  its own reader; `.svg` IS, and is deliberately rendered as an IMAGE rather
 *  than inlined, so a document that can carry script is never given a DOM. */
const IMAGE_EXT = Object.freeze([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg',
]);

/** The MIME a blob must wear for the browser to decode it. The backend's /raw
 *  serves `application/octet-stream` for every file (it is a download route),
 *  so the type has to be restored here or `<img>` gets bytes it will not read. */
const MIME = Object.freeze({
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
});

/** The lowercased extension of a path, without the dot. Pure. */
export const extOf = (path) => {
  const name = String(path || '').split(/[\\/]/).pop() || '';
  const dot = name.lastIndexOf('.');
  // A leading dot is a dotfile, not an extension: `.gitignore` has none.
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
};

/** Can this path be shown as an image? Pure. */
export const isImagePath = (path) => IMAGE_EXT.includes(extOf(path));

/** The MIME to hand the blob, or a safe generic. Pure. */
export const imageMime = (path) => MIME[extOf(path)] || 'application/octet-stream';

/** Bytes, in the register the operator reads sizes in. Pure.
 *  An unknown size is ABSENT, never "0 B" — `Number(null)` is 0, and a bar that
 *  reads "0 B" for a file it has not measured is stating a fact it does not
 *  have. */
export const byteLabel = (n) => {
  if (n === null || n === undefined || n === '') return null;
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return null;
  if (v >= 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(1)} MB`;
  if (v >= 1024) return `${Math.round(v / 1024)} KB`;
  return `${Math.round(v)} B`;
};

/** The zoom rungs. 0 means FIT — the window decides the scale, not a number. */
const RUNGS = Object.freeze([0, 0.25, 0.5, 1, 2, 4]);

/** Step the zoom one rung, clamped at both ends. Pure. */
export const stepZoom = (current, direction) => {
  const at = RUNGS.indexOf(current);
  const i = at === -1 ? RUNGS.indexOf(1) : at;
  const next = Math.min(RUNGS.length - 1, Math.max(0, i + (direction > 0 ? 1 : -1)));
  return RUNGS[next];
};

/** What the zoom control reads. FIT is a word, not a percentage. Pure. */
export const zoomLabel = (zoom) => (zoom === 0 ? 'FIT' : `${Math.round(zoom * 100)}%`);
