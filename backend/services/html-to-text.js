// HTML → readable text, pure. A being fetching a page needs its words, not
// its markup: scripts, styles, and templates carry no research content, and
// megabytes of tags would drown the turn's context. Sized to the tool-result
// budget (the portal's own cap compresses further downstream).
//
// EVERY READ IS ONE PASS (PR600 audit P6-125). The page is a stranger's, up to
// a megabyte of it, read on the backend's one thread. Patterns of the shape
// `<x[^>]*>…</x>` restart at every `<x` and run to the page's end when nothing
// closes: 100,000 `<` held every lane and wallet route for fourteen seconds.
// Tags are now cut by hand (cutTags) and elements are paired once
// (rewriteElements); no pattern here reads further than the tag it starts in.

// Blocks whose CONTENT is never research text. `head` covers title/meta/
// link — the title is read separately (extractTitle) on the raw document.
const DROPPED = 'script|style|noscript|template|svg|head';

// Tags that mark a boundary a reader would perceive as a new line.
const BLOCK_TAG = /<\/?(?:p|div|section|article|header|footer|main|aside|nav|ul|ol|li|dl|dt|dd|table|thead|tbody|tr|td|th|blockquote|pre|h[1-6]|figure|figcaption|form|fieldset|hr|br)\b/gi;
// Any other tag: a `<`, at least one character that is not `>`, through the next `>`.
const ANY_TAG = /<(?=[^>])/g;

// pure — every element of the named kinds, opening tag through the first closing tag of its name after
// it, put to `rewrite`; an element it answers null for stays as written. `tagEnd` says where an opening
// tag ends (-1: nowhere, and nothing after it can be an element either).
const rewriteElements = (html, names, tagEnd, rewrite) => {
  const closes = new Map();
  for (const m of html.matchAll(new RegExp(`<\\/\\s*(${names})\\s*>`, 'gi'))) {
    const name = m[1].toLowerCase();
    if (!closes.has(name)) closes.set(name, []);
    closes.get(name).push([m.index, m.index + m[0].length]);
  }
  const open = new RegExp(`<(${names})\\b`, 'gi');
  const reached = new Map();
  const out = [];
  let kept = 0;
  for (let m = open.exec(html); m; m = open.exec(html)) {
    const name = m[1].toLowerCase();
    const inner = tagEnd(html, open.lastIndex);
    if (inner === -1) break;
    open.lastIndex = inner;
    const list = closes.get(name) ?? [];
    let k = reached.get(name) ?? 0;
    while (k < list.length && list[k][0] < inner) k += 1;
    reached.set(name, k);
    if (k === list.length) continue;
    const put = rewrite({ name, tag: html.slice(m.index, inner), inner: () => html.slice(inner, list[k][0]), whole: () => html.slice(m.index, list[k][1]) });
    if (put === null) continue;
    out.push(html.slice(kept, m.index), put);
    kept = list[k][1];
    open.lastIndex = kept;
  }
  return out.length === 0 ? html : [...out, html.slice(kept)].join('');
};
const afterName = (_html, at) => at;
const afterTag = (html, at) => html.indexOf('>', at) + 1 || -1;

// pure — every tag that `opens` finds (from there through the next `>`) replaced by `put`.
const cutTags = (html, opens, put) => {
  const out = [];
  let kept = 0;
  opens.lastIndex = 0;
  for (let m = opens.exec(html); m; m = opens.exec(html)) {
    const gt = html.indexOf('>', opens.lastIndex);
    if (gt === -1) break;
    out.push(html.slice(kept, m.index), put);
    kept = gt + 1;
    opens.lastIndex = kept;
  }
  return out.length === 0 ? html : [...out, html.slice(kept)].join('');
};

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
  const page = String(html);
  const open = /<title/i.exec(page);
  const from = open ? page.indexOf('>', open.index) + 1 : 0;
  const close = /<\/title>/gi;
  close.lastIndex = from;
  const end = from > 0 ? close.exec(page) : null;
  if (!end) return null;
  const title = decodeEntities(page.slice(from, end.index)).replace(/\s+/g, ' ').trim();
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
const CF_HEX = /\bdata-cfemail="([0-9a-f]+)"/i;
const CF_HREF = /\bhref="[^"]*\/cdn-cgi\/l\/email-protection#([0-9a-f]+)"/i;
const MAILTO_HREF = /\bhref="mailto:([^"?]+)[^"]*"/i;
const cfSpan = ({ tag }) => { const hex = CF_HEX.exec(tag); return hex ? cfDecode(hex[1]) : null; };
const cfLink = ({ tag, inner }) => {
  const hex = CF_HREF.exec(tag);
  const email = hex ? cfDecode(hex[1]) : null;
  if (!email) return null;
  return inner().includes(email) ? inner() : `${inner().replace(/\[email(?:&#160;|&nbsp;|\s)protected\]/gi, '')} ${email}`;
};
const mailto = ({ tag, inner, whole }) => {
  const address = MAILTO_HREF.exec(tag);
  if (!address) return null;
  const email = decodeURIComponentSafe(address[1]).trim();
  return inner().includes(email) ? whole() : `${inner()} (${email})`;
};

/** Put each address a page publishes outside its words back into them. Pure. */
export const revealAddresses = (html) => [['a|span', cfSpan], ['a', cfLink], ['a', mailto]]
  .reduce((page, [names, reveal]) => rewriteElements(page, names, afterTag, reveal), String(html));

const decodeURIComponentSafe = (v) => { try { return decodeURIComponent(v); } catch { return v; } };

/**
 * Turn an HTML document into bounded readable text. Pure.
 * @param {string} html
 * @param {number} [maxChars] - hard output cap (default sized to research reads)
 * @returns {string}
 */
export const htmlToText = (html, maxChars = 20_000) => {
  const withoutCode = revealAddresses(rewriteElements(String(html), DROPPED, afterName, () => ' '));
  const text = decodeEntities(cutTags(cutTags(withoutCode, BLOCK_TAG, '\n'), ANY_TAG, ' '));
  const lines = text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0);
  const out = lines.join('\n');
  return out.length > maxChars ? `${out.slice(0, maxChars)}\n[… truncated]` : out;
};
