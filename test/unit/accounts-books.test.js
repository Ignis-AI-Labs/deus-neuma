/**
 * THE BOOKS as pure law, called with real inputs (RULE 0): an entry from a
 * receipt takes the receipt's figures, a hand entry names its source and
 * stands unmatched, a void withdraws without editing, the statement nets each
 * currency, deadlines cite their source and mark a CPA's, and the briefing
 * reads it all.
 */
import { describe, test, expect } from 'vitest';
import { makeEntry, makeDeadline, foldBooks, statement, upcoming, CATEGORIES } from '../../backend/services/accounts/books-shape.js';
import { logistaBriefingText } from '../../backend/services/accounts/accounts-briefing.js';
import { matchedFigures } from '../../backend/services/accounts/house-receipts.js';

const NOW = '2026-11-03T09:00:00.000Z';
const RECEIPTS = [
  { kind: 'money-in', ref: 'base:0xabc:0', direction: 'in', amount: 120, currency: 'USDC', date: '2026-11-01T10:00:00.000Z', label: '120 USDC in' },
  { kind: 'spend', ref: 'merc:aa11', direction: 'out', amount: 0.01, currency: 'ETH', date: '2026-11-02T10:00:00.000Z', label: '0.01 ETH out' },
];
const fromReceipt = (ref, kind = 'money-in', over = {}) => makeEntry({
  receipt: { kind, ref, amount: 999999 }, matched: matchedFigures(RECEIPTS, kind, ref), category: 'revenue', memo: 'Padstow, November', by: 'logi', now: NOW, ...over,
});

describe('an entry', () => {
  test('from a receipt, its figures are the receipt\'s — whatever the filer wrote', () => {
    expect(fromReceipt('base:0xabc:0')).toMatchObject({
      direction: 'in', amount: 120, currency: 'USDC', date: '2026-11-01T10:00:00.000Z', receipt: { kind: 'money-in', ref: 'base:0xabc:0' }, category: 'revenue',
    });
    expect(() => fromReceipt('nope')).toThrow(/no money-in receipt "nope" in this house/);
    expect(() => fromReceipt('base:0xabc:0', 'money-in', { category: 'misc' })).toThrow(/category is one of/);
    expect(CATEGORIES).toContain('investment');
  });

  test('by hand, it carries its figures and names its source', () => {
    const manual = (r) => makeEntry({ receipt: { kind: 'manual', direction: 'out', amount: 40, currency: 'USD', date: '2026-11-02', ...r }, matched: null, category: 'fees', memo: 'State filing fee', by: 'logi', now: NOW });
    expect(() => manual({ source: 'paid it' })).toThrow(/receipt\.source/);
    expect(() => manual({ amount: 0, source: 'bank: Mercury statement, Nov' })).toThrow(/above zero/);
    expect(() => manual({ direction: 'sideways', source: 'bank: Mercury statement, Nov' })).toThrow(/in or out/);
    expect(manual({ source: 'invoice: Wyoming SOS #2026-1234' })).toMatchObject({ amount: 40, currency: 'USD', receipt: { kind: 'manual', ref: null, source: 'invoice: Wyoming SOS #2026-1234' } });
  });
});

describe('the books folded, and the statement', () => {
  const a = fromReceipt('base:0xabc:0');
  const b = fromReceipt('merc:aa11', 'spend', { category: 'compute', memo: 'GPU hours' });
  const c = makeEntry({ receipt: { kind: 'manual', direction: 'out', amount: 40, currency: 'USD', date: '2026-11-02', source: 'invoice: Wyoming SOS #2026-1234' }, matched: null, category: 'fees', memo: 'State filing fee', by: 'logi', now: NOW });
  const tax = makeDeadline({ what: 'Wyoming annual report', due: '2026-12-01', authority: 'Wyoming Secretary of State', source: 'https://sos.wyo.gov/Business/AnnualReport.aspx', needsCpa: false, by: 'logi', now: NOW });
  const ret = makeDeadline({ what: 'Federal return (Form 1065)', due: '2027-03-15', authority: 'the IRS', source: 'https://www.irs.gov/forms-pubs/about-form-1065', needsCpa: true, by: 'logi', now: NOW });
  const folded = foldBooks([
    { type: 'booked', entry: a, at: NOW }, { type: 'booked', entry: b, at: NOW }, { type: 'booked', entry: c, at: NOW },
    { type: 'voided', id: b.id, reason: 'booked to the wrong company', by: 'logi', at: NOW },
    { type: 'voided', id: b.id, reason: 'again', by: 'logi', at: NOW },
    { type: 'deadline', deadline: tax, at: NOW }, { type: 'deadline', deadline: ret, at: NOW },
    { type: 'met', id: tax.id, note: 'filed online, confirmation 88213', by: 'logi', at: NOW },
  ]);

  test('a void withdraws an entry, never twice; a met deadline closes', () => {
    expect(folded.entries.map((e) => e.id)).toEqual([a.id, c.id]);
    expect(folded.voided).toHaveLength(1);
    expect(folded.skipped).toBe(1);
    expect(folded.deadlines.find((d) => d.id === tax.id).met).toMatchObject({ note: 'filed online, confirmation 88213' });
    expect(() => makeDeadline({ what: 'Annual report', due: 'soon', authority: 'the state', source: 'https://x.org', by: 'l', now: NOW })).toThrow(/due/);
    expect(() => makeDeadline({ what: 'Annual report', due: '2026-12-01', authority: 'the state', source: 'my notes', by: 'l', now: NOW })).toThrow(/source/);
  });

  test('the statement nets each currency, counts the unmatched, and keeps to its period', () => {
    expect(statement(folded.entries)).toEqual({
      from: null, to: null, currencies: { USDC: { in: 120, out: 0, net: 120 }, USD: { in: 0, out: 40, net: -40 } },
      byCategory: { revenue: 1, fees: 1 }, entries: 2, unmatched: 1,
    });
    expect(statement(folded.entries, { from: '2026-11-02' }).currencies).toEqual({ USD: { in: 0, out: 40, net: -40 } });
    expect(upcoming(folded.deadlines, Date.parse(NOW)).map((d) => d.id)).toEqual([]);
    expect(upcoming(folded.deadlines, Date.parse('2027-02-01T00:00:00Z')).map((d) => d.id)).toEqual([ret.id]);
  });

  test('the briefing: each company to date, the unbooked receipts, the deadlines a CPA must sign', () => {
    const text = logistaBriefingText({
      year: '2026',
      books: [{ id: 'c-abc123-0a0b0c', name: 'Tidewater', yearToDate: statement(folded.entries, { from: '2026-01-01' }), deadlines: folded.deadlines }],
      unbooked: [RECEIPTS[1]],
    }, Date.parse('2027-02-01T00:00:00Z'));
    expect(text).toContain('- Tidewater [c-abc123-0a0b0c] 2026 to date: USDC in 120 · out 0 · net 120; USD in 0 · out 40 · net -40 — 2 entries, 1 unmatched');
    expect(text).toContain('- spend merc:aa11: 0.01 ETH out, 2026-11-02');
    expect(text).toContain(`- [${ret.id}] Tidewater: Federal return (Form 1065) — 2027-03-15, to the IRS — NEEDS A LICENSED CPA (ask the operator with company/hands)`);
    expect(text).toContain('you never move it (TREASURY is not ACCOUNTS)');
  });
});
