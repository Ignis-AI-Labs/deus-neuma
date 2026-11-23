/**
 * SEARCH MEMORY (sales/search-memory.js) — found on the sales bench: 86 paid company searches, each begun again at
 * page one, so a new search paid for a page of companies the house already held; and searches that matched nothing
 * paid for again. Pure: the searches are the records the store keeps.
 */
import { describe, test, expect } from 'vitest';
import { searchKey, searchPast, searchVerdict } from '../../backend/services/sales/search-memory.js';
import { apolloAsked } from '../../backend/services/sales/company-search.js';

const at = (d) => `2026-11-${String(d).padStart(2, '0')}T10:00:00.000Z`;
const run = (o) => ({ segmentId: 's-1', source: 'apollo-discover', asked: 'crypto fund, web3 fund', matched: 795, gathered: 205, spent: 5, pages: null, at: at(19), ...o });
const ask = { segmentId: 's-1', source: 'apollo-discover', asked: 'Web3 Fund,  crypto fund' };
const apollo = { perPage: 100, resumes: true };

describe('search memory', () => {
  test('the same search is the same audience, source and terms, in any order and any capitals', () => {
    expect(searchKey(ask)).toBe(searchKey(run({})));
    expect(searchKey({ ...ask, asked: 'crypto fund' })).not.toBe(searchKey(run({})));
    expect(searchKey({ ...ask, segmentId: 's-2' })).not.toBe(searchKey(run({})));
    expect(apolloAsked({ keywords: ['crypto fund'], industries: ['venture capital'] })).toBe('crypto fund, venture capital');
  });

  test('never asked: it starts at page one; asked before: it continues after the last page taken', () => {
    expect(searchVerdict(searchPast([], ask), apollo)).toEqual({ startPage: 1, words: null });
    // Five pages taken before pages were kept on the record: a credit a page.
    const past = searchPast([run({})], ask);
    expect(past).toMatchObject({ runs: 1, pages: 5, matched: 795, gathered: 205, spent: 5 });
    expect(searchVerdict(past, apollo)).toEqual({ startPage: 6, words: 'continued from page 6 of 8: pages 1 to 5 were taken before' });
    // And once more, with its pages on the record.
    expect(searchVerdict(searchPast([run({}), run({ pages: 2, fromPage: 6, spent: 2, gathered: 60, at: at(22) })], ask), apollo).startPage).toBe(8);
    // A provider that cannot be asked for a later page directly is asked from the first again.
    expect(searchVerdict(past, { perPage: 50 })).toEqual({ startPage: 1, words: null });
  });

  test('refused before a credit is spent: it matched nothing, it was too wide, or every page was taken', () => {
    expect(searchVerdict(searchPast([run({ matched: 0, gathered: 0, spent: 1 })], ask), apollo).refusal).toBe('this exact search matched NOTHING when it was run on 2026-11-19 (1 credit(s) so far) — asking again costs the same credit and brings the same nothing. Change the words: fewer of them, and what the companies call themselves');
    expect(searchVerdict(searchPast([run({ matched: 95677, gathered: 0, spent: 1 })], ask), apollo).refusal).toMatch(/^this exact search matched 95,677 companies on 2026-11-19 — too wide to be this audience, and it kept nothing \(1 credit\(s\) so far\)/);
    const done = searchVerdict(searchPast([run({}), run({ pages: 3, spent: 3, gathered: 40, at: at(22) })], ask), apollo);
    expect(done.refusal).toBe('every page of this search has been taken (8 of 8; it matches 795 companies and brought the house 245, 8 credit(s) so far) — the house holds all it returns. Search other words, or gather from the companies your fits themselves name (sales/gather {source: "from-fits"})');
    // A free look that matched nothing spent nothing: it is no reason to refuse.
    expect(searchVerdict(searchPast([run({ matched: 0, gathered: 0, spent: 0 })], ask), apollo)).toMatchObject({ startPage: 1 });
  });
});
