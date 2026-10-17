// Neutral record utilities shared across the memory layers — record-rendering
// and record-ordering helpers that are NOT specific to any one layer. Lifted
// out of episodic.js so a layer never depends on a sibling for a general-purpose
// helper (episodic, working, and procedural all use these). Pure, dependency-free.

/**
 * Render a record's content into searchable text. Strings pass through; objects
 * are flattened to their string leaves (bounded depth, so hostile/huge nested
 * content can't blow up indexing). Pure.
 * @param {Object} record
 * @param {number} [maxDepth=4]
 * @returns {string}
 */
export function recordToText(record, maxDepth = 4) {
  if (!record) return '';
  const out = [];
  const walk = (val, depth) => {
    if (depth > maxDepth) return;
    if (typeof val === 'string') { out.push(val); return; }
    if (typeof val === 'number' || typeof val === 'boolean') { out.push(String(val)); return; }
    if (Array.isArray(val)) { for (const v of val) walk(v, depth + 1); return; }
    if (val && typeof val === 'object') { for (const v of Object.values(val)) walk(v, depth + 1); }
  };
  walk(record.content, 0);
  return out.join(' ').trim();
}

/**
 * Approximate token count for a piece of record text. No tokenizer dependency
 * in the portable core — chars/4 is the standard cheap estimate, only used as
 * a hard budget backstop, so it does not need to be exact. Pure.
 * @param {string} text
 * @returns {number}
 */
const APPROX_CHARS_PER_TOKEN = 4;
export const approxTokens = (text) => approxTokensFromChars((text || '').length);
/** Same estimate for a caller that holds only a CHAR COUNT (the context map's
 *  kept/original figures). Pure. */
export const approxTokensFromChars = (chars) => Math.ceil((Number(chars) || 0) / APPROX_CHARS_PER_TOKEN);

/**
 * Comparator: newest recordedAt first; missing OR malformed stamps sort last.
 * (Recency is a fusion tiebreaker in retrieval, so a single NaN must not poison
 * the sort — Date.parse NaN is coerced to 0.) Pure.
 * @param {Object} a
 * @param {Object} b
 * @returns {number}
 */
export function byRecencyDesc(a, b) {
  const ta = a.recordedAt ? (Date.parse(a.recordedAt) || 0) : 0;
  const tb = b.recordedAt ? (Date.parse(b.recordedAt) || 0) : 0;
  return tb - ta;
}
