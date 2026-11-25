// SEARCH MEMORY — what the house already asked a paid company search, so it never pays for the same answer twice.
//
// Found on the sales bench (2026-11-22): the house had run 86 searches at one provider, and every one began again at
// page ONE. Its crypto-fund searches match between 800 and 1,600 funds and it held about 650 of them, so a new search
// paid for a page of 94 companies of which it already held all 94. The same records hold a search that matched
// nothing and still cost a credit, and searches worded slightly differently that brought the same companies back.
// So, before a credit is spent, the house reads what this audience already asked this source in these words:
//   it matched NOTHING            → refused, free: the words are wrong, and asking again costs the same credit
//   it was TOO WIDE               → refused, free (wide-search.js says why a wide search keeps nothing)
//   every page was already taken  → refused, free: the house holds all it returns
//   otherwise                     → it CONTINUES from the page after the last one taken
// The same search is the same source, the same audience and the same terms in any order and any capitals. PURE.

import { isWide } from './wide-search.js';

const terms = (asked) => [...new Set(String(asked ?? '').toLowerCase().split(',').map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean))].sort();
/** pure — one search's identity: its audience, its source and its terms, whatever their order. */
export const searchKey = ({ segmentId, source, asked }) => `${segmentId}|${source}|${terms(asked).join(',')}`;

/**
 * pure — what stands on record for this search.
 * @param {Array<{segmentId, source, asked, matched, gathered, spent, pages?, at}>} searches - every search of the house
 * @param {{segmentId: string, source: string, asked: string}} search
 * @returns {{runs: number, pages: number, matched: number, gathered: number, spent: number, last: ?object}}
 *   pages: how many result pages were taken in all (a search recorded before pages were kept took one a credit)
 */
export const searchPast = (searches, search) => {
  const key = searchKey(search);
  const mine = (searches ?? []).filter((s) => searchKey(s) === key).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const last = mine.at(-1) ?? null;
  return { runs: mine.length, pages: mine.reduce((n, s) => n + (Number(s.pages) || Number(s.spent) || 0), 0), matched: Number(last?.matched) || 0,
    gathered: mine.reduce((n, s) => n + (Number(s.gathered) || 0), 0), spent: mine.reduce((n, s) => n + (Number(s.spent) || 0), 0), last };
};

const day = (iso) => String(iso ?? '').slice(0, 10);
/**
 * pure — whether this search may be paid for again, and from which page.
 * @param {object} past - searchPast's answer
 * @param {{perPage: number, resumes?: boolean}} source - resumes: the provider can be asked for a later page directly
 * @returns {{refusal: string} | {startPage: number, words: ?string}}
 */
export const searchVerdict = (past, { perPage, resumes = false }) => {
  if (!past.runs || !past.last) return { startPage: 1, words: null };
  const paid = `${past.spent} credit(s) so far`;
  if (past.last.spent > 0 && !past.matched) return { refusal: `this exact search matched NOTHING when it was run on ${day(past.last.at)} (${paid}) — asking again costs the same credit and brings the same nothing. Change the words: fewer of them, and what the companies call themselves` };
  if (isWide(past.matched)) return { refusal: `this exact search matched ${past.matched.toLocaleString('en-US')} companies on ${day(past.last.at)} — too wide to be this audience, and it kept nothing (${paid}). Narrow it before it is paid for again` };
  const pagesInAll = Math.max(1, Math.ceil(past.matched / perPage));
  if (past.pages >= pagesInAll) return { refusal: `every page of this search has been taken (${past.pages} of ${pagesInAll}; it matches ${past.matched.toLocaleString('en-US')} companies and brought the house ${past.gathered.toLocaleString('en-US')}, ${paid}) — the house holds all it returns. Search other words, or gather from the companies your fits themselves name (sales/gather {source: "from-fits"})` };
  if (!resumes) return { startPage: 1, words: null };
  return { startPage: past.pages + 1, words: `continued from page ${past.pages + 1} of ${pagesInAll}: pages 1 to ${past.pages} were taken before` };
};
