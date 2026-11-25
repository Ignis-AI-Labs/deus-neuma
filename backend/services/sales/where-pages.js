// where-pages — the pages that say where a company is when its home, contact and about pages do not: its legal ones.
// A privacy policy, terms or imprint names the company's legal entity and the law it stands under ([…], "Cayman Islands", "Zug, Switzerland"). Found on the first sales bench (2026-11-21): three of
// six crypto funds screened a fit were filed COUNTRY TO FIND, and no email is written to a lead whose country is open.
// Asked only for a FIT whose country the first reading could not say. impure (the network).

const LEGAL = Object.freeze(['privacy', 'privacy-policy', 'terms', 'legal', 'imprint', 'disclosures', 'terms-of-use']);
const LINK = /href=["']([^"'#]*(?:privacy|terms|legal|imprint|impressum|disclos|disclaimer)[^"'#]*)(?:#[^"']*)?["']/gi;
export const LEGAL_PAGES_MAX = 2;

/** pure — the legal pages a home page links to (its own, absolute), then the usual addresses for them. */
export const legalUrls = (homeHtml, domain) => {
  const base = `https://${domain}/`;
  const linked = [...String(homeHtml ?? '').matchAll(LINK)].map((m) => { try { return new URL(m[1], base); } catch { return null; } })
    .filter((u) => u && /^https?:$/.test(u.protocol) && u.hostname.replace(/^www\./, '') === domain && !/\.pdf$/i.test(u.pathname)).map((u) => u.href);
  return [...new Set([...linked, ...LEGAL.map((p) => `${base}${p}`)])];
};

/**
 * The words of a company's legal pages (the first two that answer), or '' when it shows none.
 * @param {string} domain
 * @param {{fetchPage: Function, signal?: AbortSignal, homeHtml?: string, words: (html: string) => string}} opts
 */
export const readLegalPages = async (domain, { fetchPage, signal, homeHtml = '', words }) => {
  const read = [];
  for (const url of legalUrls(homeHtml, domain).slice(0, 6)) {
    if (read.length >= LEGAL_PAGES_MAX || signal?.aborted) break;
    const page = await fetchPage(url, { signal }).catch(() => null);
    const text = page?.ok ? words(page.html) : '';
    if (text.length >= 200) read.push(text.slice(0, 6000));
  }
  return read.join('\n\n');
};
