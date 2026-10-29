// gallery-view.js — how the gallery organizes what it was given. Pure.
//
// Design note, 2026-08-01: […] — so: filter by kind, filter by folder,
// search by name, and sort by the axes a gallery is actually sorted by.
//
// All of it is one pure fold over the item list, so the ordering rules are
// testable without a disk, a network, or a rendered grid.

/** The kind filters, in the order the UI offers them. */
export const KINDS = Object.freeze(['all', 'image', 'video']);

/** The sort axes, in the order the UI offers them. */
export const SORTS = Object.freeze([
  { id: 'newest', label: 'NEWEST' },
  { id: 'oldest', label: 'OLDEST' },
  { id: 'name', label: 'NAME' },
  { id: 'largest', label: 'LARGEST' },
]);

const compare = {
  // Newest first is the gallery default: the thing you just made is the thing
  // you came to look at.
  newest: (a, b) => b.modified - a.modified,
  oldest: (a, b) => a.modified - b.modified,
  name: (a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: 'base' }),
  largest: (a, b) => b.bytes - a.bytes,
};

/**
 * Apply the operator's view choices to the raw item list. Pure.
 *
 * @param {Array<object>} items raw items from GET /gallery/items
 * @param {{kind?: string, rootId?: string|null, query?: string, sort?: string}} view
 * @returns {{items: Array<object>, counts: {all:number, image:number, video:number}}}
 */
export const applyView = (items, view = {}) => {
  const list = Array.isArray(items) ? items : [];
  const kind = KINDS.includes(view.kind) ? view.kind : 'all';
  const sort = compare[view.sort] ? view.sort : 'newest';
  const needle = String(view.query || '').trim().toLowerCase();

  // Counts describe what the FOLDER filter leaves, not what the kind filter
  // leaves — otherwise selecting VIDEOS would report "0 images" and the tab
  // would look broken rather than empty.
  const inScope = list.filter((it) => (view.rootId ? it.rootId === view.rootId : true));
  const counts = {
    all: inScope.length,
    image: inScope.filter((it) => it.kind === 'image').length,
    video: inScope.filter((it) => it.kind === 'video').length,
  };

  const filtered = inScope
    .filter((it) => (kind === 'all' ? true : it.kind === kind))
    .filter((it) => (needle ? String(it.name).toLowerCase().includes(needle) : true));

  return { items: [...filtered].sort(compare[sort]), counts };
};

/**
 * Group items by calendar day, newest day first — the shape a gallery reads
 * best in when it holds a whole history. Pure.
 *
 * `dayKey` is derived from the item's own timestamp in LOCAL time, because the
 * operator thinks in the day they made the thing, not in UTC.
 * @param {Array<object>} items already filtered and sorted
 * @returns {Array<{key: string, items: Array<object>}>}
 */
export const groupByDay = (items) => {
  const out = [];
  const byKey = new Map();
  for (const it of items) {
    const d = new Date(it.modified);
    const key = Number.isNaN(d.getTime())
      ? 'unknown'
      : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!byKey.has(key)) { const g = { key, items: [] }; byKey.set(key, g); out.push(g); }
    byKey.get(key).items.push(it);
  }
  return out;
};

/** A file size a person can read. Pure. */
export const readableBytes = (bytes) => {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const MONTHS = Object.freeze(['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']);

/**
 * When a work was made, as a wall label says it. Pure.
 *
 * Built from the date's own parts rather than `toLocaleString` so the label is
 * the same string on every machine — and in LOCAL time, because the operator
 * remembers the evening they made it, not the UTC hour.
 */
export const madeOn = (ms) => {
  const d = new Date(Number(ms));
  if (Number.isNaN(d.getTime())) return '';
  const h24 = d.getHours();
  const h12 = ((h24 + 11) % 12) + 1;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} · ${h12}:${String(d.getMinutes()).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
};

/**
 * The wall label under an open work. Pure.
 *
 * Design note, 2026-08-05: […]
 *
 * Shaped like a museum placard, because that is the honest shape for what we
 * have: the SOURCE reads as the maker (a being's own art folder is that being's
 * body of work), the filename reads as the accession number — a forge render is
 * named by UUID and pretending that is a title would be a lie — and the facts
 * line carries when, how large, and how heavy.
 *
 * `natural` is the work's own resolution, known only once the browser has
 * decoded it; until then the dimensions are simply absent rather than guessed.
 *
 * @param {object|null} item
 * @param {{w:number, h:number}|null} natural
 */
export const plaqueOf = (item, natural) => {
  const w = Number(natural?.w) || 0;
  const h = Number(natural?.h) || 0;
  return {
    maker: item?.rootLabel || '',
    accession: item?.name || '',
    facts: [
      madeOn(item?.modified),
      w > 0 && h > 0 ? `${w} × ${h}` : '',
      readableBytes(item?.bytes),
    ].filter(Boolean),
  };
};

/**
 * One item's stable identity. Pure.
 * `rootId` alone is not unique and `rel` alone is not either — two roots can
 * both hold `shot.png`. The pair is what addresses a file.
 */
export const itemKey = (item) => `${item?.rootId ?? ''}:${item?.rel ?? ''}`;

/**
 * The item `delta` places away in the CURRENT view, or null at the ends. Pure.
 *
 * Navigation follows what the operator is actually looking at — the filtered,
 * sorted list — not the raw scan. Arrowing right inside VIDEOS must not land on
 * an image that the filter is hiding.
 *
 * Deliberately does NOT wrap: hitting the end and silently reappearing at the
 * start makes a long gallery impossible to reason about, and there is no cue
 * that it happened.
 *
 * @param {Array<object>} items the view's items, in display order
 * @param {object|null} current
 * @param {number} delta -1 for previous, +1 for next
 * @returns {object|null}
 */
export const neighborOf = (items, current, delta) => {
  const list = Array.isArray(items) ? items : [];
  if (!current) return null;
  const key = itemKey(current);
  const i = list.findIndex((it) => itemKey(it) === key);
  if (i === -1) return null;
  const next = i + (Number(delta) || 0);
  return next >= 0 && next < list.length ? list[next] : null;
};

/**
 * The item a render's image id names, for a tray card landing on it. A
 * being's render is stored as `<imageId>.<ext>` in its own art folder
 * (image-store.js), so the file's name carries the id. Pure.
 * @param {Array<object>} items the whole scan
 * @param {unknown} imageId
 * @returns {object|null}
 */
export const itemOfImage = (items, imageId) => {
  if (typeof imageId !== 'string' || imageId === '') return null;
  const named = (name) => typeof name === 'string' && name.lastIndexOf('.') > 0
    && name.slice(0, name.lastIndexOf('.')) === imageId;
  return (Array.isArray(items) ? items : []).find((it) => named(it?.name)) || null;
};

/**
 * Where the open item sits in the view, for a "3 of 40" readout. Pure.
 * @returns {{index: number, total: number}|null} index is 1-based
 */
export const positionOf = (items, current) => {
  const list = Array.isArray(items) ? items : [];
  if (!current) return null;
  const i = list.findIndex((it) => itemKey(it) === itemKey(current));
  return i === -1 ? null : { index: i + 1, total: list.length };
};

/**
 * The route to one item's bytes. Pure.
 *
 * NOT itself authenticated — it carries no credential, and it cannot: the /file
 * route wants a Bearer header, which no <img>/<video> src can send. Callers
 * fetch this with auth headers and hand the element an object URL (AuthImage /
 * AuthVideo). Calling it "the authenticated URL" invited exactly the mistake of
 * dropping it straight into a src (echo r1, GLM).
 */
export const fileUrl = (item) =>
  `/api/v1/gallery/file?rootId=${encodeURIComponent(item.rootId)}&rel=${encodeURIComponent(item.rel)}`;
