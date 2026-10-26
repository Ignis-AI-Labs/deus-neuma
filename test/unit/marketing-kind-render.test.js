/**
 * The MARKETING board's slice-4 panels through a real react-dom render
 * (BoardPanels.jsx → KindPanels.jsx, KindPanelsLog.jsx) over the real store
 * shapes: what each draws, the instruments it draws with, its empty state as
 * one short line and one door, "—" where nothing was read. Pure rendering:
 * real inputs, real markup, no mock (the two reads the WATCH and CMO LOG make
 * themselves are proven in real Chromium, marketing-panel-kinds-browser).
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CAPABILITY } from '../../backend/services/social/stats/stats-metrics.js';
import { BoardPanel } from '../../frontend/app/RelinkShell/marketing/BoardPanels.jsx';

const H = 36e5;
const NOW = Date.UTC(2026, 9, 24, 12);
const at = (ms) => new Date(NOW + ms).toISOString();
const ACCOUNTS = [
  { id: 'x-1', channelId: 'x', channelName: 'X', companyId: 'northwind' }, { id: 'bluesky-1', channelId: 'bluesky', channelName: 'Bluesky', companyId: 'northwind' },
  { id: 'telegram-1', channelId: 'telegram', channelName: 'Telegram', companyId: 'brookmere' },
];
const COMPANIES = [{ id: 'northwind', name: 'Northwind', parentId: null, depth: 0 }, { id: 'brookmere', name: 'Brookmere', parentId: null, depth: 0 }];
const QUEUE = [
  { id: 'p1', channelId: 'x', accountId: 'x-1', text: 'only the harness changed, and the score moved', status: 'sent', sentAt: at(-20 * H), url: 'https://x.com/i/status/1' },
  { id: 'p2', channelId: 'bluesky', accountId: 'bluesky-1', text: 'sky', status: 'sent', sentAt: at(-20 * H) },
  { id: 'd1', channelId: 'x', accountId: 'x-1', text: 'Thursday: the clip', status: 'draft', scheduledFor: at(30 * H) },
];
const DATA = {
  queue: QUEUE, links: [], campaigns: [],
  results: {
    capability: CAPABILITY, unavailable: {}, links: null,
    posts: { p1: { latest: { at: at(-H), metrics: { views: 4100, likes: 61, replies: 4 } }, series: [{ at: at(-H), metrics: { views: 4100, likes: 61, replies: 4 } }] } },
  },
};
const b = (extra = {}) => ({
  data: DATA, companies: COMPANIES, accounts: ACCOUNTS, levelAccounts: ACCOUNTS, now: NOW, onTab: () => {}, onOpenCampaign: () => {}, calm: null, mandate: null,
  names: { platforms: { x: 'X', bluesky: 'BLUESKY', telegram: 'TELEGRAM' }, accounts: {}, companies: { northwind: 'Northwind', brookmere: 'Brookmere' } },
  ...extra,
});
const html = (entry, extra) => renderToStaticMarkup(createElement(BoardPanel, { entry: { span: 6, ...entry }, b: b(extra) }));
const count = (out, re) => (out.match(re) || []).length;

describe('the new panels, rendered', () => {
  it('PLATFORM: its mark and name, the window aside, one trace per metric it shows, "—" with its reason', () => {
    const out = html({ kind: 'platform', scope: { companyId: null, platform: 'x' } });
    expect(out).toContain('data-part="platform:x"');
    expect(out).toContain('<span class="mkk-plat" data-platform="x"><svg');
    expect(out).toContain('<span class="sub-panel-aside">7 DAYS</span>');
    expect([...out.matchAll(/data-metric="(\w+)"/g)].map((m) => m[1])).toEqual(['views', 'likes', 'replies']);
    expect(out).toContain('<span class="hud-trace-now">4100');
    const sky = html({ kind: 'platform', scope: { companyId: null, platform: 'bluesky' }, show: ['likes'] });
    expect(sky).toContain('<span class="hud-trace-now">—');
    expect(sky).toContain('title="not read yet — the sweep reads new posts every 6 hours"');
  });

  it('PLATFORM on a platform that reports nothing: tracked-link clicks only; with no account: one line, + ACCOUNT', () => {
    const tg = html({ kind: 'platform', scope: { companyId: null, platform: 'telegram' } });
    expect(tg).toContain('data-mkk-traces="links"');
    expect([...tg.matchAll(/data-metric="(\w+)"/g)].map((m) => m[1])).toEqual(['clicks']);
    expect(tg).toContain('title="no tracked link in its posts — a Telegram bot cannot read a channel post&#x27;s views"');
    const none = html({ kind: 'platform', scope: { companyId: null, platform: 'tiktok' } });
    expect(none).toContain('No account<span class="door-btn is-shut mkk-door">+ ACCOUNT</span>');
  });

  it('TOP POSTS: the rank as a Bar against the top, who said it, where it stands, its own first words', () => {
    const out = html({ id: 'top-posts', kind: 'top-posts', scope: { companyId: null }, sort: 'views', count: 5 });
    expect(out).toContain('<span class="sub-panel-aside">BY SEEN</span>');
    expect(count(out, /data-top-post=/g)).toBe(1);
    expect(out).toContain('data-own-words="true" title="only the harness changed, and the score moved">only the harness changed, and the…</span>');
    expect(out).toContain('data-status="sent"');
    expect(out).toMatch(/<span class="hud-bar-name">1<\/span>.*<span class="hud-bar-text">4.1K<\/span>/);
    const empty = html({ id: 'top-posts', kind: 'top-posts', scope: { companyId: null, platform: 'tiktok' }, sort: 'views' });
    expect(empty).toContain('Nothing sent<button type="button" class="mko-link">CAMPAIGNS →</button>');
  });

  it('FUNNEL: one key, four steps on one axis, "—" where no post reported a step', () => {
    const out = html({ id: 'funnel:northwind', kind: 'funnel', scope: { companyId: null, company: 'northwind' } });
    expect(out).toContain('<span class="sub-panel-aside">Northwind</span>');
    expect([...out.matchAll(/data-step="(\w+)"/g)].map((m) => m[1])).toEqual(['reach', 'engaged', 'clicked', 'converted']);
    expect(count(out, /class="mkk-key"/g)).toBe(2);
    expect(count(out, /class="hud-legend"/g)).toBe(0);
    expect(out).toMatch(/data-step="reach"[^>]*title="X 4.1K \(1 of 1 posts\) · BLUESKY — \(0 of 1 posts\)"/);
    expect(out).toMatch(/data-step="clicked" title="CLICKED — no post here reported it">.*?<b class="mkk-step-total">—<\/b>/);
  });

  it('NEXT 7 DAYS: a lane per platform, each staged post a mark at its time and a door to its card', () => {
    const out = html({ kind: 'next-7-days', scope: { companyId: null } });
    expect([...out.matchAll(/data-lane="(\w+)"/g)].map((m) => m[1])).toEqual(['x', 'bluesky', 'telegram']);
    expect(out).toMatch(/<button type="button" class="mkk-week-post" data-week-post="d1" style="left:\d+\.\d+%"/);
    expect(out).toContain('data-status="draft"');
    expect(count(out, /class="mkk-week-day( is-today)?"/g)).toBe(7);
    expect(count(out, /is-today/g)).toBe(1);
    expect(out).toContain('<span class="sub-panel-aside">1</span>');
    expect(html({ kind: 'next-7-days', scope: { companyId: null } }, { levelAccounts: [] })).toContain('No account<button type="button" class="mko-link">ACCOUNTS →</button>');
  });

  it('CMO LOG: no CMO — one line and the SEAT door; seated — the mandate, the acts, the asks, the plan as marks and counts', () => {
    expect(html({ kind: 'cmo-log', scope: { companyId: null } })).toContain('No CMO<button type="button" class="mko-link">SEAT →</button>');
    const mandate = { seat: { laneId: 'kestrel', name: 'Kestrel' }, standing: 'paused', feed: [{ id: 'a1', at: at(-H), kind: 'act', what: 'Posted', status: 'sent' }] };
    const out = html({ kind: 'cmo-log', scope: { companyId: null } }, { mandate, data: { ...DATA, campaigns: [{ id: 'c1', name: 'Launch', asks: [{ id: 'k', from: 'cmo', state: 'open' }] }] } });
    expect(out).toContain('<span class="sub-panel-aside">Kestrel</span>');
    expect(out).toMatch(/data-log="mandate".*data-status="mandate-tripped".*<b>PAUSED<\/b>/);
    expect(out).toMatch(/data-log="acts" title="Posted 1 — DONE FOR YOU in SEAT">.*<b>1<\/b>/);
    expect(out).toMatch(/data-log="asks" title="open Launch">/);
    expect(out).toMatch(/data-log="plan" title="no weekly plan is locked">.*<b>—<\/b>/);
  });

  it('COMPANY WATCH: its title and company before its own read lands — never a sentence of waiting', () => {
    const out = html({ id: 'company-watch:northwind', kind: 'company-watch', scope: { companyId: null, company: 'northwind' } });
    expect(out).toContain('WATCH</span><span class="sub-panel-aside">Northwind</span>');
    expect(out).not.toContain('mkk-watch-row');
  });
});
