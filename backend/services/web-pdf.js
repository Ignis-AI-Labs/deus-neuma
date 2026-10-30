// WEB PDF — a PDF on the web reads like a page: its text, page by page.
//
// Much of the law the house reads is published only as PDF: whole statute
// titles (Wyoming), court opinions, regulators' guidance, the Copyright
// Office's reports. A whole title runs to hundreds of pages, so a reader asks
// for what it needs: `find` keeps only the pages holding a phrase (a section
// number, a defined term), `pages` takes a range. The answer always says how
// many pages the document has and which ones it shows.

/** Past this a web PDF is refused rather than read. */
export const MAX_WEB_PDF_BYTES = 25 * 1024 * 1024;

/** Is this response a PDF? Pure. */
export const isPdfResponse = (contentType, url) => {
  const type = String(contentType || '').toLowerCase().split(';')[0].trim();
  return type === 'application/pdf'
    || (type === 'application/octet-stream' && /\.pdf(?:$|[?#])/i.test(String(url || '')));
};

// pure — "12" or "12-20" (1-based, inclusive), clamped to the document; null when not a range
export const parseRange = (spec, total) => {
  const m = String(spec ?? '').trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
  if (!m) return null;
  const from = Math.max(1, Number(m[1]));
  const to = Math.min(total, Number(m[2] ?? m[1]));
  return from <= to ? [from, to] : null;
};

/**
 * The pages a reader asked for, as text. Pure.
 * @param {string[]} pages one entry per page
 * @param {{pages?: string, find?: string}} ask
 * @returns {{text: string, note: string, shown: number[]}}
 */
export const selectPdfPages = (pages, { pages: range = null, find = null } = {}) => {
  const total = pages.length;
  let shown = pages.map((_, i) => i + 1);
  let note = `PDF, ${total} page${total === 1 ? '' : 's'}`;
  const span = range ? parseRange(range, total) : null;
  if (range && !span) note += `; pages "${range}" is not a range in 1-${total}, so all pages are shown`;
  if (span) {
    shown = shown.filter((n) => n >= span[0] && n <= span[1]);
    note += `; showing pages ${span[0]}-${span[1]}`;
  }
  const needle = typeof find === 'string' ? find.trim().toLowerCase() : '';
  if (needle) {
    const hits = shown.filter((n) => pages[n - 1].toLowerCase().includes(needle));
    note += hits.length
      ? `; pages containing "${find.trim()}": ${hits.join(', ')}`
      : `; no page contains "${find.trim()}" — showing none (try another spelling, or ask for a page range)`;
    shown = hits;
  }
  if (!range && !needle && total > 1) note += '; ask with {find} (a section number, a term) or {pages: "N-M"} to read only what you need';
  return { text: shown.map((n) => `[Page ${n}]\n${pages[n - 1]}`).join('\n\n'), note, shown };
};
