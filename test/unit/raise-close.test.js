/**
 * THE RAISE ROOM's close as pure law, called with real inputs (RULE 0): terms
 * live inside the signed mandate — its range, its smallest check, never past
 * what it seeks; the Praetor finds them sound or returns them; the close
 * needs the papers, accreditation on a 506(c), and the money landed at the
 * mandate's own wallet, on its network, for the agreed amount — one receipt,
 * one close.
 */
import { describe, test, expect } from 'vitest';
import { makeMandate, makeInvestor, foldRaise, judgeTerms, judgeTermsCheck, judgeCloseInvestor, raised } from '../../backend/services/raise/raise-shape.js';

const NOW = '2026-11-12T09:00:00.000Z';
const WALLET_IN = `0x${'7e'.repeat(20)}`;
const m = makeMandate({
  amount: 100000, currency: 'USD', instrument: 'safe', valuation: { low: 2000000, high: 3000000, basis: 'repos/tidewater/valuation.md — three comparables' },
  useOfFunds: 'Twelve months of serving and two harbour pilots.', route: { kind: '506c', jurisdiction: 'US' }, limits: { perDay: 3, followUps: 1 }, minCheck: 5000, by: 'quae', now: NOW,
});
const inv = (name) => makeInvestor({ name, email: `${name.toLowerCase().replace(/\W/g, '')}@fund.example`, thesis: 'Maritime software at seed', why: 'Backed port-tech before', by: 'spec', now: NOW });
const ann = inv('Ann Fund');
const cy = inv('Cy Ventures');
const base = [
  { type: 'mandate', mandate: m, at: NOW }, { type: 'signed', id: m.id, account: { kind: 'wallet', address: WALLET_IN, network: 'ethereum' }, by: 'operator', at: NOW },
  ...[ann, cy].flatMap((i) => [
    { type: 'investor', investor: i, at: NOW }, { type: 'cleared', id: i.id, verdict: 'cleared', note: null, by: 'prae', at: NOW },
    { type: 'update', id: i.id, status: 'interested', note: 'Wants the deck', by: 'merc', at: NOW },
  ]),
];
const terms = (i, amount, valuation = 2500000) => ({ type: 'terms', id: i.id, amount, valuation, notes: null, by: 'quae', at: NOW });
const sound = (i) => ({ type: 'terms-check', id: i.id, verdict: 'sound', note: null, by: 'prae', at: NOW });
const receipt = (over = {}) => ({ key: 'ethereum:0xabc:0', network: 'ethereum', asset: 'USDC', amount: '60000.0', to: WALLET_IN, ...over });

describe('terms', () => {
  test('inside the mandate: an interested investor, the smallest check, the valuation range, never past what it seeks', () => {
    const s = foldRaise(base);
    expect(judgeTerms(s, { investorId: ann.id, amount: 1000, valuation: 2500000, by: 'quae', now: NOW }).reason).toMatch(/at least the mandate's smallest check, 5000 USD/);
    expect(judgeTerms(s, { investorId: ann.id, amount: 60000, valuation: 4000000, by: 'quae', now: NOW }).reason).toMatch(/inside the mandate's range/);
    expect(judgeTerms(s, { investorId: ann.id, amount: 60000, valuation: 2500000, by: 'quae', now: NOW }).ok).toBe(true);
    const promised = foldRaise([...base, terms(ann, 60000)]);
    expect(raised(promised)).toEqual({ closed: 0, promised: 60000 });
    expect(judgeTerms(promised, { investorId: cy.id, amount: 50000, valuation: 2500000, by: 'quae', now: NOW }).reason).toMatch(/60000 is closed or promised — at most 40000 remains/);
    expect(judgeTerms(promised, { investorId: ann.id, amount: 6000, valuation: 2500000, by: 'quae', now: NOW }).reason).toMatch(/Ann Fund is terms/);
  });

  test('the Praetor finds them sound, or returns them with what is wrong', () => {
    const s = foldRaise([...base, terms(ann, 60000)]);
    expect(judgeTermsCheck(s, { investorId: ann.id, verdict: 'returned', note: '', by: 'prae', now: NOW }).reason).toBe('say what is wrong with the terms');
    expect(foldRaise([...base, terms(ann, 60000), judgeTermsCheck(s, { investorId: ann.id, verdict: 'returned', note: 'The cap is above the signed range', by: 'prae', now: NOW }).event])
      .investors.find((i) => i.id === ann.id).status).toBe('interested');
  });
});

describe('the close', () => {
  const ready = foldRaise([...base, terms(ann, 60000), sound(ann)]);
  const close = (over) => judgeCloseInvestor(ready, { investorId: ann.id, signedPapers: true, accreditedVerified: true, receipt: receipt(), now: NOW, ...over });

  test('the papers, accreditation on a 506(c), and the money landed — at the mandate\'s wallet, on its network, enough of it', () => {
    expect(close({ signedPapers: false }).reason).toBe('the papers are signed before a close');
    expect(close({ accreditedVerified: false }).reason).toBe('a 506(c) close needs the investor verified accredited');
    expect(close({ receipt: null }).reason).toMatch(/the money has not landed/);
    expect(close({ receipt: receipt({ to: `0x${'11'.repeat(20)}` }) }).reason).toMatch(/not the mandate's/);
    expect(close({ receipt: receipt({ network: 'base' }) }).reason).toMatch(/on base, not the mandate's .* on ethereum/);
    expect(close({ receipt: receipt({ amount: '59999.99' }) }).reason).toMatch(/the receipt holds 59999.99 USDC; the terms are 60000 USD/);
    expect(close({ receipt: receipt({ asset: 'ETH' }) }).reason).toMatch(/holds 60000.0 ETH/);
    expect(close({}).event).toEqual({ type: 'closed-in', id: ann.id, amount: 60000, received: { kind: 'money-in', ref: 'ethereum:0xabc:0' }, by: 'operator', at: NOW });
  });

  test('one receipt, one close; the raise counts what closed', () => {
    const closed = foldRaise([...base, terms(ann, 60000), sound(ann), close({}).event, terms(cy, 20000), sound(cy)]);
    expect(raised(closed)).toEqual({ closed: 60000, promised: 20000 });
    expect(judgeCloseInvestor(closed, { investorId: cy.id, signedPapers: true, accreditedVerified: true, receipt: receipt(), now: NOW }).reason).toBe('that receipt already closed another investor — one receipt, one close');
    expect(judgeCloseInvestor(closed, { investorId: ann.id, signedPapers: true, accreditedVerified: true, receipt: receipt({ key: 'k2' }), now: NOW }).reason).toMatch(/only an investor whose terms the Praetor found sound/);
  });
});
