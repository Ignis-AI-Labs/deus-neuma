/**
 * Every platform stays in MARKETING's view whatever its accounts are doing
 * (platform-row.js, PlatformRow.jsx), and a locked keys file reads as LOCKED
 * on the health strip — never an empty house read as OK (marketing-health.js).
 * Real inputs, real outputs, a real react-dom render; no mock.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { platformRow } from '../../frontend/app/RelinkShell/marketing/platform-row.js';
import { PlatformRow, LockedKeys } from '../../frontend/app/RelinkShell/marketing/PlatformRow.jsx';
import { marketingHealth } from '../../frontend/app/RelinkShell/marketing/marketing-health.js';
import { MARKETING_PLATFORMS } from '../../frontend/app/windowing/retired-windows.js';

const COMPANIES = new Set(['northwind']);
const ACCOUNTS = [
  { id: 'x-1', channelId: 'x', companyId: 'northwind' },
  { id: 'x-2', channelId: 'x', companyId: 'brookmere' },
  { id: 'tiktok-1', channelId: 'tiktok', companyId: 'northwind' },
  { id: 'bluesky-1', channelId: 'bluesky', companyId: null },
];
const CHECK = { accounts: [
  { id: 'x-1', inUse: true, clear: true },
  { id: 'x-2', inUse: true, clear: false },
  { id: 'tiktok-1', inUse: true, clear: true },
] };
const LOCKED = { why: 'the house\'s keys file can\'t be opened with the key this desk holds — it was sealed under another key; it is untouched' };
const byId = (row) => Object.fromEntries(row.map((p) => [p.channelId, p]));

describe('the platform row — every platform, always', () => {
  it('at the house: every MARKETING platform in its order, each marked by how its accounts stand', () => {
    const row = platformRow({ accounts: ACCOUNTS, check: CHECK, scope: null, locked: null });
    expect(row.map((p) => p.channelId)).toEqual([...MARKETING_PLATFORMS]);
    const p = byId(row);
    expect(p.x).toMatchObject({ state: 'failing', count: 2, accountId: 'x-1' });
    expect(p.tiktok).toMatchObject({ state: 'clear', count: 1, accountId: 'tiktok-1' });
    expect(p.bluesky).toMatchObject({ state: 'idle', count: 1 });
    expect(p.youtube).toMatchObject({ state: 'none', count: 0, accountId: null });
  });

  it('at a company: only its own accounts count, and the other platforms still stand', () => {
    const p = byId(platformRow({ accounts: ACCOUNTS, check: CHECK, scope: COMPANIES, locked: null }));
    expect(p.x).toMatchObject({ state: 'clear', count: 1 });
    expect(p.bluesky).toMatchObject({ state: 'none', count: 0 });
    expect(Object.keys(p)).toHaveLength(MARKETING_PLATFORMS.length);
  });

  it('with the keys file locked and no account readable, every platform still stands, LOCKED', () => {
    const row = platformRow({ accounts: [], check: null, scope: null, locked: LOCKED });
    expect(row.map((p) => p.channelId)).toEqual([...MARKETING_PLATFORMS]);
    expect(row.every((p) => p.state === 'locked')).toBe(true);
    expect(byId(row).tiktok.title).toMatch(/TIKTOK — the house's keys file can't be opened/);
  });

  it('draws one press per platform, and KEYS LOCKED with its door', () => {
    const row = platformRow({ accounts: [], check: null, scope: null, locked: LOCKED });
    const html = renderToStaticMarkup(createElement(PlatformRow, { row, onOpen: () => {} }));
    for (const id of MARKETING_PLATFORMS) expect(html).toContain(`data-platform="${id}"`);
    // The logo says which; the name and its standing ride the hover and the screen reader, never the tab's words.
    expect(html).toMatch(/aria-label="TIKTOK — the house&#x27;s keys file can&#x27;t be opened/);
    expect(html.match(/data-platform-state="locked"/g)).toHaveLength(MARKETING_PLATFORMS.length);
    const banner = renderToStaticMarkup(createElement(LockedKeys, { locked: LOCKED }));
    expect(banner).toContain('KEYS LOCKED');
    expect(banner).toContain('CHANNEL KEYS');
    expect(banner).toContain('UNLOCK');
    expect(banner).toContain('START FRESH');
  });
});

describe('the health strip under the lock — FAULT, never OK', () => {
  const data = { queue: [], campaigns: [], results: { posts: {}, unavailable: {}, capability: {}, links: null }, links: [], site: null, check: null };
  it('ACCOUNTS is a FAULT reading LOCKED, its door the ACCOUNTS tab', () => {
    const cells = marketingHealth({ data, waiting: { items: [] }, accounts: [], locked: LOCKED, scope: null, now: Date.now() });
    expect(cells.find((c) => c.part === 'accounts')).toMatchObject({ level: 'fault', value: 'LOCKED', door: { kind: 'tab', tab: 'accounts' } });
  });

  it('LINKS is a FAULT when the site token sits in the locked file — never OFF', () => {
    const cells = marketingHealth({ data: { ...data, site: { configured: false, locked: LOCKED } }, waiting: { items: [] }, accounts: [], locked: LOCKED, scope: null, now: Date.now() });
    expect(cells.find((c) => c.part === 'links')).toMatchObject({ level: 'fault', value: 'LOCKED' });
  });
});
