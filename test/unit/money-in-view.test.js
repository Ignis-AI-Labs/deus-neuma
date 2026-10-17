// money-in-view.test.js — the MONEY IN panel's display law (RULE 0, nothing
// faked): totals are formatted from the REAL summary function over real
// ledger rows built by the real row maker, so the panel reads exactly what the
// server computes; the panel itself rendered for real (react-dom/server).

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  periodStarts, formatUsd, totalLine, assetLines, memberLines, receiptLine, watchLine, sourceWords,
} from '../../frontend/app/RelinkShell/house-clock/money-in-view.js';
import { MoneyInSection } from '../../frontend/app/RelinkShell/house-clock/MoneyInSection.jsx';
import { summarizeMoneyIn } from '../../backend/services/money-in/money-in-summary.js';
import { makeReceipt } from '../../backend/services/money-in/receipt-rows.js';

const SOUL = '0x1111111111111111111111111111111111111111';
const PAYER = '0x2222222222222222222222222222222222222222';
const USDC = { symbol: 'USDC', decimals: 6, kind: 'erc20', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' };
const ETH = { symbol: 'ETH', decimals: 18, kind: 'native' };
const row = (over) => makeReceipt({
  network: 'base', asset: USDC, amountRaw: '2500000', from: PAYER, to: { address: SOUL, member: 'lane-quae', label: 'Quae' },
  block: 1, timestamp: Date.parse('2026-10-14T09:00:00Z') / 1000, txHash: `0x${'a'.repeat(64)}`, logIndex: 0, internal: false,
  detectedAt: '2026-10-14T09:05:00Z', ...over,
});

describe('money-in-view — the periods match the server\'s buckets', () => {
  it('this week starts Monday 00:00 UTC, this month the 1st', () => {
    // Friday 2026-10-16
    expect(periodStarts(Date.parse('2026-10-16T15:00:00Z'))).toEqual({ week: '2026-10-12T00:00:00.000Z', month: '2026-10-01T00:00:00.000Z' });
    // a Sunday still belongs to the week that began the Monday before
    expect(periodStarts(Date.parse('2026-10-18T23:59:00Z')).week).toBe('2026-10-12T00:00:00.000Z');
    expect(periodStarts(Date.parse('2026-10-19T00:00:00Z')).week).toBe('2026-10-19T00:00:00.000Z');
  });
});

describe('money-in-view — totals, unpriced counted apart', () => {
  const priced = { ...row({}), usd: 2.5 };
  const unpriced = row({ asset: ETH, amountRaw: '1000000000000000', txHash: `0x${'b'.repeat(64)}`, logIndex: null });
  const internal = { ...row({ txHash: `0x${'c'.repeat(64)}`, internal: true }), usd: 99 };
  const summary = summarizeMoneyIn([priced, unpriced, internal]);

  it('the line says the dollars, the count, and how many have no price', () => {
    expect(formatUsd(1234.5)).toBe('$1,234.50');
    expect(totalLine(summary)).toBe('$2.50 · 2 RECEIPTS · 1 UNPRICED (NOT IN THE $)');
    expect(totalLine(summarizeMoneyIn([priced]))).toBe('$2.50 · 1 RECEIPT');
    expect(totalLine(null)).toBe('—');
  });

  it('per asset and per member', () => {
    expect(assetLines(summary).map((a) => [a.words, a.usd])).toEqual([
      ['2.5 USDC ON BASE · 1 RECEIPT', '$2.50'],
      ['0.001 ETH ON BASE · 1 RECEIPT', '$0.00 + 1 UNPRICED'],
    ]);
    expect(memberLines(summary, { 'lane-quae': 'Quae' })).toEqual([{ key: 'lane-quae', who: 'Quae', words: '$2.50 · 2 RECEIPTS' }]);
  });

  it('a receipt line names the member, the payer, and a house-to-house move', () => {
    expect(receiptLine(priced, {})).toMatchObject({ amount: '2.5 USDC', usd: '$2.50' });
    expect(receiptLine(priced, {}).detail).toMatch(/^BASE · TO Quae · FROM 0x2222…2222 · /);
    expect(receiptLine(unpriced, {}).usd).toBe('UNPRICED');
    expect(receiptLine(internal, {}).detail).toContain('HOUSE TO HOUSE — NOT COUNTED');
  });

  it('the watch line and where an address came from', () => {
    expect(watchLine({ watched: [{}], unwatched: [{}, {}], lastScan: null })).toBe('1 WATCHED · 2 NOT WATCHED · NEVER SCANNED');
    expect(sourceWords('soul-anchor')).toBe('its public soul address');
    expect(sourceWords('founding-record:base')).toBe('the house founding record');
    expect(sourceWords('operator')).toBe('declared by you');
  });
});

describe('the MONEY IN panel, rendered — receive only', () => {
  it('totals, receipts, the unwatched and why, a scan button — and no way to send', () => {
    const summary = summarizeMoneyIn([{ ...row({}), usd: 2.5 }]);
    const html = renderToStaticMarkup(createElement(MoneyInSection, {
      money: {
        totals: { week: summary, month: summary, all: summary },
        receipts: [{ ...row({}), usd: 2.5 }],
        watch: { watched: [{ address: SOUL, member: 'lane-quae', label: 'Quae', source: 'soul-anchor' }], unwatched: [{ member: 'lane-cosi', reason: 'no public soul anchor yet' }], extras: [], lastScan: null },
        note: null,
      },
      names: { 'lane-quae': 'Quae' }, lanes: [{ neumaId: 'lane-quae', name: 'Quae' }],
      addr: { address: '', label: '', member: '' }, busy: false,
      onAddr: () => {}, onDeclare: () => {}, onRemove: () => {}, onScan: () => {},
    }));
    for (const text of ['THIS WEEK', 'THIS MONTH', 'ALL TIME', '$2.50 · 1 RECEIPT', 'SCAN NOW', 'NOT WATCHED', 'no public soul anchor yet', 'DECLARE']) {
      expect(html).toContain(text);
    }
    // every control on the panel: scan, declare, pick a member — none moves money
    const buttons = [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));
    expect(buttons).toEqual(['SCAN NOW', 'THE HOUSE', 'DECLARE']);
  });
});
