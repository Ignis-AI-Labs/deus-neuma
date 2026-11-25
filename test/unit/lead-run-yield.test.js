// WHERE THE FITS COME FROM (backend/services/sales/lead-run-shape.js sourceYield) — a lead run works the source whose
// companies have been fits most often first. Found 2026-11-21 in the live records: one run looked at 1,200 companies,
// nearly all from a search that had brought product companies (4 in 100 a fit), while 1,343 from another source
// (28 in 100 a fit) waited untouched. Pure.
import { describe, it, expect } from 'vitest';
import { sourceYield, signWords, leanOf } from '../../backend/services/sales/lead-run-shape.js';

const cand = (source, domain, segmentId = 's-1') => ({ source, domain, segmentId });
const scored = (domain, first, segmentId = 's-1') => ({ domain, segmentId, match: first >= 3 ? 3 : 1, fit: [{ criterion: 'what it is', score: first }] });

describe('how each source\'s companies have screened, for one audience', () => {
  const candidates = [
    ...Array.from({ length: 10 }, (_, i) => cand('hunter-discover', `h${i}.example`)),
    ...Array.from({ length: 6 }, (_, i) => cand('apollo-discover', `a${i}.example`)),
    cand('company-index', 'c0.example'),
    cand('apollo-discover', 'other.example', 's-2'),
  ];
  const prospects = [
    ...Array.from({ length: 10 }, (_, i) => scored(`h${i}.example`, i === 0 ? 5 : 0)), // 1 of 10 a fit
    ...Array.from({ length: 4 }, (_, i) => scored(`a${i}.example`, i < 3 ? 4 : 1)),      // 3 of 4 a fit
    scored('other.example', 5, 's-2'),
    scored('h0.example', 5, 's-2'), // the same company scored for another audience counts for nothing here
  ];
  it('counts only this audience, and only a fit the page showed to be what the audience is', () => {
    const y = sourceYield(candidates, prospects, 's-1');
    expect(Object.fromEntries(y)).toEqual({
      'hunter-discover': { scored: 10, fit: 1, rate: 0.143 },
      'apollo-discover': { scored: 4, fit: 3, rate: 0.5 },
      'company-index': { scored: 0, fit: 0, rate: 0.25 },
    });
  });
  it('a source nothing was screened from yet is tried before one known to be poor, after one known to be good', () => {
    const y = sourceYield(candidates, prospects, 's-1');
    expect([...y.keys()].sort((a, b) => y.get(b).rate - y.get(a).rate)).toEqual(['apollo-discover', 'company-index', 'hunter-discover']);
    expect([...sourceYield([], [], 's-1')]).toEqual([]);
  });
});

describe('the likeliest first: what was gathered about a company', () => {
  const funds = { name: 'Ecosystem Funds & VCs Wanting a DLMM', positiveCriteria: ['Active crypto fund with a portfolio of DeFi or token projects'] };
  it('an audience is told apart by its first sign\'s words and its name\'s, less the common ones', () => {
    expect(signWords(funds)).toEqual(['crypto', 'fund', 'portfolio', 'defi', 'token', 'projects', 'ecosystem', 'funds', 'vcs', 'dlmm']);
    expect(signWords({})).toEqual([]);
  });
  it('a funding audience counts an investor\'s words; every audience counts words shared with its first sign', () => {
    const words = signWords(funds);
    expect(leanOf({ name: 'Mythos Capital', domain: 'mythos.capital', description: 'A crypto fund backing DeFi founders.' }, words, true)).toBe(4);
    expect(leanOf({ name: 'Q9', domain: 'q9capital.com' }, words, true)).toBe(2);                 // its address alone names what it is
    expect(leanOf({ name: 'Vercel', domain: 'vercel.com', description: 'Frontend cloud for developers.' }, words, true)).toBe(0);
    expect(leanOf({ name: 'Mythos Capital', domain: 'mythos.capital' }, words, false)).toBe(0);  // not a funding audience: an investor's words count for nothing
    expect(leanOf({ name: 'Acme', domain: 'acme.io', categories: ['DeFi', 'Token'] }, words, false)).toBe(2);
    expect(leanOf(null, words, true)).toBe(0);
  });
});
