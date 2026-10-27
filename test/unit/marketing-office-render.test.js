/**
 * The MARKETING window's own pieces through a real react-dom render (no
 * mock): the path (HOUSE first, every crumb above the current one a door),
 * the level's tabs, the company tiles drawn from the real fold, and the title
 * — which names the seat, never the being the chat is focused on.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConsciousnessProvider } from '../../frontend/app/RelinkShell/consciousness-context.js';
import { ZoomPath, OfficeTabs } from '../../frontend/app/RelinkShell/marketing/ZoomPath.jsx';
import { CompanyTiles } from '../../frontend/app/RelinkShell/marketing/CompanyTiles.jsx';
import { MarketingTitle } from '../../frontend/app/RelinkShell/marketing/MarketingTitle.jsx';
import { TABS, houseTiles } from '../../frontend/app/RelinkShell/marketing/zoom-fold.js';

const COMPANIES = [
  { id: 'northwind', name: 'Northwind', parentId: null, depth: 0, legalEntity: { name: 'Northwind Holdings LLC', jurisdiction: 'Delaware' } },
  { id: 'labs', name: 'Northwind Labs', parentId: 'northwind', depth: 1 },
  { id: 'studio', name: 'Northwind Studio', parentId: 'labs', depth: 2 },
];
const ACCOUNTS = [{ id: 'x-1', channelId: 'x', companyId: 'northwind' }, { id: 'bluesky-1', channelId: 'bluesky', companyId: null }];
const READ = {
  companies: COMPANIES, accounts: ACCOUNTS, check: { accounts: [{ id: 'x-1', inUse: true, clear: true }] },
  campaigns: [{ id: 'c1', companyId: 'labs', status: 'active', asks: [{ from: 'cmo', state: 'open' }] }],
  queue: [{ id: 'd1', accountId: 'x-1', status: 'draft' }],
};
const html = (el) => renderToStaticMarkup(el);
const noop = () => {};

describe('the path', () => {
  it('at HOUSE: HOUSE alone, and it is where you are', () => {
    const out = html(createElement(ZoomPath, { crumbs: [], onGo: noop }));
    expect(out).toContain('<span class="mkt-crumb is-here" aria-current="page">HOUSE</span>');
    expect(out).not.toContain('<button');
  });

  it('three levels down: HOUSE and every crumb above are doors; the last is where you are', () => {
    const out = html(createElement(ZoomPath, { crumbs: [{ id: 'northwind', name: 'Northwind' }, { id: 'labs', name: 'Northwind Labs' }, { id: 'studio', name: 'Northwind Studio' }], onGo: noop }));
    expect([...out.matchAll(/<button[^>]*class="mkt-crumb"[^>]*>([^<]*)</g)].map((m) => m[1])).toEqual(['HOUSE', 'Northwind', 'Northwind Labs']);
    expect(out).toContain('aria-current="page">Northwind Studio</span>');
    expect(out.match(/›/g)).toHaveLength(3);
  });
});

describe('the tabs', () => {
  it('HOUSE carries SEAT; a company the same five without it; the current one is marked', () => {
    const house = html(createElement(OfficeTabs, { tabs: TABS.house, on: 'seat', onTab: noop }));
    expect([...house.matchAll(/data-tab="(\w+)"/g)].map((m) => m[1])).toEqual(['board', 'campaigns', 'accounts', 'brand', 'leads', 'seat']);
    expect(house).toMatch(/aria-selected="true" data-tab="seat"/);
    const company = html(createElement(OfficeTabs, { tabs: TABS.company, on: 'board', onTab: noop }));
    expect(company).not.toContain('SEAT');
  });
});

describe('the tiles', () => {
  it('each tile draws its fold: name, legal form, subsidiaries indented by depth, marks, active, what waits', () => {
    const out = html(createElement(CompanyTiles, { tiles: houseTiles(READ), litLoose: false, onZoom: noop, onLoose: noop }));
    expect(out).toContain('data-company-tile="northwind"');
    expect(out).toContain('<span class="mkt-tile-legal">Northwind Holdings LLC · Delaware</span>');
    expect(out).toContain('<span style="padding-left:0px">└ Northwind Labs</span><span style="padding-left:16px">└ Northwind Studio</span>');
    expect(out).toContain('<i class="mko-mark is-clear">●</i><b>1</b>');
    // What each number counts is said once, above the tiles; a tile is marks and numbers.
    expect(out.match(/ACCOUNTS/g)).toHaveLength(1);
    expect(out.match(/ACTIVE/g)).toHaveLength(1);
    expect(out).toContain('<span class="mkt-segs" aria-hidden="true"><i class="is-on"></i></span><b>1</b><small>/1</small>');
    expect(out).toMatch(/<span data-wait="drafts" title="1 to decide"><span class="stm is-signal" data-status="draft" title="to decide"[^>]*>.*?<\/span><b>1<\/b><\/span>/);
    expect(out).toContain('<span data-wait="asks" title="1 asks for you"><small>ASKS</small><b>1</b></span>');
    // NO COMPANY: a tile of its own, no way to zoom (no ›), nothing waits there (the quiet mark).
    expect(out).toContain('data-company-tile="none" aria-pressed="false"');
    expect(out.split('data-company-tile="none"')[1]).not.toContain('mkt-tile-go');
    expect(out.split('data-company-tile="none"')[1]).toContain('mkt-waits is-clear');
  });

  it('a level with no companies draws no tile strip', () => {
    expect(html(createElement(CompanyTiles, { tiles: [], litLoose: false, onZoom: noop, onLoose: noop }))).toBe('');
  });
});

describe('the title', () => {
  it('names the seat — "—" before its first read — never the being in chat focus', () => {
    const out = html(createElement(ConsciousnessProvider, { value: { activeCompanion: { name: 'Halden' } } }, createElement(MarketingTitle)));
    expect(out).toBe('<span class="label-data relink-title-name">MARKETING // —</span>');
  });
});
