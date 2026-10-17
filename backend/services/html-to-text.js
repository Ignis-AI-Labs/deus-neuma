// HTML → readable text, pure. A being fetching a page needs its words, not
// its markup: scripts, styles, and templates carry no research content, and
// megabytes of tags would drown the turn's context. Sized to the tool-result
// budget (the portal's own cap compresses further downstream).

// Blocks whose CONTENT is never research text. `head` covers title/meta/
// link — the title is read separately (extractTitle) on the raw document.
const DROP_BLOCKS = /<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\s*\1\s*>/gi;

// Tags that mark a boundary a reader would perceive as a new line.
const BLOCK_TAGS = /<\/?(?:p|div|section|article|header|footer|main|aside|nav|ul|ol|li|dl|dt|dd|table|thead|tbody|tr|td|th|blockquote|pre|h[1-6]|figure|figcaption|form|fieldset|hr|br)\b[^>]*>/gi;

const ALL_TAGS = /<[^>]+>/g;

const NAMED_ENTITIES = Object.freeze({
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', copy: '©', reg: '®',
});

/** Decode named and numeric HTML entities. Pure. */
export const decodeEntities = (raw) =>
  String(raw)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);

/** Extract the page's <title> text, decoded. Pure — null when absent. */
export const extractTitle = (html) => {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(html));
  if (!m) return null;
  const title = decodeEntities(m[1]).replace(/\s+/g, ' ').trim();
  return title || null;
};

/**
 * Turn an HTML document into bounded readable text. Pure.
 * @param {string} html
 * @param {number} [maxChars] - hard output cap (default sized to research reads)
 * @returns {string}
 */
export const htmlToText = (html, maxChars = 20_000) => {
  const withoutCode = String(html).replace(DROP_BLOCKS, ' ');
  const withBreaks = withoutCode.replace(BLOCK_TAGS, '\n');
  const text = decodeEntities(withBreaks.replace(ALL_TAGS, ' '));
  const lines = text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0);
  const out = lines.join('\n');
  return out.length > maxChars ? `${out.slice(0, maxChars)}\n[… truncated]` : out;
};
