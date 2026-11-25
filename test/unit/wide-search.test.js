// A SEARCH TOO WIDE TO BE AN AUDIENCE'S (sales/wide-search.js). Design note, 2026-11-21: a search with loose words matched
// 118,423 companies and its first 1,327 — the ones with the most addresses: Dentsu, IBM, Freddie Mac — were kept under
// an audience of crypto funds. […] Pure.
import { describe, it, expect } from 'vitest';
import { WIDE_MATCH, isWide, wideRefusal, wideLookWords, wideFinds, untouched, wideSummary } from '../../backend/services/sales/wide-search.js';

const search = (segmentId, source, matched, gathered, at, asked = 'words') => ({ segmentId, source, matched, gathered, at, asked });
const co = (domain, segmentId, source, gatheredAt, extra = {}) => ({ domain, segmentId, source, gatheredAt, state: 'waiting', ...extra });

describe('how wide is too wide', () => {
  it('more than ten thousand matches is not an audience; a source that reports no count is never judged', () => {
    expect(WIDE_MATCH).toBe(10_000);
    // The house's own record: the searches that found the audience, and the ones that did not.
    expect([120, 795, 1598, 4570, 10_000].map(isWide)).toEqual([false, false, false, false, false]);
    expect([10_001, 27_602, 59_388, 118_423, 2_773_856].map(isWide)).toEqual([true, true, true, true, true]);
    expect([0, null, undefined].map(isWide)).toEqual([false, false, false]);
  });

  it('the seat is told the count, that nothing was kept, what a credit bought, and how to narrow', () => {
    const said = wideRefusal({ matched: 118423, source: 'hunter-discover' });
    expect(said).toMatch(/^That search matched 118,423 companies at hunter-discover — more than 10,000 is not this audience/);
    expect(said).toContain('NOTHING WAS KEPT.');
    expect(said).toContain('never single common words like "base", "token" or "fund" alone');
    expect(wideRefusal({ matched: 59388, source: 'apollo-discover', spent: 1 })).toContain('NOTHING WAS KEPT (1 credit(s) spent on the look).');
    expect(wideLookWords(301822)).toMatch(/^TOO WIDE: 301,822 matches is more than 10,000 — a gather with these fields keeps nothing/);
    expect(wideLookWords(4570)).toBeNull();
  });
});

describe('what the too-wide searches brought in', () => {
  // One audience, one source: a good search, then a wide one, then another good one; and a wide one elsewhere.
  const searches = [
    search('s-fund', 'hunter-discover', 4570, 2, '2026-11-17T10:00:10Z'),
    search('s-fund', 'hunter-discover', 118423, 3, '2026-11-17T18:11:35Z', 'keywords (any): token, base, liquidity'),
    search('s-fund', 'hunter-discover', 1735, 1, '2026-11-18T09:00:10Z'),
    search('s-fund', 'apollo-discover', 59388, 1, '2026-11-20T16:57:14Z'),
    search('s-ua', 'hunter-discover', 301822, 0, '2026-11-17T18:00:23Z'), // wide, and kept nothing
  ];
  const candidates = [
    co('goodfund.vc', 's-fund', 'hunter-discover', '2026-11-17T10:00:01Z'), co('seedfund.vc', 's-fund', 'hunter-discover', '2026-11-17T10:00:02Z'),
    co('dentsu.com', 's-fund', 'hunter-discover', '2026-11-17T18:11:30Z'), co('freddiemac.com', 's-fund', 'hunter-discover', '2026-11-17T18:11:31Z', { shortlist: 'kept' }),
    co('jetaviation.com', 's-fund', 'hunter-discover', '2026-11-17T18:11:32Z', { siteRead: { alive: true } }),
    co('laterfund.vc', 's-fund', 'hunter-discover', '2026-11-18T09:00:01Z'),
    co('bigbank.com', 's-fund', 'apollo-discover', '2026-11-20T16:57:10Z', { state: 'scored' }),
    co('ibm.net', 's-ua', 'hunter-discover', '2026-11-17T17:00:00Z'),
  ];

  it('each wide search with the companies gathered for its audience from its source since the search before it', () => {
    const finds = wideFinds(searches, candidates);
    expect(finds.map((f) => [f.search.source, f.search.matched, f.companies.map((c) => c.domain)])).toEqual([
      ['hunter-discover', 118423, ['dentsu.com', 'freddiemac.com', 'jetaviation.com']],
      ['apollo-discover', 59388, ['bigbank.com']],
    ]);
  });

  it('only what nobody has worked is passed over: not one kept, read or scored', () => {
    expect(wideFinds(searches, candidates).flatMap((f) => f.companies).filter(untouched).map((c) => c.domain)).toEqual(['dentsu.com']);
    expect(wideSummary(searches, candidates)).toEqual({ searches: 2, companies: 4, left: 1, limit: 10_000 });
    expect(wideSummary([], [])).toEqual({ searches: 0, companies: 0, left: 0, limit: 10_000 });
  });
});
