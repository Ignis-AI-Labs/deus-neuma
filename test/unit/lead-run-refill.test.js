// The refill plan (backend/services/sales/lead-run-refill.js): what a run gathers by itself before it begins.
// RULE 0: the real module, real shapes; nothing mocked.
import { describe, expect, it } from 'vitest';
import { refillPlan, REFILL_MARGIN } from '../../backend/services/sales/lead-run-refill.js';

const S = 's-1';
const search = (source, asked, matched, gathered, at, segmentId = S) => ({ segmentId, source, asked, matched, gathered, at });
const yields = (rows) => new Map(rows.map(([source, fit, scored]) => [source, { fit, scored, rate: scored ? fit / scored : 0 }]));

describe('what a run gathers before it begins', () => {
  it('gathers nothing while enough companies wait', () => {
    expect(refillPlan({ segmentId: S, want: 10, waiting: 10 * REFILL_MARGIN, yields: new Map(), searches: [] })).toEqual({ gather: null, why: '120 companies wait to be screened, enough for 10 lead(s)' });
  });

  it('continues the provider search that brought companies, in its own words, from the source with the best record', () => {
    const searches = [
      search('apollo-discover', 'token, crypto', 42223, 0, '2026-11-23T09:34:00Z'), // too wide: never repeated
      search('apollo-discover', 'defi protocol, decentralized exchange', 319, 319, '2026-11-24T04:58:00Z'),
      search('base-protocols', '', 0, 26, '2026-11-23T10:04:00Z'),
      search('apollo-discover', 'another audience', 200, 90, '2026-11-24T05:00:00Z', 's-2'),
    ];
    const plan = refillPlan({ segmentId: S, want: 25, waiting: 40, yields: yields([['apollo-discover', 13, 71], ['base-protocols', 14, 21]]), searches });
    // The list has the better record (14 of 21): it is gathered again, and takes no words.
    expect(plan.gather).toEqual({ source: 'base-protocols', count: 260 });
    expect(plan.why).toBe('only 40 companies wait; base-protocols is gathered again (14 of the 21 screened from it were a fit)');
    const paid = refillPlan({ segmentId: S, want: 25, waiting: 40, yields: yields([['apollo-discover', 13, 71], ['base-protocols', 1, 40]]), searches });
    expect(paid.gather).toEqual({ source: 'apollo-discover', keywords: ['defi protocol', 'decentralized exchange'], count: 260 });
    expect(paid.why).toMatch(/^only 40 companies wait; the apollo-discover search "defi protocol, decentralized exchange" is continued \(13 of the 71 screened/);
  });

  it('a source with too few screened is not judged by them; one that gave nothing is not repeated', () => {
    const searches = [search('apollo-discover', 'layer 2 blockchain', 400, 100, '2026-11-24T05:00:00Z')];
    expect(refillPlan({ segmentId: S, want: 10, waiting: 0, yields: yields([['apollo-discover', 0, 4]]), searches }).gather).toMatchObject({ source: 'apollo-discover', keywords: ['layer 2 blockchain'], count: 120 });
    expect(refillPlan({ segmentId: S, want: 10, waiting: 0, yields: yields([['apollo-discover', 0, 60]]), searches })).toEqual({ gather: null, why: 'every source this audience gathered from has given no fit (apollo-discover): repeating one would bring more of the same — gather with other words' });
  });

  it('never invents a search: an audience with no search that brought companies is left as it is', () => {
    const searches = [search('apollo-discover', 'token', 42223, 0, '2026-11-23T09:34:00Z'), search('hunter-discover', 'crypto companies', 900, 300, '2026-11-20T09:00:00Z')];
    expect(refillPlan({ segmentId: S, want: 10, waiting: 3, yields: new Map(), searches }).gather).toBeNull();
    expect(refillPlan({ segmentId: S, want: 10, waiting: 3, yields: new Map(), searches }).why).toMatch(/^no search of this audience has brought companies yet/);
  });
});
