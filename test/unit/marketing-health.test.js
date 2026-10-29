/**
 * The MARKETING board's health strip (marketing-health.js) and its default
 * layout (marketing-board.js), on the real store shapes: a holding company
 * with a subsidiary and a separate client, accounts (one under no company),
 * the house check's rows, v2 campaigns, queue entries, the stats sweep's
 * results and pulls, the tracked links and the counter, the desk's waiting
 * items, the mandate's view — and the strip and panels through a real
 * react-dom render. Pure: real inputs, real outputs, no mock.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { marketingHealth, readSchedule, paceOf, ageWords } from '../../frontend/app/RelinkShell/marketing/marketing-health.js';
import { defaultBoard } from '../../frontend/app/RelinkShell/marketing/marketing-board.js';
import { HealthStrip } from '../../frontend/app/RelinkShell/HealthStrip.jsx';
import { BoardPanel } from '../../frontend/app/RelinkShell/marketing/BoardPanels.jsx';
import { gridOf } from '../../frontend/app/RelinkShell/marketing-overview/overview-fold.js';
import { campaignCard, linkTotals } from '../../frontend/app/RelinkShell/marketing-overview/results-fold.js';

const H = 36e5;
const NOW = Date.UTC(2026, 9, 24, 12);
const at = (ms) => new Date(NOW + ms).toISOString();
const COMPANIES = [
  { id: 'northwind', name: 'Northwind', parentId: null, rootId: 'northwind', depth: 0 },
  { id: 'labs', name: 'Northwind Labs', parentId: 'northwind', rootId: 'northwind', depth: 1 },
  { id: 'brookmere', name: 'Brookmere', parentId: null, rootId: 'brookmere', depth: 0 },
];
const ACCOUNTS = [
  { id: 'x-1', channelId: 'x', channelName: 'X', companyId: 'northwind' },
  { id: 'x-2', channelId: 'x', channelName: 'X', companyId: 'labs' },
  { id: 'bluesky-1', channelId: 'bluesky', channelName: 'Bluesky', companyId: null },
];
const WINDOW = { start: '2026-10-20', end: '2026-10-29' };
const CAMPAIGNS = [
  { id: 'c-on', name: 'Launch Week', companyId: 'northwind', status: 'active', goal: { kind: 'downloads' }, kpi: { metric: 'reach', target: 1000 }, window: WINDOW, asks: [{ from: 'cmo', state: 'open' }] },
  { id: 'c-behind', name: 'Labs Push', companyId: 'labs', status: 'active', kpi: { metric: 'reach', target: 10000 }, window: WINDOW, asks: [] },
  { id: 'c-none', name: 'No Goal', companyId: 'northwind', status: 'active', asks: [] },
  { id: 'c-draft', name: 'Later', companyId: 'brookmere', status: 'draft', asks: [] },
];
const sent = (id, accountId, campaignId) => ({ id, channelId: 'x', accountId, campaignId, status: 'sent', postId: `${id}-pid`, sentAt: at(-20 * H), createdAt: at(-21 * H) });
const QUEUE = [
  sent('p-on', 'x-1', 'c-on'), sent('p-be', 'x-2', 'c-behind'),
  { id: 'f1', channelId: 'x', accountId: 'x-1', status: 'failed', createdAt: at(-30 * H), error: 'X answered HTTP 503' },
  { id: 'a1', channelId: 'x', accountId: 'x-1', status: 'approved', scheduledFor: at(3 * H), createdAt: at(-H) },
  { id: 'd1', channelId: 'x', accountId: 'x-1', status: 'draft', legal: { open: 2 }, createdAt: at(-H) },
  { id: 'd2', channelId: 'x', accountId: 'x-2', status: 'draft', groupId: 'g', createdAt: at(-H) },
];
const reading = (views) => ({ latest: { at: at(-H), metrics: { views } }, series: [] });
const DATA = {
  campaigns: CAMPAIGNS,
  queue: QUEUE,
  results: { posts: { 'p-on': reading(900), 'p-be': reading(900) }, pulls: { 'p-on': at(-H), 'p-be': at(-30 * H) }, links: { at: at(-2 * H), counts: [] }, unavailable: {}, capability: {} },
  links: [{ code: 'k1', entryId: 'p-on', published: { state: 'published' } }, { code: 'k2', entryId: 'p-be' }],
  site: { configured: true, root: 'https://go.example' },
  check: { house: { clear: 1, total: 2, optional: 3 }, accounts: [
    { id: 'x-1', companyId: 'northwind', inUse: true, clear: true }, { id: 'x-2', companyId: 'labs', inUse: true, clear: false },
    { id: 'bluesky-1', companyId: null, inUse: false, clear: null }] },
};
const WAITING = { items: [
  { id: 'w1', kind: 'post', where: { entryId: 'd1' } }, { id: 'w2', kind: 'post', where: { entryId: 'd2' } },
  { id: 'w3', kind: 'campaign-ask', where: { campaignId: 'c-on' } }] };
const MANDATE = { view: { standing: 'active', mandate: { expiresAt: at(5 * 24 * H - H) } }, error: null };
const health = (over = {}) => marketingHealth({ data: DATA, errors: {}, waiting: WAITING, mandate: MANDATE, accounts: ACCOUNTS, scope: null, now: NOW, ...over });
const byPart = (cells) => Object.fromEntries(cells.map((c) => [c.part, c]));

describe('the health strip at HOUSE', () => {
  it('eight cells in order, each the one number that decides its level, and where its press goes', () => {
    const cells = health();
    expect(cells.map((c) => c.part)).toEqual(['you', 'accounts', 'queue', 'campaigns', 'results', 'links', 'legal', 'mandate']);
    const c = byPart(cells);
    expect([c.you.level, c.you.value, c.you.what]).toEqual(['warm', 3, '◇2 · 1 ASKS']);
    expect(c.you.door).toEqual({ kind: 'panel', panel: 'posts', filter: { status: 'draft' } });
    expect([c.accounts.level, c.accounts.value, c.accounts.what, c.accounts.door]).toEqual(['warm', '1/2', '◐1', { kind: 'tab', tab: 'accounts' }]);
    expect([c.queue.level, c.queue.value]).toEqual(['hot', 1]);
    expect(c.queue.what).toMatch(/^▲ · ○\d+ \S/);
    expect(c.queue.door.filter).toEqual({ status: 'failed' });
    expect([c.campaigns.level, c.campaigns.value, c.campaigns.what]).toEqual(['warm', '1/3', '1 BEHIND · 1 UNMEASURED']);
    expect(c.campaigns.door).toEqual({ kind: 'panel', panel: 'campaign:c-behind' });
    expect(c.campaigns.title).toContain('(4 in all)');
    expect([c.results.level, c.results.value, c.results.what, c.results.door]).toEqual(['hot', '1H', '1 DUE', { kind: 'read' }]);
    expect([c.links.level, c.links.value, c.links.what]).toEqual(['warm', '2H', '1 WAITING']);
    expect([c.legal.level, c.legal.value, c.legal.door.filter]).toEqual(['warm', 1, { status: 'draft', legal: true }]);
    expect([c.mandate.level, c.mandate.value, c.mandate.door]).toEqual(['ok', '5D', { kind: 'tab', tab: 'seat' }]);
  });

  it('the ◆ YOU hover keeps every count the WAITING ON YOU band showed', () => {
    expect(byPart(health()).you.title).toBe('◆ YOU — 2 to decide · 1 in groups · 1 asks for you · 1 legal marks · 1 failed · 1 accounts with no company');
  });
});

describe('the health strip at a company', () => {
  it('narrowed to the subtree; no LINKS (house-wide) and no MANDATE (the house\'s)', () => {
    const c = byPart(health({ scope: new Set(['labs']) }));
    expect(Object.keys(c)).toEqual(['you', 'accounts', 'queue', 'campaigns', 'results', 'legal']);
    expect([c.you.value, c.you.what]).toEqual([1, '◇1 · 0 ASKS']);
    expect(c.you.title).not.toContain('no company');
    expect([c.accounts.level, c.accounts.value]).toEqual(['hot', '0/1']);
    expect([c.queue.level, c.queue.value, c.queue.what]).toEqual(['ok', 0, '○0']);
    expect([c.campaigns.level, c.campaigns.value]).toEqual(['hot', '0/1']);
    expect([c.legal.level, c.legal.value]).toEqual(['ok', 0]);
  });

  it('a client company: nothing sent reads "—", never an OK it did not see', () => {
    const c = byPart(health({ scope: new Set(['brookmere']) }));
    expect([c.results.level, c.results.value, c.results.what]).toEqual(['unknown', null, 'NOTHING SENT']);
    expect([c.campaigns.level, c.campaigns.value, c.campaigns.what]).toEqual(['ok', '0/0', '']);
    expect(c.campaigns.door.panel).toBe('campaign:c-draft');
  });
});

describe('honest levels', () => {
  it('a read that failed is "—" with its reason in the title, never OK', () => {
    const c = byPart(health({ errors: { check: 'HTTP 500', links: 'offline' } }));
    expect([c.accounts.level, c.accounts.value, c.accounts.title]).toEqual(['unknown', null, 'ACCOUNTS — not read: HTTP 500']);
    expect([c.links.level, c.links.title]).toEqual(['unknown', 'LINKS — not read: offline']);
  });

  it('no waiting account yet, a mandate not read: "—", with why', () => {
    const c = byPart(health({ waiting: null, mandate: { view: null, error: 'Reading the mandate failed' } }));
    expect([c.you.level, c.you.value]).toEqual(['unknown', null]);
    expect(c.mandate.title).toBe('MANDATE — not read: Reading the mandate failed');
  });

  it('a paused mandate is HOT; none is OFF; a counter not set up is OFF', () => {
    expect(byPart(health({ mandate: { view: { standing: 'paused', mandate: { pause: { reason: 'two failures in an hour' } } } } })).mandate)
      .toMatchObject({ level: 'hot', value: 'PAUSED', what: 'two failures in an hour' });
    expect(byPart(health({ mandate: { view: { standing: 'none', mandate: null } } })).mandate).toMatchObject({ level: 'ok', value: 'OFF', what: '' });
    expect(byPart(health({ data: { ...DATA, site: { configured: false, root: 'https://go.example' } } })).links).toMatchObject({ level: 'ok', value: 'OFF' });
  });
});

describe('the RESULTS schedule (stats-schedule.js)', () => {
  it('the last read\'s age and each due post against its own interval', () => {
    const s = readSchedule(QUEUE, DATA.results.pulls, NOW);
    expect(s.posts).toBe(2);
    expect(NOW - s.last).toBe(H);
    expect(s.late).toEqual([{ by: 24 * H, interval: 6 * H }]);
  });

  it('a post read on schedule is not late; one past 90 days is never read again', () => {
    const old = { ...sent('p-old', 'x-1', null), sentAt: at(-100 * 24 * H) };
    expect(readSchedule([old], {}, NOW)).toEqual({ posts: 1, last: null, late: [] });
    expect(readSchedule([sent('p', 'x-1', null)], { p: at(-H) }, NOW).late).toEqual([]);
  });

  it('a read due for less than one sweep pass is OK; past a pass WARM; a whole interval missed HOT', () => {
    const one = (pulledAgo) => byPart(health({ data: { ...DATA, queue: [sent('p-on', 'x-1', 'c-on')], results: { ...DATA.results, pulls: { 'p-on': at(-pulledAgo) } } } })).results.level;
    expect(one(6 * H + 10 * 60e3)).toBe('ok');
    expect(one(7 * H)).toBe('warm');
    expect(one(12 * H)).toBe('hot');
  });

  it('ages read short', () => {
    expect([ageWords(0), ageWords(4 * 60e3), ageWords(3 * H), ageWords(50 * H), ageWords(NaN)]).toEqual(['0M', '4M', '3H', '2D', null]);
  });
});

describe('pace', () => {
  it('on when the KPI share is at least the time share; null when either is not measured', () => {
    expect(paceOf({ kpi: { ratio: 0.5 }, time: 0.5 })).toBe('on');
    expect(paceOf({ kpi: { ratio: 0.2 }, time: 0.5 })).toBe('behind');
    expect(paceOf({ kpi: null, time: 0.5 })).toBe(null);
    expect(paceOf({ kpi: { ratio: null }, time: 0.5 })).toBe(null);
    expect(paceOf({ kpi: { ratio: 0.5 }, time: null })).toBe(null);
  });
});

describe('the default board', () => {
  const kinds = (board) => board.map((e) => `${e.kind}${e.scope.campaignId ? `:${e.scope.campaignId}` : ''}/${e.span}`);
  it('HOUSE: the companies across the top, a panel per campaign, half-width pairs, the site counter, a PLATFORM per platform, NEXT 7 DAYS, the CMO LOG, the posts across the bottom', () => {
    expect(kinds(defaultBoard({ companyId: null, tiles: 3, campaignIds: ['c1'], platforms: ['x', 'bluesky'] }))).toEqual(['tiles/12', 'campaign:c1/6', 'accounts/6',
      'angles/6', 'links/6', 'platform/6', 'platform/6', 'next-7-days/6', 'cmo-log/6', 'posts/12']);
    expect(defaultBoard({ companyId: null, tiles: 0, campaignIds: [], platforms: ['x', 'bluesky'] }).filter((e) => e.kind === 'platform').map((e) => e.scope))
      .toEqual([{ companyId: null, platform: 'x' }, { companyId: null, platform: 'bluesky' }]);
    expect(kinds(defaultBoard({ companyId: null, tiles: 0, campaignIds: [] }))).toEqual(['campaign/6', 'accounts/6', 'angles/6', 'links/6', 'next-7-days/6', 'cmo-log/6', 'posts/12']);
  });

  it('a company: no site counter, no CMO LOG; an odd one out takes the row, three platforms-and-week to a row; every entry names its scope', () => {
    const board = defaultBoard({ companyId: 'labs', tiles: 0, campaignIds: ['c1'] });
    expect(kinds(board)).toEqual(['campaign:c1/6', 'accounts/6', 'angles/12', 'next-7-days/12', 'posts/12']);
    expect(kinds(defaultBoard({ companyId: 'labs', tiles: 0, campaignIds: ['c1'], platforms: ['x', 'tiktok'] })))
      .toEqual(['campaign:c1/6', 'accounts/6', 'angles/12', 'platform/4', 'platform/4', 'next-7-days/4', 'posts/12']);
    expect(board.every((e) => e.scope.companyId === 'labs')).toBe(true);
    expect(kinds(defaultBoard({ companyId: 'labs', tiles: 1, campaignIds: ['c1', 'c2'] }))).toEqual(['tiles/12', 'campaign:c1/6', 'campaign:c2/6', 'accounts/6', 'angles/6', 'next-7-days/12', 'posts/12']);
    expect(Object.isFrozen(board) && Object.isFrozen(board[0])).toBe(true);
  });
});

describe('the strip and panels, rendered', () => {
  const html = (el) => renderToStaticMarkup(el);
  const totals = linkTotals(DATA.links, []);
  const cards = CAMPAIGNS.map((c) => campaignCard(c, { queue: QUEUE, results: DATA.results, totals, now: NOW }));
  const b = {
    view: { cards, grid: gridOf({ companies: COMPANIES, accounts: ACCOUNTS, check: DATA.check, campaigns: CAMPAIGNS, scope: null }), matrix: { cols: [], rows: [] }, rows: [], total: 0, factsOf: () => null },
    data: DATA, companies: COMPANIES, tiles: [], filter: {}, toggle: () => {}, showing: '', all: false, now: NOW, refresh: async () => {},
    onTab: () => {}, onZoom: () => {}, onLoose: () => {}, onAll: () => {}, onOpenCampaign: () => {}, litLoose: false, channelNames: { x: 'X', bluesky: 'Bluesky' },
  };

  it('the strip: one cell per part, the deciding number, its level as a shape and a word, the hover the fold\'s', () => {
    const out = html(createElement(HealthStrip, { cells: health(), label: 'Marketing health', onCell: () => {} }));
    expect(out).toContain('aria-label="Marketing health"');
    expect(out).toContain('--hlth-cols:8;--hlth-cols-mid:4');
    expect(html(createElement(HealthStrip, { cells: health(), cols: 4, onCell: () => {} }))).toContain('--hlth-cols:4;--hlth-cols-mid:2');
    expect([...out.matchAll(/data-cell="(\w+)"/g)].map((m) => m[1])).toEqual(['you', 'accounts', 'queue', 'campaigns', 'results', 'links', 'legal', 'mandate']);
    expect(out).toContain('class="hlth-cell cham is-hot" data-cell="results" title="RESULTS — last read 1H ago');
    expect(out).toContain('<span class="hlth-part">CAMPAIGNS</span><span class="hlth-num">1/3<span class="hlth-unit"></span></span><span class="hlth-word">WARM</span>');
  });

  it('a campaign panel: its name as the title, company and goal aside, its pace as a mark, the key in the hover', () => {
    const out = html(createElement(BoardPanel, { entry: { kind: 'campaign', span: 6, scope: { companyId: null, campaignId: 'c-on' } }, b }));
    expect(out).toContain('data-part="campaign:c-on"');
    expect(out).toContain('class="lvl-mark is-ok"');
    expect(out).toMatch(/title="on pace: [^"]*last click by code[^"]*">.*Launch Week<\/span><span class="sub-panel-aside">Northwind · DOWNLOADS · ◆ 1 ASK<\/span>/);
    expect(out).not.toContain('ACTIVE OF');
    const none = html(createElement(BoardPanel, { entry: { kind: 'campaign', span: 6, scope: { companyId: null, campaignId: 'c-none' } }, b }));
    expect(none).toContain('class="lvl-mark is-unknown"');
  });

  it('empty: one short line and one door', () => {
    const out = html(createElement(BoardPanel, { entry: { kind: 'campaign', span: 6, scope: { companyId: 'brookmere', campaignId: null } }, b }));
    expect(out).toContain('<p class="mkb-empty">No campaign<button type="button" class="mko-link">CAMPAIGNS →</button></p>');
  });

  it('ACCOUNTS: the glyph key in the title hover, never a legend sentence; the optional count aside', () => {
    const out = html(createElement(BoardPanel, { entry: { kind: 'accounts', span: 6, scope: { companyId: null } }, b }));
    expect(out).toContain('title="● in use and clear · ◐ in use and failing the house check · ○ not in use');
    expect(out).toContain('<span class="sub-panel-aside">3 OPTIONAL</span>');
    expect(out).not.toContain('PRESS A CELL');
    expect(out).not.toContain(' ACTIVE</td>');
  });
});
