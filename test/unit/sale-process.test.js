/**
 * THE SALE — ONE PROCESS (RULE 0, nothing faked): the real doctrine, the real position map and board fold, the
 * hub rendered for real. Blue Ocean, SPIN and the straight line are one sequence every seat reads, each stage
 * tied to a record the house really keeps.
 */
import { describe, test, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SALE_STAGES, SALE_LAWS, SALE_PARTS, saleProcessText, MAKOTO_LINE } from '../../backend/services/makoto.js';
import { POSITIONS } from '../../backend/services/positions/position-map.js';
import { foldBoard } from '../../backend/services/positions/position-board.js';
import { hubTabs, saleLine, stageIsMine } from '../../frontend/app/RelinkShell/positions/positions-view.js';
import { SaleProcess } from '../../frontend/app/RelinkShell/positions/SaleProcess.jsx';
import { doorPlan } from '../../frontend/app/RelinkShell/doors/door-plan.js';

const OFFICES = POSITIONS.map((p) => p.office);
const sale = { stages: SALE_STAGES, laws: SALE_LAWS, parts: SALE_PARTS };

describe('the sale is one process', () => {
  test('seven stages in order: Blue Ocean chooses the ground and the people, SPIN finds the need, the straight line carries it', () => {
    expect(SALE_STAGES.map((s) => [s.n, s.id, s.law])).toEqual([
      [1, 'ground', 'blue-ocean'], [2, 'audience', 'blue-ocean'], [3, 'open', 'straight-line'], [4, 'need', 'spin'],
      [5, 'certainty', 'straight-line'], [6, 'close', 'straight-line'], [7, 'keep', 'makoto'],
    ]);
    // The need is found before anything is pitched, and certainty comes before the ask.
    const at = (id) => SALE_STAGES.find((s) => s.id === id).n;
    expect(at('need')).toBeLessThan(at('certainty'));
    expect(at('certainty')).toBeLessThan(at('close'));
    expect(SALE_STAGES.every((s) => SALE_LAWS[s.law] && s.does.length > 40 && s.record.length > 10)).toBe(true);
    // It is the same doctrine the offices already quote, not a second one.
    for (const word of ['Blue Ocean', 'SPIN', 'straight line']) expect(MAKOTO_LINE).toContain(word);
  });

  test('every stage is worked by real seats and proved by a record the sales hub really has', () => {
    const sales = foldBoard({ holders: Object.fromEntries(OFFICES.map((o) => [o, null])), names: new Map(), waiting: [], connections: [] }).find((p) => p.office === 'cro');
    const tabs = hubTabs(sales).map((t) => t.id);
    for (const s of SALE_STAGES) {
      expect(s.seats.every((o) => OFFICES.includes(o)), s.id).toBe(true);
      expect(tabs, s.id).toContain(s.tab);
      expect(doorPlan({ kind: 'position', office: 'cro', tab: s.tab })).toMatchObject({ open: 'positions', position: { office: 'cro', tab: s.tab } });
    }
    // Every seat of the house has a part, and the sales seat works every stage but the first.
    expect(Object.keys(SALE_PARTS).sort()).toEqual([...OFFICES].sort());
    expect(SALE_STAGES.filter((s) => s.seats.includes('cro')).map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  test('each seat holder reads the same seven stages, its own marked, and its part; a lane with no seat reads nothing', () => {
    const sales = saleProcessText(['cro']);
    expect(sales).toMatch(/^## THE SALE — one process for every company of this house \(Blue Ocean, then SPIN, then the straight line\)\n1\. CHOOSE THE GROUND \[BLUE OCEAN\] — YOURS: /);
    expect(sales.match(/— YOURS/g)).toHaveLength(7);
    expect(sales).toContain('4. FIND THE NEED [SPIN] — YOURS: Ask about the problem, then what it costs them, then what fixing it would be worth');
    expect(sales).toContain('Never, at any stage: pressure, false urgency or scarcity, a claim not on the approved facts, a second push after a clear no, posing as human.');
    expect(sales).toContain('Your part: carry each buyer through stages 2 to 7 yourself. A stage whose proof is missing has not happened');
    const law = saleProcessText(['clo']);
    expect(law.match(/— YOURS/g)).toHaveLength(1);
    expect(law).toContain('5. BUILD CERTAINTY [STRAIGHT LINE] — YOURS');
    expect(law).toContain('Your part: hold the never-list and the laws at every stage');
    // The stages are word for word the same for every seat: only the marks and the part differ.
    const bare = (t) => t.replaceAll(' — YOURS', '').split('\n').slice(0, 9).join('\n');
    for (const office of OFFICES) expect(bare(saleProcessText([office])), office).toBe(bare(sales));
    expect([saleProcessText([]), saleProcessText(['nope']), saleProcessText(null)]).toEqual(['', '', '']);
  });

  test('every hub carries the process as one line, and opens it as a rail with this seat\'s stages lit', () => {
    expect(saleLine(sale, 'cfo')).toEqual(['7 STAGES', { text: 'THIS SEAT WORKS 5, 6', tone: 'on' }]);
    expect(saleLine(sale, 'cso')).toEqual(['7 STAGES', 'THIS SEAT GUARDS EVERY STAGE']);
    expect([stageIsMine(SALE_STAGES[3], 'cro'), stageIsMine(SALE_STAGES[3], 'cmo')]).toEqual([true, false]);
    const html = renderToStaticMarkup(createElement(SaleProcess, { sale, position: { office: 'cfo' }, onDoor: () => {} }));
    expect(html).toContain('data-fold="sale:cfo"');
    expect(html.match(/data-sale-stage=/g)).toHaveLength(7);
    expect(html.match(/pos-sale-stage is-mine/g)).toHaveLength(2);
    expect(html).toContain('PROOF: THE DEAL, WON OR LOST, WITH WHY');
    expect(html).toContain('THIS SEAT&#x27;S PART: set the price and terms said at stage 5, and see the money in at stage 6.');
    expect(renderToStaticMarkup(createElement(SaleProcess, { sale: null, position: { office: 'cfo' } }))).toBe('');
  });
});
