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

// AN ADDRESS THE PAGE PUBLISHES, BUT NOT AS WORDS. A reader in a browser sees
// these; stripping tags lost them (found 2026-11-15: a sales seat could not
// read a company's contact page). Two forms, both read as published, never guessed:
//   - Cloudflare's email protection: the address is on the page as hex, the
//     first byte the key every other byte is XORed with; the visible text is
//     "[email protected]" until the page's script puts it back.
//   - a mailto: link whose words do not show the address ([…]).
const cfDecode = (hex) => {
  const bytes = (String(hex).match(/[0-9a-f]{2}/gi) ?? []).map((b) => parseInt(b, 16));
  const out = bytes.slice(1).map((b) => String.fromCharCode(b ^ bytes[0])).join('');
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(out) ? out : null;
};
const CF_SPAN = /<(a|span)\b[^>]*\bdata-cfemail="([0-9a-f]+)"[^>]*>[\s\S]*?<\/\1\s*>/gi;
const CF_LINK = /<a\b[^>]*\bhref="[^"]*\/cdn-cgi\/l\/email-protection#([0-9a-f]+)"[^>]*>([\s\S]*?)<\/a\s*>/gi;
const MAILTO = /<a\b[^>]*\bhref="mailto:([^"?]+)[^"]*"[^>]*>([\s\S]*?)<\/a\s*>/gi;

/** Put each address a page publishes outside its words back into them. Pure. */
export const revealAddresses = (html) => String(html)
  .replace(CF_SPAN, (whole, tag, hex) => cfDecode(hex) ?? whole)
  .replace(CF_LINK, (whole, hex, inner) => { const email = cfDecode(hex); return !email ? whole : inner.includes(email) ? inner : `${inner.replace(/\[email(?:&#160;|&nbsp;|\s)protected\]/gi, '')} ${email}`; })
  .replace(MAILTO, (whole, address, inner) => { const email = decodeURIComponentSafe(address).trim(); return inner.includes(email) ? whole : `${inner} (${email})`; });

const decodeURIComponentSafe = (v) => { try { return decodeURIComponent(v); } catch { return v; } };

/**
 * Turn an HTML document into bounded readable text. Pure.
 * @param {string} html
 * @param {number} [maxChars] - hard output cap (default sized to research reads)
 * @returns {string}
 */
export const htmlToText = (html, maxChars = 20_000) => {
  const withoutCode = revealAddresses(String(html).replace(DROP_BLOCKS, ' '));
  const withBreaks = withoutCode.replace(BLOCK_TAGS, '\n');
  const text = decodeEntities(withBreaks.replace(ALL_TAGS, ' '));
  const lines = text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0);
  const out = lines.join('\n');
  return out.length > maxChars ? `${out.slice(0, maxChars)}\n[… truncated]` : out;
};
