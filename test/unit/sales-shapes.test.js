/**
 * The lead engine's pure shapes, with real inputs and real outputs (nothing to
 * mock): segments and their approval law, prospects and their scoring, the
 * do-not-contact list, the ledger's upkeep, and the fixed reply rules.
 */
import { describe, test, expect } from 'vitest';
import { makeSegment, foldSegments, judgeState } from '../../backend/services/sales/segment-shape.js';
import { makeProspect, normalizeDomain, matchLevel, foldProspects, poolRefusal } from '../../backend/services/sales/prospect-shape.js';
import { makeSuppression, suppressionMatcher } from '../../backend/services/sales/suppress-shape.js';
import { upkeepDue, MAX_TOUCHES } from '../../backend/services/sales/lead-upkeep.js';
import { isBounce, bouncedAddresses, asksToStop } from '../../backend/services/sales/reply-rules.js';
import { judgeCover, rampCap, DAILY_CAP } from '../../backend/services/sales/sales-cover.js';
import { makeSalesSheet, foldSalesFacts, judgeSheetReview, checkSalesEmail, SALES_DISCLOSURE } from '../../backend/services/sales/sales-facts.js';

const NOW = '2026-11-13T08:00:00.000Z';
const DAY = 86_400_000;
const base = {
  name: 'Non-developer founders', offer: 'One-to-one coaching to build your product with AI tools',
  customerProblem: 'They know what to build and cannot build it', targetRole: 'Founder',
  targetGeography: 'United States, United Kingdom', targetCompanySize: '1–10',
  positiveCriteria: ['Building a software product', 'Founder is not a developer'], negativeCriteria: ['Software agency'],
  exampleClients: ['Smart Maintenance Systems'], why: 'Raw AI tools leave them with half-built parts', by: 'merc', now: NOW,
};
const segment = makeSegment(base);
const score = (criterion, n) => ({ criterion, score: n, reasoning: `read on their about page (${n})` });

describe('segments', () => {
  test('every missing field is named at once, the role included', () => {
    expect(() => makeSegment({ ...base, targetRole: '', offer: 'x', positiveCriteria: [] }))
      .toThrow(/offer: .*targetRole: .*positiveCriteria: /);
  });

  test('a segment opens as a draft; a refiling that keeps its aim keeps its approval; a re-aim returns it to draft', () => {
    const filed = { type: 'filed', segment, at: NOW };
    expect(foldSegments([filed])[0].state).toBe('draft');
    const approved = [filed, { type: 'state', id: segment.id, state: 'approved', by: 'operator', at: NOW }];
    expect(foldSegments(approved)[0]).toMatchObject({ state: 'approved', stateBy: 'operator' });
    const reworded = makeSegment({ ...base, id: segment.id, name: 'Founders who are not developers', why: 'Said more plainly than before' });
    expect(foldSegments([...approved, { type: 'filed', segment: reworded, at: NOW }])[0].state).toBe('approved');
    const reaimed = makeSegment({ ...base, id: segment.id, targetRole: 'CTO' });
    expect(foldSegments([...approved, { type: 'filed', segment: reaimed, at: NOW }])[0]).toMatchObject({ state: 'draft', targetRole: 'CTO' });
  });

  test('a retired segment never moves, and no state repeats', () => {
    expect(judgeState({ state: 'retired' }, 'approved').ok).toBe(false);
    expect(judgeState({ state: 'approved' }, 'approved')).toMatchObject({ ok: false, reason: /already approved/ });
    expect(judgeState({ state: 'draft' }, 'approved').ok).toBe(true);
  });
});

describe('prospects', () => {
  test('a domain is the bare host of a URL or nothing', () => {
    expect(normalizeDomain('https://www.Acme.co.uk/about?x=1')).toBe('acme.co.uk');
    expect(normalizeDomain('acme.com:443')).toBe('acme.com');
    expect(normalizeDomain('not a domain')).toBe('');
  });

  test('every sign of fit must be scored with why; nothing is guessed', () => {
    const f = { segment, domain: 'acme.com', name: 'Acme', source: 'https://acme.com', by: 'merc', now: NOW };
    expect(() => makeProspect({ ...f, scores: [score('Building a software product', 4)] })).toThrow(/"Founder is not a developer" has no score/);
    expect(() => makeProspect({ ...f, scores: [score('Building a software product', 6), score('Founder is not a developer', 4)] })).toThrow(/whole number 0–5/);
    expect(() => makeProspect({ ...f, source: 'http://acme.com', scores: [score('Building a software product', 4), score('Founder is not a developer', 4)] })).toThrow(/source: the https page/);
    const p = makeProspect({ ...f, scores: [score('building a software product', 5), score('Founder is not a developer', 4)], people: [{ name: 'Ada', role: 'Founder', sourceUrl: 'https://acme.com/team' }] });
    expect(p).toMatchObject({ domain: 'acme.com', match: 3, people: [{ name: 'Ada', role: 'Founder' }] });
  });

  test('the match level: any disqualifier at 3+ is none; 4+ with none under 3 is strong; 2.5+ is weak', () => {
    const s = (n) => ({ score: n });
    expect(matchLevel([s(5), s(5)], [s(3)])).toBe(1);
    expect(matchLevel([s(4), s(5)], [s(2)])).toBe(3);
    expect(matchLevel([s(5), s(2)], [])).toBe(2);
    expect(matchLevel([s(2), s(2)], [])).toBe(1);
  });

  test('the pool holds a company once, and never one on the do-not-contact list', () => {
    const p = { id: 'p-1', domain: 'acme.com' };
    const pool = foldProspects([{ type: 'found', prospect: p, at: NOW }]);
    expect(poolRefusal({ domain: 'acme.com' }, pool, () => false)).toMatch(/already in the pool as \[p-1\]/);
    expect(poolRefusal({ domain: 'acme.com' }, foldProspects([{ type: 'found', prospect: p, at: NOW }, { type: 'dropped', id: 'p-1', reason: 'not a fit', at: NOW }]), () => false)).toBeNull();
    expect(poolRefusal({ domain: 'beta.io' }, pool, (d) => d === 'beta.io')).toMatch(/do-not-contact/);
  });
});

describe('the do-not-contact list', () => {
  test('an email matches itself; a domain covers every address at it', () => {
    const entries = [makeSuppression({ target: 'Jo@Acme.com', reason: 'asked', by: 'op', now: NOW }), makeSuppression({ target: 'https://beta.io', reason: 'customer', by: 'op', now: NOW })];
    const m = suppressionMatcher(entries);
    expect(m.email('jo@acme.com')).toBe(true);
    expect(m.email('sam@acme.com')).toBe(false);
    expect(m.email('anyone@beta.io')).toBe(true);
    expect(m.domain('www.beta.io')).toBe(true);
    expect(() => makeSuppression({ target: 'nobody', reason: 'asked', by: 'op', now: NOW })).toThrow(/email address or a company domain/);
    expect(() => makeSuppression({ target: 'a@b.co', reason: 'whim', by: 'op', now: NOW })).toThrow(/reason: one of/);
  });
});

describe('lead upkeep', () => {
  const now = Date.parse(NOW);
  const at = (days) => new Date(now - days * DAY).toISOString();
  const lead = (id, status, contact, touches) => ({ id, name: id, status, contact, touches });
  const contacted = (n, daysAgo) => Array.from({ length: n }, () => ({ at: at(daysAgo), status: 'contacted' }));

  test('what is due, most urgent first: suppressed, answer, follow-up, close-out, duplicate, stale, unreachable', () => {
    const leads = [
      lead('quiet', 'cold', '', [{ at: at(1), status: 'cold' }]),
      lead('old', 'qualified', 'old@x.com', [{ at: at(20), status: 'qualified' }]),
      lead('twice', 'contacted', 'ann@y.com', contacted(1, 0)),
      lead('done', 'contacted', 'done@z.com', contacted(MAX_TOUCHES, 4)),
      lead('chase', 'contacted', 'chase@z.com', contacted(1, 4)),
      lead('wrote', 'replied', 'wrote@z.com', [{ at: at(2), status: 'replied' }]),
      lead('gone', 'contacted', 'gone@nope.com', contacted(1, 0)),
      lead('again', 'cold', 'ANN@y.com', [{ at: at(0), status: 'cold' }]),
      lead('closed', 'lost', 'closed@z.com', [{ at: at(40), status: 'lost' }]),
    ];
    const due = upkeepDue({ leads, now, suppressed: (c) => c.endsWith('@nope.com') });
    expect(due.map((d) => [d.kind, d.leadId])).toEqual([
      ['suppressed', 'gone'], ['answer', 'wrote'], ['follow-up', 'chase'], ['close-out', 'done'],
      ['duplicate', 'again'], ['stale', 'old'], ['unreachable', 'quiet'],
    ]);
    expect(due.find((d) => d.kind === 'duplicate').with).toBe('twice');
    expect(due.find((d) => d.kind === 'follow-up').touches).toBe(1);
  });
});

describe('the fixed reply rules', () => {
  test('a bounce is a delivery notice from the mail system, and it names the address that failed', () => {
    expect(isBounce({ from: 'Mail Delivery Subsystem <mailer-daemon@mail.example>', subject: 'Delivery Status Notification (Failure)' })).toBe(true);
    expect(isBounce({ from: 'postmaster@acme.example', subject: 'Undeliverable: Hello' })).toBe(true);
    expect(isBounce({ from: 'ann@acme.example', subject: 'Re: delivery failed?' })).toBe(false);
    const report = 'Reporting-MTA: dns; mx.example\nFinal-Recipient: rfc822; <Gone@Acme.example>\nAction: failed';
    expect(bouncedAddresses(report, ['other@x.example'])).toEqual(['gone@acme.example']);
    expect(bouncedAddresses('The address ann@acme.example was not found.', ['Ann@Acme.example', 'bob@b.example'])).toEqual(['ann@acme.example']);
    expect(bouncedAddresses('nothing useful here', ['ann@acme.example'])).toEqual([]);
  });

  test('only plain words asking the house to stop count — never a no, never the house\'s own quoted words', () => {
    expect(asksToStop('Please remove me from your list.')).toBe(true);
    expect(asksToStop('Unsubscribe')).toBe(true);
    expect(asksToStop("Don't email me again.")).toBe(true);
    expect(asksToStop('Not interested right now, thanks.')).toBe(false);
    expect(asksToStop('Sounds good, Tuesday works.\n\nOn Mon, Nov 9, Mercator wrote:\n> Reply unsubscribe to stop hearing from us')).toBe(false);
    expect(asksToStop('Thanks!\n> remove me')).toBe(false);
    expect(asksToStop('Stop')).toBe(true);
    expect(asksToStop('stop.\n\nOn Mon, the Mercator wrote:\n> hello')).toBe(true);
    expect(asksToStop('We will stop by on Tuesday.')).toBe(false);
  });
});

describe('the sales cover — approve the list once, then the sequence runs inside its limits', () => {
  const now = Date.parse(NOW);
  const at = (days) => new Date(now - days * DAY).toISOString();
  const segments = [{ id: 's-1', state: 'approved' }, { id: 's-2', state: 'paused' }];
  const prospects = [
    { id: 'p-1', segmentId: 's-1', leadId: 'l-1', listApproved: true },
    { id: 'p-2', segmentId: 's-1', leadId: 'l-2' },
    { id: 'p-3', segmentId: 's-2', leadId: 'l-3', listApproved: true },
  ];
  const lead = (id, contact, touches = []) => ({ id, contact, status: 'cold', touches });
  const judge = (recipients, leads, extra = {}) => judgeCover({ recipients, leads, prospects, segments, now, ...extra });

  test('a listed lead of an approved audience is covered for the first email', () => {
    expect(judge(['Ann@acme.example'], [lead('l-1', 'ann@acme.example')])).toEqual({ covered: true });
  });

  test('anyone else asks: a stranger, an unlisted lead, a paused audience', () => {
    expect(judge(['x@y.example'], [lead('l-1', 'ann@acme.example')]).reason).toMatch(/is not a lead/);
    expect(judge(['bo@b.example'], [lead('l-2', 'bo@b.example')]).reason).toMatch(/not on an approved list/);
    expect(judge(['cy@c.example'], [lead('l-3', 'cy@c.example')]).reason).toMatch(/not on an approved list/);
  });

  test('the sequence: three days between emails, three emails at most, never an answer to someone who wrote', () => {
    const out = (days) => ({ at: at(days), direction: 'out' });
    expect(judge(['ann@acme.example'], [lead('l-1', 'ann@acme.example', [out(1)])]).reason).toMatch(/less than 3 days ago/);
    expect(judge(['ann@acme.example'], [lead('l-1', 'ann@acme.example', [out(4)])])).toEqual({ covered: true });
    expect(judge(['ann@acme.example'], [lead('l-1', 'ann@acme.example', [out(10), out(7), out(4)])]).reason).toMatch(/first email and its follow-ups/);
    expect(judge(['ann@acme.example'], [lead('l-1', 'ann@acme.example', [out(9), { at: at(5), direction: 'in' }])]).reason).toMatch(/wrote last — an answer waits for the operator/);
  });

  test('a new sending address earns its volume: 5, 10, 15 a day by week, then the full cap', () => {
    const ago = (days) => new Date(now - days * DAY).toISOString();
    expect([rampCap(null, now), rampCap(ago(6), now), rampCap(ago(7), now), rampCap(ago(14), now), rampCap(ago(21), now)]).toEqual([5, 5, 10, 15, DAILY_CAP]);
    const sent = lead('l-9', 'busy@z.example', Array.from({ length: 5 }, () => ({ at: NOW, direction: 'out' })));
    expect(judge(['ann@acme.example'], [lead('l-1', 'ann@acme.example'), sent], { cap: rampCap(null, now) }).reason).toMatch(/cap of 5/);
  });

  test('the day\'s cap counts every email to a lead today', () => {
    const busy = lead('l-9', 'busy@z.example', Array.from({ length: DAILY_CAP }, () => ({ at: NOW, direction: 'out' })));
    expect(judge(['ann@acme.example'], [lead('l-1', 'ann@acme.example'), busy]).reason).toMatch(/cap of 20/);
  });
});

describe('the sales facts — what a buyer may be told, and the check every email to a lead passes', () => {
  const facts = [
    { claim: 'One-to-one sessions with the founder, 60 minutes', figure: { value: 60, unit: 'minutes' }, source: 'https://ignislabs.ai/sessions' },
    { claim: 'A session costs 250 US dollars an hour', figure: { value: 250, unit: 'USD' }, source: 'https://ignislabs.ai/sessions' },
    { claim: 'A customer launched his own product after the sessions', source: 'customer: Darren, by email, 2026-10' },
  ];
  test('a sheet needs three sourced facts; every problem is named', () => {
    expect(() => makeSalesSheet({ facts: facts.slice(0, 2), by: 'm', now: NOW })).toThrow(/at least three/);
    expect(() => makeSalesSheet({ facts: [...facts, { claim: 'We are the best in the world', source: 'trust me' }], by: 'm', now: NOW })).toThrow(/facts\[3\]\.source/);
    expect(makeSalesSheet({ facts, by: 'm', now: NOW }).facts.map((f) => f.n)).toEqual([1, 2, 3]);
  });

  test('the operator approves the latest sheet once; a newer filing waits while the approved one stands', () => {
    const a = makeSalesSheet({ facts, by: 'm', now: NOW });
    const b = makeSalesSheet({ facts, by: 'm', now: NOW });
    let state = foldSalesFacts([{ type: 'facts', sheet: a }]);
    expect(judgeSheetReview(state, { sheetId: b.id, verdict: 'approved', now: NOW }).ok).toBe(false);
    expect(judgeSheetReview(state, { sheetId: a.id, verdict: 'returned', note: '', now: NOW }).reason).toMatch(/say what should change/);
    const approve = judgeSheetReview(state, { sheetId: a.id, verdict: 'approved', now: NOW });
    state = foldSalesFacts([{ type: 'facts', sheet: a }, approve.event, { type: 'facts', sheet: b }]);
    expect(state).toMatchObject({ sheet: { id: b.id }, review: null, approved: { id: a.id } });
    expect(judgeSheetReview(foldSalesFacts([{ type: 'facts', sheet: a }, approve.event]), { sheetId: a.id, verdict: 'approved', now: NOW }).reason).toMatch(/already approved/);
  });

  test('an email to a lead: only the sheet\'s numbers, the disclosure line, no false urgency', () => {
    const approved = makeSalesSheet({ facts, by: 'm', now: NOW });
    const ok = `A 60 minute session is 250 dollars.\n\n${SALES_DISCLOSURE}\nThe Mercator`;
    expect(checkSalesEmail({ subject: 'Your build', text: ok, approved })).toEqual({ ok: true });
    expect(checkSalesEmail({ subject: 'Your build', text: ok, approved: null }).problems[0]).toMatch(/has not approved a facts sheet/);
    const bad = checkSalesEmail({ subject: 'Hurry', text: 'A 90 minute session, booked on 2026-11-20, in 2027.', approved });
    expect(bad.problems).toEqual([
      expect.stringMatching(/^90 is not on the approved facts sheet/),
      expect.stringMatching(/carry the disclosure line/),
      expect.stringMatching(/no false urgency/),
    ]);
  });
});
