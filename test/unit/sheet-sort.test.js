/**
 * SORTING BY ANY COLUMN (sheet/sheet-view.js, sheet/Sheet.jsx) — Design note, 2026-11-18: […]. One press on a column's head orders every row of the sheet by
 * it (before paging), the next press turns it; figures read as numbers, words A to Z, a column of words that mean an
 * order (STRONG / WEAK / NO MATCH) by that order; an empty value stands last either way; a control does not sort.
 * Pure logic, then the real component through a real server render.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sortValue, sortableColumn, sortRows, nextSort } from '../../frontend/app/RelinkShell/sheet/sheet-view.js';
import { Sheet } from '../../frontend/app/RelinkShell/sheet/Sheet.jsx';
import { FIT_RANK } from '../../frontend/app/RelinkShell/company-line/sales-pipeline-view.js';

const col = (head, cell, extra = {}) => ({ head, cell, ...extra });
const rows = [
  { name: 'Harvey', fit: 'WEAK MATCH', hunter: '7,574 · 7,512 NAMED', at: '2026-11-17', rank: '#12,000', note: null },
  { name: 'luma', fit: 'STRONG MATCH', hunter: '35 · 32 NAMED', at: '2026-11-18', rank: '#900', note: 'x' },
  { name: 'Descript', fit: 'NO MATCH', hunter: '—', at: '2026-11-16', rank: null, note: null },
  { name: 'OpusClip', fit: 'STRONG MATCH', hunter: '4 · NONE NAMED', at: '2026-11-18', rank: '#40,000', note: null },
];
const names = (list) => list.map((r) => r.name);

describe('what a column sorts by', () => {
  it('a figure as a number (even with words after it), words in any case, a date as written; empty and controls are no value', () => {
    expect(sortValue(col('H', (r) => r.hunter), rows[0])).toBe(7574);
    expect(sortValue(col('R', (r) => r.rank), rows[1])).toBe(900);
    expect(sortValue(col('H', (r) => r.hunter), rows[2])).toBe(null);
    expect(sortValue(col('N', (r) => r.name), rows[1])).toBe('luma');
    expect(sortValue(col('D', (r) => r.at), rows[0])).toBe('2026-11-17');
    expect(sortValue(col('V', () => '0.1.180'), rows[0])).toBe('0.1.180');
    expect(sortValue(col('S', () => '1/12'), rows[0])).toBe('1/12');
    expect(sortValue(col('B', () => createElement('button')), rows[0])).toBe(null);
    expect(sortableColumn(col('B', () => createElement('button')), rows)).toBe(false);
    expect(sortableColumn(col('B', () => createElement('button'), { sort: (r) => r.name }), rows)).toBe(true);
  });
});

describe('ordering the whole sheet', () => {
  it('figures most first on the first press, words A to Z; the next press turns it; empty stays last both ways', () => {
    const hunter = col('AT HUNTER', (r) => r.hunter);
    expect(nextSort(null, 'AT HUNTER', hunter, rows)).toEqual({ head: 'AT HUNTER', dir: 'desc' });
    expect(names(sortRows(rows, hunter, 'desc'))).toEqual(['Harvey', 'luma', 'OpusClip', 'Descript']);
    expect(names(sortRows(rows, hunter, 'asc'))).toEqual(['OpusClip', 'luma', 'Harvey', 'Descript']);
    const name = col('NAME', (r) => r.name);
    expect(nextSort(null, 'NAME', name, rows)).toEqual({ head: 'NAME', dir: 'asc' });
    expect(nextSort({ head: 'NAME', dir: 'asc' }, 'NAME', name, rows)).toEqual({ head: 'NAME', dir: 'desc' });
    expect(names(sortRows(rows, name, 'asc'))).toEqual(['Descript', 'Harvey', 'luma', 'OpusClip']);
    expect(names(sortRows(rows, col('NOTE', (r) => r.note), 'asc'))).toEqual(['luma', 'Harvey', 'Descript', 'OpusClip']);
  });

  it('words that mean an order sort by that order: the highest fit first, ties in the order they came', () => {
    const fit = col('FIT', (r) => r.fit, { sort: (r) => FIT_RANK[r.fit] ?? null });
    expect(nextSort(null, 'FIT', fit, rows).dir).toBe('desc');
    expect(names(sortRows(rows, fit, 'desc'))).toEqual(['luma', 'OpusClip', 'Harvey', 'Descript']);
    expect(names(sortRows(rows, fit, 'asc'))).toEqual(['Descript', 'Harvey', 'luma', 'OpusClip']);
  });
});

describe('a checkbox column always stands first (Design note, 2026-11-18', () => {
  it('given second, it is drawn first — head and every row — and the row is still named by its own first column', () => {
    const html = renderToStaticMarkup(createElement(Sheet, {
      label: 'outbox', rows: rows.slice(0, 1), rowKey: (r) => r.name,
      columns: [col('FOR', (r) => r.name), col('OK', (r) => createElement('input', { type: 'checkbox', 'aria-label': `Send to ${r.name}` }), { check: true }), col('TO', (r) => r.hunter)],
    }));
    expect([...html.matchAll(/<th scope="col"[^>]*>(?:<button[^>]*>)?([A-Z]+)/g)].map((m) => m[1])).toEqual(['OK', 'FOR', 'TO']);
    expect(html).toContain('<tr data-sheet-row="Harvey"><td class="sheet-tick"><input type="checkbox" aria-label="Send to Harvey"/></td><th scope="row">Harvey</th>');
  });
});

describe('the sheet draws a press on every head that sorts', () => {
  it('a sortable head is a button marked unsorted; a control column is a plain head', () => {
    const html = renderToStaticMarkup(createElement(Sheet, {
      label: 'companies', rows, rowKey: (r) => r.name,
      columns: [col('COMPANY', (r) => r.name), col('FIT', (r) => r.fit, { sort: (r) => FIT_RANK[r.fit] ?? null }), col('PRESS', () => createElement('button', { type: 'button' }, 'GO'))],
    }));
    // The arrow is the stylesheet's (data-mark): the head's own words stay exactly the column's name.
    expect(html).toContain('<th scope="col" class="label-data" aria-sort="none"><button type="button" class="sheet-sort" title="Sort by COMPANY" data-sort="COMPANY" data-mark="↕">COMPANY</button></th>');
    expect(html).toContain('data-sort="FIT"');
    expect(html).toContain('<th scope="col" class="label-data">PRESS</th>');
  });
});
