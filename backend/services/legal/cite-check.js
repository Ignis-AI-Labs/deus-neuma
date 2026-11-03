// CITE CHECK — the platform re-reads every source the legal office cites,
// itself, before a reading lands and before an answer leaves the office.
//
// The office had been told to re-read every passage it cites, and an answer
// still carried a sentence its source never printed (citation-record.js says
// why). An instruction is not a check. This is the check: the same guarded
// page reader the office's web_fetch uses opens each record's sourceUrl; the
// heading the office says the provision carries must be printed there AS a
// heading, and every quoted word must be on the page. Each fetch is journaled
// like any web read, and the web access switch holds it like any web read.
//
// What it proves, mechanically: the source answers; it prints the heading the
// office named; it holds every quoted word, in order. What it cannot prove:
// that the quote sits at the pin cite, that it supports the claim, or that
// nothing newer exists. Those stay the office's reading, and the result says
// so on every run.

import { fetchWebPage } from '../web-fetch.js';
import { journalWebCall } from '../web-being-tools.js';
import { webSettings } from '../web-settings.js';
import { squeeze, quoteSegments, holdsInOrder, locate } from './citation-record.js';

const PARALLEL = 4;

export const NOT_CHECKED = 'Not checked by the platform: that each quote sits at its pin cite, that it supports its claim, and that nothing newer exists. Those are the office\'s own reading — each row\'s claim is shown so a reader can judge it.';

export const WEB_OFF = 'Web access is OFF, so the platform cannot re-read the sources, and nothing that rests on them can land. Ask the operator to turn web access on (SETTINGS → WEB ACCESS), or settle needs_operator and say what could not be read.';

const LABELS = Object.freeze({
  verified: 'VERIFIED',
  'quote-missing': 'QUOTE NOT IN SOURCE',
  'heading-missing': 'HEADING NOT IN SOURCE',
  cut: 'NOT IN THE PART READ',
  unread: 'SOURCE UNREAD',
});

const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);

// A heading is printed AS a heading: in the page's title, or on a short run of
// lines that is mostly the heading (a title wrapped over two or three lines
// counts; so does a number or label beside it). A phrase somewhere inside a
// paragraph is not the provision's heading.
const HEADING_LINES = 3;
const headingSlack = (length) => Math.max(20, Math.floor(length / 2));

/** Does the page print this heading as a heading? Pure. */
export const printsHeading = (page, heading) => {
  const h = squeeze(heading);
  if (!h || !page?.ok) return false;
  if (squeeze(page.title).includes(h)) return true;
  const lines = String(page.text ?? '').split('\n').map(squeeze);
  for (let i = 0; i < lines.length; i += 1) {
    let run = '';
    for (let j = i; j < Math.min(i + HEADING_LINES, lines.length); j += 1) {
      run += lines[j];
      if (run.length > h.length + headingSlack(h.length)) break;
      if (run.includes(h)) return true;
    }
  }
  return false;
};

/**
 * One record judged against the page read for it — and, for a PDF read by
 * page, its first page, where a document prints its title. Pure.
 * @param {Object} record a valid citation record
 * @param {{ok: boolean, title?: string|null, text?: string, truncated?: boolean, error?: string}} page
 * @param {Object|null} [titlePage]
 * @returns {{verdict: string, note: string}}
 */
export const judgeRecord = (record, page, titlePage = null) => {
  if (!page?.ok) return { verdict: 'unread', note: `the source did not answer (${page?.error || 'no answer'}) — a citation nobody could read cannot carry a reading` };
  const headingFound = printsHeading(page, record.heading) || printsHeading(titlePage, record.heading);
  const hasQuote = typeof record.quote === 'string' && record.quote.trim() !== '';
  const quoteFound = !hasQuote || holdsInOrder(squeeze(`${page.title ?? ''}\n${page.text ?? ''}`), quoteSegments(record.quote));
  if (headingFound && quoteFound) return { verdict: 'verified', note: hasQuote ? 'heading and every quoted word found' : 'heading found (paraphrase — no quote)' };
  if (page.truncated) {
    return { verdict: 'cut', note: 'the page is longer than the check reads and the words were not in the part read — cite the provision\'s own address, or the PDF page in pages' };
  }
  if (!quoteFound) {
    return { verdict: 'quote-missing', note: `these words are not on the page: "${clip(record.quote.trim(), 160)}"${headingFound ? '' : ` (nor is the heading "${record.heading.trim()}")`} — quote only what you copied from it` };
  }
  return { verdict: 'heading-missing', note: `the page does not print "${record.heading.trim()}" as a heading — a cite is the heading you read, not the number you remember` };
};

const PASSAGE_BEFORE = 600;
const PASSAGE_AFTER = 1800;

/**
 * The source's own words a verified record rests on — around its quote, or
 * following its heading — for the second reader. Pure; '' when not found.
 */
export const passageFor = (record, page) => {
  const text = String(page?.text ?? '');
  const first = typeof record.quote === 'string' ? quoteSegments(record.quote)[0] : null;
  const spot = (first && locate(text, first)) || locate(text, squeeze(record.heading));
  if (!spot) return '';
  const from = Math.max(0, spot.start - (first ? PASSAGE_BEFORE : 0));
  return spot.decoded.slice(from, spot.end + PASSAGE_AFTER).replace(/[ \t]+/g, ' ').trim();
};

/** The check's rows as the office reads them. Pure. */
const citeCheckText = ({ rows, sources, checkedAt }) => {
  const passed = rows.filter((r) => r.verdict === 'verified').length;
  return [
    `CITATION CHECK — the platform re-read ${sources} source(s) for ${rows.length} citation(s) at ${checkedAt}: ${passed} verified, ${rows.length - passed} failed.`,
    ...rows.map((r) => `${r.n}. ${LABELS[r.verdict]} · ${r.record.authority.trim()}, ${r.record.pinCite.trim()} · ${r.record.sourceUrl.trim()}\n   claim: ${clip(r.record.claim.trim(), 160)}\n   ${r.note}`),
    rows.length === passed ? 'Every citation stands on its source.' : 'Nothing that rests on a failed row may reach the operator: fix the record from the source, or remove the claim.',
    NOT_CHECKED,
  ].join('\n');
};

// pure — the fetch key: one read per address and page range.
const pagesOf = (record) => (record.pages === undefined || record.pages === null ? '' : String(record.pages).trim());
const sourceKey = (record) => `${record.sourceUrl.trim()}#${pagesOf(record)}`;
const isPdfRead = (page) => page?.ok === true && /^PDF, /.test(String(page.title ?? ''));

// impure — every distinct read, a few at a time, each journaled like a web read.
const readAll = async (reads, connection) => {
  const out = new Map();
  for (let i = 0; i < reads.length; i += PARALLEL) {
    await Promise.all(reads.slice(i, i + PARALLEL).map(async ({ key, url, pages }) => {
      const page = await fetchWebPage(url, { pdf: { pages: pages || null } }).catch((err) => ({ ok: false, error: err.message }));
      await journalWebCall(connection, 'legal/legal_cite_check', url.slice(0, 200), page.ok ? 'ok' : 'error');
      out.set(key, page);
    }));
  }
  return out;
};

/**
 * impure — re-read every source and judge every record. Records must already
 * pass citationRecordsProblem. Refuses (ok false, refused true) while web
 * access is off.
 * @param {Array<Object>} records
 * @param {{connection: Object}} ctx the filing connection (its lane's journal records each read)
 * @returns {Promise<{ok: boolean, refused?: boolean, checkedAt: string, rows: Array<Object>, sources: number, text: string, summary: string}>}
 */
export const runCiteCheck = async (records, { connection }) => {
  const checkedAt = new Date().toISOString();
  if (!(await webSettings.isEnabled())) {
    return { ok: false, refused: true, checkedAt, rows: [], sources: 0, text: WEB_OFF, summary: 'citation check refused: web access is off' };
  }
  const unique = (list) => [...new Map(list.map((r) => [r.key, r])).values()];
  const pages = await readAll(unique(records.map((r) => ({ key: sourceKey(r), url: r.sourceUrl.trim(), pages: pagesOf(r) }))), connection);
  // A PDF read by page shows only that page; the document's title is on its first.
  const titleReads = unique(records
    .filter((r) => pagesOf(r) && pagesOf(r) !== '1' && isPdfRead(pages.get(sourceKey(r))))
    .map((r) => ({ key: `${r.sourceUrl.trim()}#1`, url: r.sourceUrl.trim(), pages: '1' })));
  const titles = await readAll(titleReads, connection);
  const rows = records.map((record, i) => ({
    n: i + 1, record,
    ...judgeRecord(record, pages.get(sourceKey(record)), pagesOf(record) ? titles.get(`${record.sourceUrl.trim()}#1`) ?? null : null),
  })).map((row) => (row.verdict === 'verified' ? { ...row, passage: passageFor(row.record, pages.get(sourceKey(row.record))) } : row));
  const failed = rows.filter((r) => r.verdict !== 'verified').length;
  const sources = new Set(records.map((r) => r.sourceUrl.trim())).size;
  return {
    ok: failed === 0, checkedAt, rows, sources,
    text: citeCheckText({ rows, sources, checkedAt }),
    summary: failed ? `citation check: ${failed} of ${rows.length} failed` : `citation check: all ${rows.length} verified`,
  };
};
