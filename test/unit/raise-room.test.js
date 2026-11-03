/**
 * THE RAISE ROOM's foundation as pure law, called with real inputs (RULE 0):
 * the Quaestor's mandate holds no payment details and every figure of the
 * offer; only the operator's signature — on the draft they read, with counsel's
 * route confirmed — makes it the fence; the facts sheet sources every fact and
 * waits for counsel; a being never reads the receiving account.
 */
import { describe, test, expect } from 'vitest';
import { makeMandate, judgeSign, makeFactsSheet, judgeReview, foldRaise, raiseForBeings } from '../../backend/services/raise/raise-shape.js';
import { judgeStatus } from '../../backend/services/raise/raise-store.js';

const NOW = '2026-11-10T09:00:00.000Z';
const mandate = (over = {}) => makeMandate({
  amount: 250000, currency: 'USD', instrument: 'safe', valuation: { low: 2000000, high: 3000000, basis: 'repos/tidewater/valuation.md — revenue multiple against three harbour-software comparables' },
  useOfFunds: 'Twelve months of serving, two harbour pilots, and the counsel this raise needs.', route: { kind: '506c', jurisdiction: 'US' },
  limits: { perDay: 10, followUps: 2 }, minCheck: 5000, by: 'quae', now: NOW, ...over,
});
const sheet = (over = {}) => makeFactsSheet({
  facts: [
    { claim: 'Three harbours pay for the weekly sheet', figure: { value: 3, unit: 'harbours' }, source: 'books: Tidewater 2026 to date' },
    { claim: 'Monthly revenue from the sheet', figure: { value: 360, unit: 'USD' }, source: 'ledger: money-in, November 2026' },
    { claim: 'We expect thirty harbours within a year', figure: { value: 30, unit: 'harbours' }, source: 'repos/tidewater/plan.md', forwardLooking: true },
  ],
  dataRoom: ['repos/tidewater/data-room/', 'not a source'], by: 'numer', now: NOW, ...over,
});

describe('the mandate', () => {
  test('every figure of the offer is drawn, and none of them is where the money lands', () => {
    const m = mandate();
    expect(m).toMatchObject({ amount: 250000, instrument: 'safe', route: { kind: '506c', jurisdiction: 'US' }, limits: { perDay: 10, followUps: 2 }, minCheck: 5000 });
    expect(Object.keys(m)).not.toContain('account');
    expect(() => mandate({ instrument: 'token' })).toThrow(/instrument is one of safe, priced, convertible/);
    expect(() => mandate({ valuation: { low: 3, high: 2, basis: 'x'.repeat(30) } })).toThrow(/high at least low/);
    expect(() => mandate({ valuation: { low: 1, high: 2, basis: 'vibes' } })).toThrow(/how the range was reached/);
    expect(() => mandate({ route: { kind: 'crowd', jurisdiction: 'US' } })).toThrow(/the legal route counsel chose/);
    expect(() => mandate({ limits: { perDay: 500, followUps: 2 } })).toThrow(/perDay 1–50/);
  });

  test('only the operator\'s signature on the draft they read, counsel\'s route confirmed, makes it the fence', () => {
    const m = mandate();
    const state = foldRaise([{ type: 'mandate', mandate: m, at: NOW }]);
    expect(state.status).toBe('none');
    const sign = (over) => judgeSign(state, { mandateId: m.id, counselChoseRoute: true, account: { kind: 'wallet', address: `0x${'ab'.repeat(20)}` }, now: NOW, ...over });
    expect(sign({ mandateId: 'm-00000000' }).reason).toMatch(/sign the mandate on screen/);
    expect(sign({ counselChoseRoute: false }).reason).toMatch(/counsel chooses the legal route/);
    expect(sign({ account: { kind: 'wallet', address: 'my wallet' } }).reason).toBe('the receiving wallet is a 0x address');
    expect(sign({ account: { kind: 'bank', bankName: 'Mercury', accountName: '', details: '' } }).reason).toMatch(/wire details/);
    expect(sign({ account: { kind: 'portal', portal: 'Wefunder', url: 'http://wefunder.com' } }).reason).toMatch(/https link/);
    expect(sign({ account: { kind: 'cash' } }).reason).toMatch(/wallet, a bank, or a registered funding portal/);
    const signed = sign({});
    expect(signed.event).toMatchObject({ type: 'signed', id: m.id, account: { kind: 'wallet', network: 'ethereum' }, by: 'operator' });
    const active = foldRaise([{ type: 'mandate', mandate: m, at: NOW }, signed.event]);
    expect(active).toMatchObject({ status: 'active', mandate: { id: m.id } });
    // A being reads where the raise stands — never where the money lands.
    expect(raiseForBeings(active).account).toEqual({ kind: 'wallet' });
    expect(JSON.stringify(raiseForBeings(active))).not.toContain('abab');
  });

  test('the switch moves only from where it can: pause, resume, close', () => {
    const m = mandate();
    const active = foldRaise([{ type: 'mandate', mandate: m, at: NOW }, { type: 'signed', id: m.id, account: { kind: 'wallet', address: '0x' }, by: 'operator', at: NOW }]);
    expect(judgeStatus('resumed', null, NOW)(active).reason).toBe('the mandate is active — it cannot be resumed from there');
    const paused = foldRaise([{ type: 'mandate', mandate: m, at: NOW }, { type: 'signed', id: m.id, account: {}, by: 'operator', at: NOW }, judgeStatus('paused', ' a pause ', NOW)(active).event]);
    expect(paused.status).toBe('paused');
    expect(judgeStatus('closed', null, NOW)(paused).event).toMatchObject({ type: 'closed', by: 'operator' });
  });
});

describe('the facts sheet', () => {
  test('every fact sourced, each figure whole, forward-looking lines marked; a data room holds only sources', () => {
    const s = sheet();
    expect(s.facts.map((f) => [f.n, f.forwardLooking])).toEqual([[1, false], [2, false], [3, true]]);
    expect(s.dataRoom).toEqual(['repos/tidewater/data-room/']);
    expect(() => sheet({ facts: [{ claim: 'Three harbours pay', source: 'ledger: money-in, Nov' }] })).toThrow(/at least three/);
    expect(() => sheet({ facts: [...sheet().facts.slice(0, 2), { claim: 'We are the best in the world', source: 'trust us' }] })).toThrow(/facts\[2\]\.source/);
  });

  test('counsel reviews the sheet on screen; a return says what to change; only approved backs an ask', () => {
    const s = sheet();
    const filed = foldRaise([{ type: 'facts', sheet: s, at: NOW }]);
    expect(judgeReview(filed, { sheetId: 'f-00000000', verdict: 'approved', now: NOW }).reason).toMatch(/review the facts sheet on screen/);
    expect(judgeReview(filed, { sheetId: s.id, verdict: 'returned', note: '', now: NOW }).reason).toBe('say what counsel wants changed');
    const approved = foldRaise([{ type: 'facts', sheet: s, at: NOW }, judgeReview(filed, { sheetId: s.id, verdict: 'approved', now: NOW }).event]);
    expect(approved.approved.id).toBe(s.id);
    const newer = sheet();
    const refiled = foldRaise([{ type: 'facts', sheet: s, at: NOW }, judgeReview(filed, { sheetId: s.id, verdict: 'approved', now: NOW }).event, { type: 'facts', sheet: newer, at: NOW }]);
    expect([refiled.sheet.id, refiled.review, refiled.approved.id]).toEqual([newer.id, null, s.id]);
  });
});
