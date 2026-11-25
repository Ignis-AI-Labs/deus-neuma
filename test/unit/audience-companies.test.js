/**
 * AN AUDIENCE'S COMPANIES AS ONE LIST — Design note, 2026-11-16: […] The pure view: every company once, counted by
 * country, by size and by traffic, a hundred to a page.
 */
import { describe, test, expect } from 'vitest';
import { companyRows, breakdown, trafficCount, companiesLine, trafficShort, standingWords, isDeadEnd } from '../../frontend/app/RelinkShell/company-line/audience-companies-view.js';
import { sheetPage, rangeWords, SHEET_PAGE } from '../../frontend/app/RelinkShell/sheet/sheet-view.js';

const gathered = [
  { domain: 'coinbase.com', name: 'Coinbase', signal: '1001-5000 people', categories: ['financial services'], country: 'US', size: '1001-5000', trafficRank: 188 },
  { domain: 'quiet.example', name: 'Quiet Harbor', description: 'A small studio', categories: ['computer software'], country: 'US', size: '1-10', trafficRank: null },
  { domain: 'wise.com', name: 'Wise', signal: 's', categories: ['financial services'], country: 'GB', size: '5001-10000', trafficRank: 901 },
  { domain: 'old.example', name: 'Old Gather', signal: 'gathered before traffic was known', categories: [] },
];
const pool = [{ domain: 'wise.com', name: 'Wise', match: 3, country: 'GB', people: [{ name: 'A' }] }, { domain: 'handread.example', name: 'Hand Read', match: 2, country: 'unknown', people: [] }];
const leads = [{ domain: 'coinbase.com', name: 'Coinbase', match: 3, country: 'US', people: [{ name: 'B' }, { name: 'C' }] }];

describe('an audience\'s companies', () => {
  test('every company stands once, the furthest along first, then the most visited', () => {
    const rows = companyRows({ gathered, pool, leads });
    expect(rows.map((r) => [r.domain, r.standing, r.rank])).toEqual([['coinbase.com', 'lead', 188], ['wise.com', 'strong', 901], ['handread.example', 'weak', null], ['old.example', 'gathered', null], ['quiet.example', 'gathered', null]]);
    expect(rows[0]).toMatchObject({ people: 2, size: '1001-5000', industry: 'financial services', about: '1001-5000 people', site: 'https://coinbase.com' });
    expect(rows.find((r) => r.domain === 'quiet.example').about).toBe('A small studio');
    expect(companyRows()).toEqual([]);
  });

  test('it is counted by country, by size and by traffic; a company never looked up is not called dead', () => {
    const rows = companyRows({ gathered, pool, leads });
    const b = breakdown(rows);
    expect(b.geography.map((g) => [g.label, g.n])).toEqual([['US', 2], ['GB', 1], ['unknown', 2]]);
    expect(b.geography[0].share).toBe(1);
    expect(b.size.map((s) => s.label)).toEqual(['1-10', '1001-5000', '5001-10000', 'unknown']);
    expect(b.standing.map((s) => [s.label, s.n])).toEqual([['ON THE LEAD LIST', 1], ['STRONG MATCH', 1], ['WEAK MATCH', 1], ['GATHERED — NOT SCORED YET', 2]]);
    expect(trafficCount(rows)).toEqual({ checked: 3, live: 2, quiet: 1 });
    expect(companiesLine(rows)).toEqual(['5 COMPANIES', '2 NOT SCORED YET', { text: '1 STRONG', tone: 'on' }, { text: '1 ON THE LEAD LIST', tone: 'on' }, '2 WITH TRAFFIC', { text: '1 WITH NONE', tone: 'alert' }]);
    expect([trafficShort(323181), trafficShort(null), standingWords('strong')[0]]).toEqual(['#323,181', 'NO TRAFFIC', 'STRONG MATCH']);
  });

  test('dead ends can be left out; a company never looked up is not one', () => {
    const rows = companyRows({ gathered, pool, leads });
    expect(rows.filter((r) => !isDeadEnd(r)).map((r) => r.domain)).toEqual(['coinbase.com', 'wise.com', 'handread.example', 'old.example']);
  });
});

describe('a sheet pages itself', () => {
  test('a hundred rows a page, the last page short, a page past the end is the last', () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ i }));
    expect(sheetPage(many)).toMatchObject({ total: 250, page: 0, pages: 3, from: 1, to: SHEET_PAGE });
    expect(sheetPage(many, 2)).toMatchObject({ from: 201, to: 250 });
    expect(sheetPage(many, 99).page).toBe(2);
    expect(sheetPage([])).toMatchObject({ total: 0, from: 0, to: 0, pages: 1 });
    expect(rangeWords(sheetPage(Array.from({ length: 3385 }, () => ({})), 0))).toBe('SHOWING 1–100 OF 3,385');
  });
});
