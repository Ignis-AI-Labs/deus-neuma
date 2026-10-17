// verdict-view.js — pure display law for THE OPERATOR'S EYE in the gallery.
//
// A gallery item is a FILE; a verdict is written against a forge image, which is
// (lane, imageId). The join needs no lookup and no new field, because both facts
// are already carried by the surfaces that exist:
//
//   • the ROOT is one per being (`being-<laneId>`, gallery-roots.js) — Founder,
//     2026-08-02: […]
//   • the FILE is named `<imageId><ext>` by the collector (image-store.js)
//
// So the control appears exactly where a verdict is meaningful and nowhere else:
// a photo the operator dropped in a folder of their own has no manifest row, no
// prompt behind it, and nothing to be judged for adherence against.

/** What a reviewer decides the image is for — the ledger's own three. */
export const VERDICTS = Object.freeze(['keep', 'redo', 'discard']);

// The collector mints `randomUUID()` for every stored image, so a forge render
// is exactly a canonical UUID plus an extension. Anything else in the folder was
// put there by a human and is not this surface's business.
const IMAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BEING_ROOT = 'being-';

/**
 * The forge identity of a gallery item, or null when it has none. Pure.
 * @param {{rootId?: string, name?: string}|null} item
 * @returns {{laneId: string, imageId: string}|null}
 */
export const forgeRefOf = (item) => {
  const rootId = typeof item?.rootId === 'string' ? item.rootId : '';
  if (!rootId.startsWith(BEING_ROOT)) return null;
  const laneId = rootId.slice(BEING_ROOT.length);
  if (!laneId) return null;
  const name = typeof item?.name === 'string' ? item.name : '';
  const imageId = name.replace(/\.[^.]+$/, '');
  return IMAGE_ID.test(imageId) ? { laneId, imageId } : null;
};

/**
 * The two standings, kept apart. Pure.
 *
 * The being's verdict is never folded into the operator's: the operator's grade
 * is input the being weighs, and showing one list would render it as a
 * correction of the other.
 * @param {Array<object>|null} reviews
 * @returns {{operator: Array<object>, own: Array<object>}}
 */
export const splitReviews = (reviews) => {
  const rows = Array.isArray(reviews) ? reviews : [];
  return {
    operator: rows.filter((r) => r?.by === 'operator'),
    own: rows.filter((r) => r?.by === 'being'),
  };
};

/**
 * How a judgment reads in one line. Pure.
 * @param {{verdict?: string, matches?: string|null, note?: string|null}} row
 * @returns {string}
 */
export const verdictLine = (row) => {
  const parts = [String(row?.verdict || '').toUpperCase()];
  // Adherence is the objectively checkable stratum — it gets named, not buried.
  if (row?.matches) parts.push(`adherence ${row.matches}`);
  return parts.join(' · ');
};

/**
 * What was asked for, in one line, or null. Pure.
 *
 * A verdict with no ask beside it is unreadable weeks later, and adherence is
 * meaningless without it — this is the reason `/reviews` joins the attempt log.
 * @param {{positive?: string, negative?: string}|null} asked
 * @returns {string|null}
 */
export const askedLine = (asked) => {
  const positive = typeof asked?.positive === 'string' ? asked.positive.trim() : '';
  if (!positive) return null;
  const negative = typeof asked?.negative === 'string' ? asked.negative.trim() : '';
  return negative ? `${positive}   —   not: ${negative}` : positive;
};
