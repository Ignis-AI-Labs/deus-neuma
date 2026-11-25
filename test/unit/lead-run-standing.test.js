// WHERE EACH AUDIENCE STANDS FOR A RUN, AND ITS ONE NEXT STEP (backend/services/sales/lead-run-standing.js,
// frontend company-line/RunStanding.jsx) — Design note, 2026-11-21, after a run ended at 9 leads from 487 companies screened:
// […]. Pure judging; the sheet through a real server render.
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { audienceStanding, sourceWords, REWORD_AFTER, REWORD_BELOW } from '../../backend/services/sales/lead-run-standing.js';
import { RunStanding } from '../../frontend/app/RelinkShell/company-line/RunStanding.jsx';

const segment = { id: 's-1', name: 'Teams needing local AI', campaign: 'k-1', positiveCriteria: ['Running centralized AI and wanting it on their own machine', 'Small team'] };
const cand = (source, domain, extra = {}) => ({ source, domain, segmentId: 's-1', state: 'waiting', ...extra });
const scored = (domain, first, extra = {}) => ({ domain, segmentId: 's-1', stage: 'found', match: first >= 3 ? 3 : 1, fit: [{ criterion: 'c', score: first }], ...extra });
const many = (count, make) => Array.from({ length: count }, (_, i) => make(i));
const stand = (candidates, prospects, extra = {}) => audienceStanding({ segment, candidates, prospects, tooWide: new Set(), ...extra });

describe('one next step, in words', () => {
  it('FEW: almost nobody screened showed the first sign — it says so, shows the last misses with why, and names both causes', () => {
    const candidates = [...many(100, (i) => cand('hunter-discover', `h${i}.example`, { state: 'scored' })), ...many(40, (i) => cand('hunter-discover', `w${i}.example`))];
    const prospects = many(100, (i) => ({ ...scored(`h${i}.example`, i < 3 ? 4 : 0), name: `Co ${i}`, scoredAt: `2026-11-21T08:${String(i % 60).padStart(2, '0')}:00Z`, fit: [{ criterion: 'c', score: i < 3 ? 4 : 0, reasoning: i < 3 ? 'it says so' : `a product company, not what this audience is (${i})` }] }));
    const s = stand(candidates, prospects);
    expect(s).toMatchObject({ waiting: 40, screened: 100, fit: 3, inHundred: 3, next: { kind: 'few' } });
    expect(s.next.words).toMatch(/^ONLY 3 OF 100 COMPANIES SCREENED SHOWED WHAT THIS AUDIENCE IS \(its first sign: "Running centralized AI and wanting it on their own machine"\)\. Read the last misses below/);
    expect(s.next.words).toContain('If they are THE WRONG KIND OF COMPANY, the searches are bringing the wrong companies: have your sales member gather narrower, by what the audience IS, and expect the 40 still waiting to miss the same way.');
    expect(s.next.words).toContain('the sign is a wish or a need no website states: change it to something a page shows');
    // The newest misses first, each with the screener's own reason; never a company that was a fit.
    expect(s.misses).toHaveLength(8);
    expect(s.misses[0]).toEqual({ domain: 'h59.example', name: 'Co 59', why: 'a product company, not what this audience is (59)' });
    expect(s.misses.every((m) => /^a product company/.test(m.why))).toBe(true);
    expect([REWORD_AFTER, REWORD_BELOW]).toEqual([50, 0.08]);
    // Too few screened to judge: it is not called poor on a handful, and no misses are listed.
    expect(stand(many(10, (i) => cand('hunter-discover', `h${i}.example`)), many(10, (i) => scored(`h${i}.example`, 0)))).toMatchObject({ misses: [], next: { kind: 'run' } });
  });

  it('RUN: companies wait — how many, and the source that has given the most fits', () => {
    const candidates = [...many(20, (i) => cand('apollo-discover', `a${i}.example`, { state: 'scored' })), ...many(1343, (i) => cand('apollo-discover', `aw${i}.example`)),
      ...many(30, (i) => cand('hunter-discover', `h${i}.example`, { state: 'scored' })), cand('hunter-discover', 'dead.example', { siteRead: { alive: false } }), cand('hunter-discover', 'passed.example', { shortlist: 'passed' })];
    const prospects = [...many(20, (i) => scored(`a${i}.example`, i < 8 ? 5 : 0, i < 2 ? { stage: 'promoted' } : {})), ...many(30, (i) => scored(`h${i}.example`, i < 1 ? 4 : 0))];
    const s = stand(candidates, prospects);
    expect(s).toMatchObject({ waiting: 1343, screened: 50, fit: 9, inHundred: 18, leads: 2, fitsWaiting: 7, next: { kind: 'run', words: 'START A RUN: 1,343 gathered companies wait to be screened (0 of them look likely from what was gathered about them, and are read first) and 7 fits wait for a person. Best source so far: Apollo search (8 of 20 a fit); it is worked first.' } });
    expect(s.sources.map((x) => [x.name, x.waiting, x.scored, x.fit])).toEqual([['Apollo search', 1343, 20, 8], ['Hunter search', 0, 30, 1]]);
    expect(stand(candidates, prospects, { running: true }).next).toEqual({ kind: 'running', words: 'A RUN IS WORKING THIS AUDIENCE NOW.' });
    // A company from a too-wide search does not count as waiting.
    expect(audienceStanding({ segment, candidates: [cand('apollo-discover', 'big.example')], prospects: [], tooWide: new Set(['big.example']) }).waiting).toBe(0);
  });

  it('GATHER: nothing waits — gather first, with what worked named; an audience nothing was gathered for says so', () => {
    const candidates = many(20, (i) => cand('company-index', `c${i}.example`, { state: 'scored' }));
    const s = stand(candidates, many(20, (i) => scored(`c${i}.example`, i < 6 ? 5 : 0, { stage: i < 6 ? 'promoted' : 'dropped' })));
    expect(s.next).toEqual({ kind: 'gather', words: 'NOTHING WAITS TO BE SCREENED. Your sales member gathers more companies for this audience first (DISCOVER), then you start a run. Searches like the ones through the company index worked best (6 of 20 a fit).' });
    expect(stand([], []).next.words).toBe('NOTHING WAITS TO BE SCREENED. Your sales member gathers more companies for this audience first (DISCOVER), then you start a run. Nothing has been gathered for it yet.');
    expect([sourceWords('hunter-discover'), sourceWords('something-new')]).toEqual(['Hunter search', 'something-new']);
  });
});

describe('on the desk', () => {
  it('one audience a line with its next step; none in view draws nothing', () => {
    const rows = [
      { id: 's-1', name: 'Teams needing local AI', firstSign: 'wanting it on their own machine', waiting: 99, likely: 12, screened: 704, fit: 41, inHundred: 5.8, leads: 24, sources: [{ source: 'hunter-discover', name: 'Hunter search', waiting: 96, scored: 526, fit: 13 }], misses: [{ domain: 'salucro.com', name: 'Salucro', why: 'The page does not show any desire to move AI to their own machine.' }], next: { kind: 'few', words: 'ONLY 41 OF 704 …' } },
      { id: 's-2', name: 'AI infra funds', firstSign: 'invests in AI', waiting: 1583, likely: 261, screened: 1113, fit: 124, inHundred: 11.1, leads: 110, sources: [], next: { kind: 'run', words: 'START A RUN: …' } },
    ];
    const html = renderToStaticMarkup(createElement(RunStanding, { audiences: rows }));
    expect(html).toContain('aria-label="where each audience stands"');
    expect(html).toMatch(/data-run-standing="s-1" data-run-next="few">.*<td>99<\/td><td[^>]*>12<\/td><td>704<\/td><td>41<\/td><td class="is-alert">5\.8<\/td><td>24<\/td><td[^>]*>[^<]*<\/td><td class="is-alert">FEW ARE A FIT — SEE WHY<\/td>/);
    expect(html).toMatch(/data-run-standing="s-2" data-run-next="run">.*<td>1,583<\/td><td[^>]*>261<\/td><td>1,113<\/td><td>124<\/td><td>11\.1<\/td><td>110<\/td><td[^>]*>[^<]*<\/td><td class="is-on">START A RUN<\/td>/);
    expect(html).toContain('aria-label="Teams needing local AI — what to do next, and why"');
    expect(renderToStaticMarkup(createElement(RunStanding, { audiences: [] }))).toBe('');
  });
});

describe('the sales member is woken to carry on when the house\'s own work ends', () => {
  it('a run that ended, and a gather that ended, each say what happened and the next step', async () => {
    const { wakeThought } = await import('../../backend/services/house-clock/wake-thought.js');
    const { wakeReasonWords } = await import('../../backend/services/staff/wake-activity.js');
    const words = wakeThought({ charter: {}, items: [
      { reason: 'lead-run-ended', ref: 'run-1', detail: { segment: 'Ecosystem Funds', segmentId: 's-1', ended: 'it reached the number asked for', leads: 50 } },
      { reason: 'gather-ended', ref: 'gather-1', detail: { segment: 'Token projects', segmentId: 's-2', source: 'Base protocols list', words: '60 new candidate(s)' } },
    ] });
    expect(words).toContain('Your lead run for "Ecosystem Funds" ended: it reached the number asked for. It filed 50 lead(s). NOW: (1) sales/run {status: true} — where every audience stands and its next step; (2) the run itself researched each new lead and staged its first email for your operator (0 staged); 0 it could not write are yours: their research card, then their first email (sales/pipeline lists them by id); then sales/review {segment} and fix every MUST it names;');
    expect(words).toContain('Your gather from Base protocols list for "Token projects" ended: 60 new candidate(s). If companies now wait for that audience, start its lead run (sales/run {segment: "s-2"}).');
    expect([wakeReasonWords('lead-run-ended'), wakeReasonWords('gather-ended')]).toEqual(['a lead run ended', 'a gather ended']);
  });
});
