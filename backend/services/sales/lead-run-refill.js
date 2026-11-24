// THE REFILL — a run that finds too few companies waiting gathers more BY ITSELF before it begins, from the search
// that has worked best for its audience, so a campaign keeps flowing without anyone stepping in.
//
// Design note, 2026-11-24: […] Seen on the live house the day before: a daily run began on a pool that was thin, read 150 companies that
// were not its audience, and ended with […] — and waited for someone to do that.
//
// What it does: counts the companies of the audience still waiting to be screened. When there are fewer than
// REFILL_MARGIN for each lead wanted, it looks at what this audience has gathered before, by source: how many of each
// source's companies, once screened, were a fit. It takes the source with the best record and gathers from it again:
//   a provider's company search — the SAME words as the last search there that brought companies and was not too
//                                 wide; the house's search memory continues it from the next page, never page one
//   a free list                 — the list again (it only returns what the house does not hold)
// It never invents a search: an audience nobody has gathered for yet, or whose every search was too wide or empty, is
// left as it is and the run says so. The gather is the seat's own act, under the spending rule and the run's limit.
// The plan is PURE; the gather is the run's (lead-run.js).

import { isWide } from './wide-search.js';

export const REFILL_MARGIN = 12;      // companies waiting for each lead wanted, below which more are gathered
export const REFILL_MIN_SCREENED = 10; // screened companies of a source before its record is trusted
export const REFILL_MAX = 500;
// Sources a refill may ask again, and how: a provider search is repeated by its own words; a list takes none.
const BY_WORDS = new Set(['apollo-discover', 'tomba-discover']);
const LISTS = new Set(['base-protocols', 'base-tokens', 'from-fits']);

/**
 * pure — what to gather before a run, or why nothing is gathered.
 * @param {{segmentId: string, want: number, waiting: number, yields: Map<string, {scored: number, fit: number, rate: number}>, searches: object[]}} o
 *   waiting: companies of the audience still to be screened · yields: lead-run-shape.js sourceYield · searches: every search of the house
 * @returns {{gather: ?{source: string, keywords?: string[], count: number}, why: string}}
 */
export const refillPlan = ({ segmentId, want, waiting, yields, searches }) => {
  const floor = want * REFILL_MARGIN;
  if (waiting >= floor) return { gather: null, why: `${waiting} companies wait to be screened, enough for ${want} lead(s)` };
  const mine = (searches ?? []).filter((s) => s.segmentId === segmentId && (BY_WORDS.has(s.source) || LISTS.has(s.source)) && !isWide(s.matched) && Number(s.gathered) > 0)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  if (!mine.length) return { gather: null, why: 'no search of this audience has brought companies yet (or each was too wide): nothing is repeated by itself — gather once, with words that say what the company is' };
  const record = (source) => { const y = yields.get(source); return y && y.scored >= REFILL_MIN_SCREENED ? y.rate : null; };
  // The best record first; a source not yet judged comes after those with one, before one that has given nothing.
  const sources = [...new Set(mine.map((s) => s.source))].sort((a, b) => (record(b) ?? 0.0001) - (record(a) ?? 0.0001));
  const source = sources[0];
  if (record(source) === 0) return { gather: null, why: `every source this audience gathered from has given no fit (${sources.join(', ')}): repeating one would bring more of the same — gather with other words` };
  const last = mine.find((s) => s.source === source);
  const count = Math.min(REFILL_MAX, Math.max(100, floor - waiting));
  const y = yields.get(source);
  const said = y?.scored ? `${y.fit} of the ${y.scored} screened from it were a fit` : 'none of its companies are screened yet';
  if (LISTS.has(source)) return { gather: { source, count }, why: `only ${waiting} companies wait; ${source} is gathered again (${said})` };
  const keywords = String(last.asked ?? '').split(',').map((k) => k.trim()).filter(Boolean).slice(0, 12);
  if (!keywords.length) return { gather: null, why: `the last ${source} search kept no words to repeat` };
  return { gather: { source, keywords, count }, why: `only ${waiting} companies wait; the ${source} search "${keywords.join(', ')}" is continued (${said})` };
};
