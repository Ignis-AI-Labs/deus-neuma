/**
 * AN APPROVED FACT STAYS APPROVED, ON SCREEN (LeadFactsSheet.jsx over sales-facts.js) — Design note, 2026-11-18: […]. A new
 * sheet carries every fact approved before: it stands ticked and locked as APPROVED BEFORE, and the bar's counts and
 * APPROVE ALL NEW cover only what waits. The real component through a real server render, over the real fold.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { makeSalesSheet, foldSalesFacts } from '../../backend/services/sales/sales-facts.js';
import { salesWaitingRows } from '../../backend/services/sales/sales-waiting.js';
import { LeadFactsSheet } from '../../frontend/app/RelinkShell/company-line/LeadFactsSheet.jsx';

const NOW = '2026-11-18T10:00:00.000Z';
const fact = (claim, source = 'https://umbrae.io') => ({ company: 'umbrae', claim, source });
const first = makeSalesSheet({ facts: [fact('Umbrae is a concentrated liquidity platform on Base'), fact('Liquidity providers keep most of every swap fee'), fact('Anyone can list a token or pair for free')], by: 'm', now: NOW });
const second = makeSalesSheet({ facts: [...first.facts.map((f) => fact(f.claim, 'document: operator, 2026-11-18')), fact('The Umbrae deck is at deck.umbrae.io', 'https://deck.umbrae.io')], by: 'm', now: NOW });
const state = foldSalesFacts([{ type: 'facts', sheet: first }, { type: 'reviewed', sheetId: first.id, verdict: 'approved', at: NOW }, { type: 'facts', sheet: second }]);

describe('a re-filed sheet asks only for what is new', () => {
  it('the three facts approved before stand ticked and locked; only the new one waits, and the bar counts only it', () => {
    expect(state.carried).toEqual([1, 2, 3]);
    const html = renderToStaticMarkup(createElement(LeadFactsSheet, { facts: state, companies: [{ id: 'umbrae', name: 'Umbrae' }], busy: false, onReview: () => {}, onChange: () => {} }));
    expect(html.match(/aria-label="Fact \d was approved before"[^>]*disabled=""[^>]*checked=""/g)).toHaveLength(3);
    expect(html).toContain('aria-label="Approve fact 4"');
    expect(html.match(/data-fact-standing="carried"/g)).toHaveLength(3);
    expect(html).toContain('APPROVED BEFORE');
    expect(html).toContain('APPROVE ALL NEW (1)');
    expect(html).toContain('0 OF 1 CHECKED');
    expect(html).toContain('1 NEW WAIT FOR YOUR APPROVAL · 3 APPROVED BEFORE');
  });

  it('WAITING ON YOU counts only the new fact', () => {
    const [row] = salesWaitingRows({ facts: state, segments: [], prospects: [], models: new Map(), companies: [] }, new Map());
    expect(row.title).toBe('1 new fact a buyer may be told waits for your approval');
  });
});
