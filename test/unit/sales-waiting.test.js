/**
 * THE SALES OFFICE'S DECISIONS IN WAITING ON YOU (RULE 0, nothing faked): the
 * real rows over real sheets, audiences and models, the real position map that
 * files them under SALES, and the desk's own selector for where each lands.
 */
import { describe, test, expect } from 'vitest';
import { salesWaitingRows } from '../../backend/services/sales/sales-waiting.js';
import { makeSalesSheet, foldSalesFacts } from '../../backend/services/sales/sales-facts.js';
import { foldModels } from '../../backend/services/positions/business-model.js';
import { officeOfWaiting } from '../../backend/services/positions/position-map.js';
import { foldWaiting } from '../../backend/services/waiting/waiting-fold.js';
import { KIND_LABEL, cardSelector } from '../../frontend/app/RelinkShell/waiting/waiting-view.js';
import { jumpActions } from '../../frontend/app/RelinkShell/waiting/waiting-jump.js';

const NOW = '2026-11-16T09:00:00.000Z';
const names = new Map([['merc', 'Firepos']]);
const sheet = makeSalesSheet({ by: 'merc', now: NOW, facts: [1, 2, 3].map((i) => ({ company: 'ignis', claim: `A true thing number ${i} about Ignis`, source: 'https://ignislabs.ai' })) });
const draft = { id: 's-aaaaaaaa', name: 'Crypto teams needing an audit', state: 'draft', by: 'merc', filedAt: NOW };
const live = { id: 's-bbbbbbbb', name: 'Base token teams', state: 'approved', by: 'merc', filedAt: NOW };
const found = (id, extra = {}) => ({ id, segmentId: live.id, match: 3, stage: 'found', foundAt: NOW, ...extra });
const MODEL = { sells: 'Audits', buyer: 'Crypto teams', problem: 'Unaudited code', value: 'A signed report', price: 'Per engagement', proof: '', next: '' };
const models = foldModels([{ type: 'filed', company: 'ignis', model: MODEL, by: 'merc', at: NOW }]);
const companies = [{ id: 'ignis', name: 'Ignis AI Labs' }, { id: 'umbrae', name: 'Umbrae' }];

describe('the sales office\'s decisions wait where every decision waits', () => {
  const rows = salesWaitingRows({ facts: foldSalesFacts([{ type: 'facts', sheet }]), segments: [draft, live], prospects: [found('p-1'), found('p-2'), found('p-3', { listApproved: true }), found('p-4', { match: 1 })], models, companies }, names);

  test('a facts sheet, a draft audience, a list to approve and a filed business model each make one row, opening its own tab', () => {
    expect(rows.map((r) => [r.kind, r.title, r.where.tab])).toEqual([
      ['sales-facts', '3 facts a buyer may be told wait for your approval', 'model'],
      ['sales-audience', 'Audience "Crypto teams needing an audit" waits for your approval', 'campaigns'],
      ['sales-list', '2 companies found for "Base token teams" wait for your list approval', 'campaigns'],
      ['business-model', 'The business model of Ignis AI Labs waits for your approval', 'model'],
    ]);
    expect(rows.every((r) => r.where.app === 'positions' && r.where.office === 'cro' && r.who?.name === 'Firepos' && r.at === NOW)).toBe(true);
    expect(new Set(rows.map((r) => r.id)).size).toBe(4);
    expect(foldWaiting(rows).count).toBe(4);
  });

  test('once decided, nothing waits: a reviewed sheet, an approved list, an approved model', () => {
    const decided = salesWaitingRows({
      facts: foldSalesFacts([{ type: 'facts', sheet }, { type: 'reviewed', sheetId: sheet.id, verdict: 'approved', at: NOW }]),
      segments: [{ ...draft, state: 'approved' }, live], prospects: [found('p-3', { listApproved: true })],
      models: foldModels([{ type: 'filed', company: 'ignis', model: MODEL, by: 'operator', at: NOW }]), companies,
    }, names);
    expect(decided).toEqual([]);
    expect(salesWaitingRows({ facts: null, segments: [], prospects: [], models: new Map(), companies: [] }, names)).toEqual([]);
  });

  test('each row stands under SALES, is named on the desk, and lands on its own record in the POSITIONS window', () => {
    const holders = { cos: null, cro: 'merc', cmo: null, clo: null, cso: null, cfo: null, cao: null };
    expect(rows.map((r) => officeOfWaiting(r, holders))).toEqual(['cro', 'cro', 'cro', 'cro']);
    expect(rows.map((r) => KIND_LABEL[r.kind])).toEqual(['FACTS', 'AUDIENCE', 'LEAD LIST', 'BUSINESS MODEL']);
    expect(rows.map(cardSelector)).toEqual([
      '[data-window-id="positions"] [data-facts-sheet]',
      '[data-window-id="positions"] [data-segment-id="s-aaaaaaaa"]',
      '[data-window-id="positions"] [data-segment-id="s-bbbbbbbb"]',
      '[data-window-id="positions"] [data-model-company="ignis"]',
    ]);
    expect(jumpActions(rows[0], [])).toEqual([{ type: 'OPEN', id: 'positions' }]);
  });
});
