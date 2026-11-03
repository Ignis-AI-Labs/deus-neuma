/**
 * THE RAISE ROOM's outreach as pure law, called with real inputs (RULE 0):
 * the facts gate reads every figure, every forward-looking sentence, the
 * disclosure line, every payment shape and every false urgency; the
 * platform's payment line comes only from the signed mandate; the Praetor
 * clears under the route; a reach keeps to the mandate's pace and follow-ups,
 * and a declined investor ends the thread.
 */
import { describe, test, expect } from 'vitest';
import { checkMessage, figuresIn, paymentLine, disclosureLine, PAYMENT_PLACEHOLDER } from '../../backend/services/raise/facts-gate.js';
import { makeMandate, makeFactsSheet, makeInvestor, foldRaise, judgeClear, judgeReach, judgeUpdate } from '../../backend/services/raise/raise-shape.js';

const NOW = '2026-11-10T09:00:00.000Z';
const mandate = (route = '506c', limits = { perDay: 3, followUps: 1 }) => makeMandate({
  amount: 250000, currency: 'USD', instrument: 'safe', valuation: { low: 2000000, high: 3000000, basis: 'repos/tidewater/valuation.md — three comparables' },
  useOfFunds: 'Twelve months of serving and two harbour pilots.', route: { kind: route, jurisdiction: 'US' }, limits, minCheck: 5000, by: 'quae', now: NOW,
});
const sheet = makeFactsSheet({ facts: [
  { claim: 'Three harbours pay for the weekly sheet', figure: { value: 3, unit: 'harbours' }, source: 'books: Tidewater 2026' },
  { claim: 'Monthly revenue from the sheet', figure: { value: 360, unit: 'USD' }, source: 'ledger: money-in, November' },
  { claim: 'Thirty harbours within a year', figure: { value: 30, unit: 'harbours' }, source: 'repos/tidewater/plan.md', forwardLooking: true },
], by: 'numer', now: NOW });
const DISCLOSE = disclosureLine('Tidewater');
const body = (extra) => `Three harbours already pay for the sheet, 360 USD a month. ${extra} We are raising 250,000 USD on a SAFE. ${DISCLOSE} ${PAYMENT_PLACEHOLDER}`;
const gate = (b, subject = 'Tidewater — tide sheets for small harbours') => checkMessage({ subject, body: b, sheet, mandate: mandate(), companyName: 'Tidewater' });

describe('the facts gate', () => {
  test('reads figures as a reader does — thousands, millions, percents — and sets dates and years aside', () => {
    expect(figuresIn('We raise $250,000 at $2.5M, 30% done, 1.2k users, 2 million rows')).toEqual([250000, 2500000, 30, 1200, 2000000]);
    expect(figuresIn('Founded 2026, filed 2026-11-12T09:00:00Z, see {{payment}}')).toEqual([]);
    expect(figuresIn('12 months of runway')).toEqual([12]);
  });

  test('a message of facts, marked, disclosed and without payment details passes', () => {
    expect(gate(body('We expect thirty harbours within a year (forward-looking).'))).toEqual({ ok: true });
  });

  test('every problem is named at once: a stray figure, an unmarked promise, no disclosure, wire details, false urgency', () => {
    const bad = 'We have 12 harbours. We will triple revenue. Act now — wire to routing number 021000021, or send to 0x' + 'ab'.repeat(20) + '.';
    const { problems } = gate(bad);
    expect(problems).toEqual(expect.arrayContaining([
      expect.stringMatching(/^12 is not on the facts sheet counsel approved/),
      expect.stringMatching(/^mark this forward-looking sentence "\(forward-looking\)": "We will triple revenue\."/),
      expect.stringMatching(/^carry the disclosure line, word for word/),
      expect.stringMatching(/^a wallet address — no payment detail is ever written by a being/),
      expect.stringMatching(/^bank details — no payment detail/),
      'no false urgency (MAKOTO) — an investor decides in their own time',
    ]));
  });

  test('the platform\'s payment line comes from the signed mandate\'s account alone', () => {
    expect(paymentLine({ kind: 'wallet', address: `0x${'7e'.repeat(20)}`, network: 'ethereum' })).toBe(`Funds are received only at 0x${'7e'.repeat(20)} on ethereum, and only once the papers are signed.`);
    expect(paymentLine({ kind: 'portal', portal: 'Wefunder', url: 'https://wefunder.com/tidewater' })).toBe('Investment is made only through Wefunder: https://wefunder.com/tidewater');
  });
});

describe('the investors', () => {
  const listed = (m, invs) => foldRaise([
    { type: 'mandate', mandate: m, at: NOW }, { type: 'signed', id: m.id, account: { kind: 'wallet', address: '0x' }, by: 'operator', at: NOW },
    { type: 'facts', sheet, at: NOW }, { type: 'reviewed', sheetId: sheet.id, verdict: 'approved', note: null, by: 'operator', at: NOW },
    ...invs.map((investor) => ({ type: 'investor', investor, at: NOW })),
  ]);
  const ann = makeInvestor({ name: 'Ann Fund', email: 'ann@fund.example', thesis: 'Maritime software, seed stage', why: 'Backed two port-tech startups', by: 'spec', now: NOW });
  const bo = makeInvestor({ name: 'Bo Angel', email: 'bo@angel.example', thesis: 'Small-business SaaS angels', why: 'Sails out of Padstow', relationship: 'Met the operator at the 2026 Fowey regatta', by: 'spec', now: NOW });

  test('the Praetor clears under the route: a 506(b) asks only those the company already knows', () => {
    const b = listed(mandate('506b'), [ann, bo]);
    expect(judgeClear(b, { investorId: ann.id, verdict: 'cleared', by: 'prae', now: NOW }).reason).toMatch(/506\(b\) offering may only ask those the company already knows/);
    expect(judgeClear(b, { investorId: bo.id, verdict: 'cleared', by: 'prae', now: NOW }).ok).toBe(true);
    expect(judgeClear(b, { investorId: ann.id, verdict: 'refused', by: 'prae', now: NOW }).reason).toBe('say why the route does not allow it');
    expect(() => makeInvestor({ name: 'Xen Capital', email: 'not-an-address', thesis: 'anything at all', why: 'because we can', by: 's', now: NOW })).toThrow(/email/);
  });

  test('a reach keeps the mandate\'s pace and follow-ups; a declined investor is never written to again', () => {
    const m = mandate('506c', { perDay: 2, followUps: 1 });
    const base = [
      { type: 'mandate', mandate: m, at: NOW }, { type: 'signed', id: m.id, account: {}, by: 'operator', at: NOW },
      { type: 'facts', sheet, at: NOW }, { type: 'reviewed', sheetId: sheet.id, verdict: 'approved', note: null, by: 'operator', at: NOW },
      { type: 'investor', investor: ann, at: NOW }, { type: 'investor', investor: bo, at: NOW },
      { type: 'cleared', id: ann.id, verdict: 'cleared', note: null, by: 'prae', at: NOW }, { type: 'cleared', id: bo.id, verdict: 'cleared', note: null, by: 'prae', at: NOW },
    ];
    const sent = (id) => ({ type: 'reach', id, to: 'x', subject: 's', text: 't', messageId: null, by: 'merc', at: NOW });
    expect(judgeReach(foldRaise(base), { investorId: ann.id, now: NOW }).ok).toBe(true);
    expect(judgeReach(foldRaise([...base, sent(ann.id), sent(ann.id)]), { investorId: ann.id, now: NOW }).reason).toMatch(/allows 1 follow-ups after the first message/);
    expect(judgeReach(foldRaise([...base, sent(ann.id), sent(ann.id)]), { investorId: bo.id, now: NOW }).reason).toMatch(/pace is 2 messages a day/);
    expect(judgeReach(foldRaise([...base, sent(ann.id), sent(ann.id)]), { investorId: bo.id, now: '2026-11-11T09:00:00.000Z' }).ok).toBe(true);
    const no = judgeUpdate(foldRaise(base), { investorId: bo.id, status: 'declined', note: 'Not investing in software this year', by: 'merc', now: NOW });
    expect(judgeReach(foldRaise([...base, no.event]), { investorId: bo.id, now: NOW }).reason).toBe('Bo Angel declined — a clear no ends the thread (MAKOTO)');
  });

  test('no investor is written to without a signed mandate and an approved facts sheet', () => {
    const m = mandate();
    expect(judgeReach(foldRaise([{ type: 'mandate', mandate: m, at: NOW }]), { investorId: ann.id, now: NOW }).reason).toMatch(/not signed/);
    expect(judgeReach(foldRaise([{ type: 'mandate', mandate: m, at: NOW }, { type: 'signed', id: m.id, account: {}, by: 'operator', at: NOW }]), { investorId: ann.id, now: NOW }).reason).toMatch(/counsel has not approved a facts sheet/);
  });
});
