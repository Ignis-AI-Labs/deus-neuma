/**
 * INVOICES AND DELIVERY, the law (the house economy's Stages 3–4, RULE 0):
 * the real shapes bill only a won deal, never past what it was won at, and
 * only to where the operator said; paid is a receipt at that address, in that
 * money, for at least the total, one receipt one invoice; the invoice page is
 * rendered from the record with every being's word escaped; the delivery
 * door takes only the operator's folder and an https address; and the
 * TREASURY's INVOICES and the SALES section's DELIVERY rendered for real.
 */
import { describe, test, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  makeInvoice, foldInvoices, judgePaid, judgeVoid, billedFor, overdue, unmatchedFor, invoiceHtml, invoiceNumber,
} from '../../backend/services/invoices/invoice-shape.js';
import { invoiceBriefingLines } from '../../backend/services/invoices/invoice-briefing.js';
import { destinationOf, placeOf, safeName } from '../../backend/services/delivery/delivery-shape.js';
import { mercatorBriefingText } from '../../backend/services/revenue/revenue-briefing.js';
import { InvoicesSection } from '../../frontend/app/RelinkShell/InvoicesSection.jsx';
import { SalesSection } from '../../frontend/app/RelinkShell/company-line/SalesSection.jsx';

const NOW = '2026-10-30T07:00:00.000Z';
const PAY_TO = { address: '0x7E7E7e7E7e7E7e7E7E7e7E7e7E7E7e7E7E7e7E7e', network: 'ethereum' };
const COMPANY = { id: 'c-abc123-0a0b0c', name: 'Tidewater' };
const deal = (fields = {}) => ({ id: 'd-0a0b0c0d', companyId: COMPANY.id, buyer: 'Port of <Brine>', value: { amount: 1200, currency: 'USD' }, stage: 'won', ...fields });
const issue = (fields = {}) => makeInvoice({
  deal: deal(), company: COMPANY, lines: [{ what: 'Harbour sheet, November', amount: 800 }, { what: 'Setup', amount: 400 }],
  due: '2026-11-15', payTo: PAY_TO, number: invoiceNumber(0), billed: 0, by: 'quae', now: NOW, ...fields,
});
const receipt = (fields = {}) => ({ key: 'ethereum:0x22:0', to: PAY_TO.address, network: 'ethereum', asset: 'USDC', amount: '1200.0', timestamp: NOW, ...fields });

describe('an invoice bills a won deal, to where the operator said', () => {
  test('issued: numbered, totalled, the operator\'s address snapshotted on it', () => {
    const v = issue();
    expect(v).toMatchObject({ number: 'INV-0001', company: 'Tidewater', buyer: 'Port of <Brine>', total: 1200, currency: 'USD', due: '2026-11-15', payTo: PAY_TO });
    expect(v.id).toMatch(/^v-[a-f0-9]{8}$/);
  });

  test('refused: a deal not won, no address set, a currency the wallet cannot take, a bill past the deal, a due date gone', () => {
    expect(() => issue({ deal: deal({ stage: 'proposed' }) })).toThrow(/an invoice bills a deal the Mercator won/);
    expect(() => issue({ payTo: null })).toThrow(/no being writes payment details/);
    expect(() => issue({ deal: deal({ value: { amount: 1200, currency: 'EUR' } }) })).toThrow(/takes USD .* or ETH today/);
    expect(() => issue({ billed: 400.5 })).toThrow(/would bill past it/);
    expect(() => issue({ lines: [] })).toThrow(/lines: 1 to 20/);
    expect(() => issue({ lines: [{ what: 'x', amount: 5 }] })).toThrow(/lines\[0\]\.what/);
    expect(() => issue({ due: '2026-10-29' })).toThrow(/today or later/);
  });

  test('the fold, the bill, overdue', () => {
    const v = issue();
    const { invoices } = foldInvoices([{ type: 'issued', invoice: v, at: NOW }, { type: 'paid', id: 'v-nope', receipt: 'k', by: 'q', at: NOW }]);
    expect(invoices[0]).toMatchObject({ status: 'open', paid: null });
    expect(billedFor(invoices, v.dealId)).toBe(1200);
    expect(overdue(invoices[0], Date.parse('2026-11-15T12:00:00Z'))).toBe(false);
    expect(overdue(invoices[0], Date.parse('2026-11-16T00:00:01Z'))).toBe(true);
  });

  test('paid only by a receipt at its address, on its network, in its money, for its total — one receipt, one invoice', () => {
    const v = issue();
    const { invoices } = foldInvoices([{ type: 'issued', invoice: v, at: NOW }]);
    const paid = (r) => judgePaid(invoices, { invoiceId: v.number, receipt: r, by: 'quae', now: NOW });
    expect(paid(null).reason).toMatch(/has not landed/);
    expect(paid(receipt({ to: '0x0000000000000000000000000000000000000001' })).reason).toMatch(/not INV-0001's/);
    expect(paid(receipt({ network: 'base' })).reason).toMatch(/on base/);
    expect(paid(receipt({ asset: 'ETH' })).reason).toMatch(/holds 1200.0 ETH/);
    expect(paid(receipt({ amount: '1199.99' })).reason).toMatch(/holds 1199.99 USDC; INV-0001 is 1200 USD/);
    const ok = paid(receipt({ asset: 'DAI', to: PAY_TO.address.toLowerCase() }));
    expect(ok).toEqual({ ok: true, event: { type: 'paid', id: v.id, receipt: 'ethereum:0x22:0', by: 'quae', at: NOW } });
    const after = foldInvoices([{ type: 'issued', invoice: v, at: NOW }, ok.event]).invoices;
    expect(judgePaid(after, { invoiceId: v.id, receipt: receipt(), by: 'quae', now: NOW }).reason).toBe('INV-0001 is already paid');
    const second = { ...issue(), id: 'v-00000002', number: 'INV-0002' };
    const both = foldInvoices([{ type: 'issued', invoice: v, at: NOW }, ok.event, { type: 'issued', invoice: second, at: NOW }]).invoices;
    expect(judgePaid(both, { invoiceId: 'INV-0002', receipt: receipt(), by: 'quae', now: NOW }).reason).toMatch(/one receipt, one invoice/);
    expect(unmatchedFor(both[1], [receipt(), receipt({ key: 'k2' })], both).map((r) => r.key)).toEqual(['k2']);
  });

  test('voided with why, only while open', () => {
    const v = issue();
    const { invoices } = foldInvoices([{ type: 'issued', invoice: v, at: NOW }]);
    expect(judgeVoid(invoices, { invoiceId: v.id, reason: 'no', by: 'operator', now: NOW }).reason).toMatch(/reason/);
    const voided = judgeVoid(invoices, { invoiceId: v.id, reason: 'billed the wrong buyer', by: 'operator', now: NOW });
    expect(voided.ok).toBe(true);
    const after = foldInvoices([{ type: 'issued', invoice: v, at: NOW }, voided.event]).invoices;
    expect(billedFor(after, v.dealId)).toBe(0);
    expect(judgeVoid(after, { invoiceId: v.id, reason: 'again and again', by: 'operator', now: NOW }).reason).toMatch(/only an open invoice/);
  });

  test('the page the customer reads: the operator\'s address, the total, the disclosure — every being\'s word escaped', () => {
    const html = invoiceHtml({ ...issue({ note: 'Net 15 <script>alert(1)</script>' }) });
    expect(html).toContain('Invoice INV-0001');
    expect(html).toContain('Billed to Port of &lt;Brine&gt;');
    expect(html).toContain(`<code>${PAY_TO.address}</code>`);
    expect(html).toContain('Pay 1,200.00 USD in USDC, USDT or DAI on Ethereum mainnet to');
    expect(html).toContain('prepared by an AI agent team working for Tidewater');
    expect(html).not.toContain('<script>');
  });

  test('the Quaestor\'s briefing: the deal to bill, the open invoice and the receipt that may be its', () => {
    const v = issue();
    const lines = invoiceBriefingLines({ deals: [deal(), deal({ id: 'd-11111111', buyer: 'Wharf Co', value: { amount: 90, currency: 'USD' } })], invoices: foldInvoices([{ type: 'issued', invoice: v, at: NOW }]).invoices, receipts: [receipt()], payTo: PAY_TO, nowMs: Date.parse(NOW) });
    expect(lines).toContain('- to bill: deal [d-11111111] Wharf Co, won at 90 USD; billed 0 — treasury/invoice');
    expect(lines).toContain(`- open: INV-0001 [${v.id}] Port of <Brine> 1200 USD, due 2026-11-15`);
    expect(lines).toContain('  - a receipt that may be its: 1200.0 USDC on 2026-10-30, key ethereum:0x22:0 — treasury/invoice-paid if it is');
    expect(invoiceBriefingLines({ deals: [deal()], invoices: [], receipts: [], payTo: null, nowMs: 0 })[2]).toMatch(/has not set where invoices are paid/);
  });
});

describe('the delivery door: the operator\'s folder, an https address, an unguessable path', () => {
  test('the destination', () => {
    expect(() => destinationOf({ folder: 'deliveries', linkBase: 'https://x.example' })).toThrow(/full path/);
    expect(() => destinationOf({ folder: '/srv/d', linkBase: 'http://x.example' })).toThrow(/https/);
    expect(destinationOf({ folder: '/srv/d/', linkBase: 'https://files.example.com/deliveries/' })).toEqual({ folder: '/srv/d', linkBase: 'https://files.example.com/deliveries' });
  });

  test('a place and its link: the company, the token, a safe name', () => {
    const d = destinationOf({ folder: '/srv/d', linkBase: 'https://files.example.com/out' });
    expect(placeOf(d, { company: 'c-abc', token: 'ff00', name: 'Q4 report (final).pdf' }))
      .toEqual({ file: '/srv/d/c-abc/ff00/Q4-report-final-.pdf', link: 'https://files.example.com/out/c-abc/ff00/Q4-report-final-.pdf' });
    expect(safeName('../../etc/passwd')).toBe('etc-passwd');
  });

  test('the Mercator\'s briefing: each won deal\'s invoice and what reached the buyer', () => {
    const v = issue();
    const text = mercatorBriefingText({
      deals: [{ ...deal(), movedAt: NOW, nextStep: 'deliver', leadId: null }], leads: [], now: Date.parse(NOW),
      invoices: [{ ...v, status: 'open' }], deliveries: [{ id: 'p-1', dealId: v.dealId, invoiceId: v.id, name: 'INV-0001.html', link: 'https://files.example.com/out/x/INV-0001.html' }],
      destination: null,
    });
    expect(text).toContain('the operator has not yet chosen where deliveries go');
    expect(text).toContain(`  - invoice INV-0001 [${v.id}] 1200 USD, open, published`);
    expect(text).toContain('  - published INV-0001.html: https://files.example.com/out/x/INV-0001.html');
  });
});

describe('on the desk', () => {
  const noop = () => {};
  test('INVOICES: unset says nothing can be issued; an open invoice offers the receipt that may pay it, and a VOID that names why', () => {
    const unset = renderToStaticMarkup(createElement(InvoicesSection, { invoices: { payTo: null, invoices: [] }, drafts: {}, busy: false, onDraft: noop, onPayTo: noop, onPaid: noop, onVoid: noop }));
    expect(unset).toContain('WHERE INVOICES ARE PAID IS NOT SET — NO INVOICE CAN BE ISSUED UNTIL YOU SET IT');
    expect(unset).toMatch(/<button[^>]*disabled=""[^>]*>SET WHERE INVOICES ARE PAID<\/button>/);
    const v = { ...issue(), status: 'open', overdue: true, paid: null, voided: null, candidates: [{ key: 'ethereum:0x22:0', amount: '1200.0', asset: 'USDC', at: NOW }] };
    const html = renderToStaticMarkup(createElement(InvoicesSection, { invoices: { payTo: PAY_TO, invoices: [v] }, drafts: {}, busy: false, onDraft: noop, onPayTo: noop, onPaid: noop, onVoid: noop }));
    expect(html).toContain(`PAID TO: <span class="tre-exact">${PAY_TO.address}</span> ON ETHEREUM`);
    expect(html).toContain('INV-0001 — Port of &lt;Brine&gt; — 1,200.00 USD — DUE 2026-11-15 — OVERDUE');
    expect(html).toContain('>PAID BY 1,200 USDC ON 2026-10-30</button>');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>VOID<\/button>/);
  });

  test('SALES: where deliveries go, and every link delivered on a won deal', () => {
    const sales = {
      mercator: { laneId: 'merc' }, pipeline: { qualified: { count: 0, value: {} }, proposed: { count: 0, value: {} }, won: { count: 1, value: { USD: 1200 } }, lost: { count: 0, value: {} } },
      deals: [deal()], destination: { folder: '/srv/d', linkBase: 'https://files.example.com/out' },
      deliveries: [{ id: 'p-1', dealId: deal().id, name: 'INV-0001.html', link: 'https://files.example.com/out/c/t/INV-0001.html' }],
    };
    const html = renderToStaticMarkup(createElement(SalesSection, { sales, names: { merc: 'Marin' }, pick: '', busy: false, onPick: noop, onSeat: noop, onClear: noop, drafts: {}, onDraft: noop, onDestination: noop }));
    expect(html).toContain('INTO <span class="cline-exact">/srv/d</span> · SERVED AT <span class="cline-exact">https://files.example.com/out</span>');
    expect(html).toContain('Port of &lt;Brine&gt; — WON, 1200 USD');
    expect(html).toContain('href="https://files.example.com/out/c/t/INV-0001.html"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>CHANGE WHERE DELIVERIES GO<\/button>/);
  });
});
