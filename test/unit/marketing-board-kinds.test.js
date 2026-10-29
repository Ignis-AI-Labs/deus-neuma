/**
 * The MARKETING board's slice-4 kinds (marketing-panel-plan.md §3–4) — the
 * law (board-shape.js) and the operator's choices on them (board-edit.js,
 * board-choices.js, BoardEnd.jsx addMenuItems). Pure: real inputs, real
 * reasons, no mock. A metric is only ever one the platform reports; a
 * platform that reports nothing takes no metric; the CMO LOG stands on the
 * house's board alone; a funnel and a watch read a company at or under the
 * level; TOP POSTS ranks by a reported metric, 3 to 10 of them.
 */
import { describe, it, expect } from 'vitest';
import { BOARD_KINDS, boardRefusals, pinRefusals, stampBoard } from '../../backend/services/marketing/board-shape.js';
import { CAPABILITY } from '../../backend/services/social/stats/stats-metrics.js';
import { addableEntries, editBoard, panelIdOf, panelWords, panelMenuItems } from '../../frontend/app/RelinkShell/marketing/board-edit.js';
import { choicePages, choiceItems, choiceLeverOf } from '../../frontend/app/RelinkShell/marketing/board-choices.js';
import { addMenuItems } from '../../frontend/app/RelinkShell/marketing/BoardEnd.jsx';

const COMPANIES = Object.freeze([
  { id: 'northwind', name: 'Northwind', parentId: null, depth: 0 }, { id: 'northwind-labs', name: 'Northwind Labs', parentId: 'northwind', depth: 1 },
  { id: 'brookmere', name: 'Brookmere', parentId: null, depth: 0 },
]);
const ACCOUNTS = Object.freeze([
  { id: 'x-1', channelId: 'x', companyId: 'northwind' }, { id: 'x-2', channelId: 'x', companyId: 'northwind-labs' },
  { id: 'bluesky-1', channelId: 'bluesky', companyId: null }, { id: 'telegram-1', channelId: 'telegram', companyId: 'brookmere' },
]);
const at = (level) => ({ level, companies: COMPANIES, campaigns: [], accounts: ACCOUNTS });
const p = (id, kind, companyId, extra = {}) => ({ id, kind, span: 6, ...extra, scope: { companyId, ...(extra.scope || {}) } });
const labels = (items) => items.filter((i) => i.kind === 'item').map((i) => i.label);
const CHOICES = { capability: CAPABILITY, platforms: ['x', 'bluesky', 'telegram'], names: { platforms: { x: 'X', bluesky: 'BLUESKY', telegram: 'TELEGRAM' } } };

describe('the law of the new kinds', () => {
  it('accepts each kind at the house with its choices', () => {
    expect(boardRefusals([
      p('platform:x', 'platform', null, { scope: { platform: 'x' }, show: ['views', 'linkClicks'], window: '30d' }),
      p('platform:bluesky:bluesky-1', 'platform', null, { scope: { platform: 'bluesky', accountId: 'bluesky-1' }, show: ['likes'] }),
      p('platform:telegram', 'platform', null, { scope: { platform: 'telegram' }, window: '7d' }),
      p('top-posts', 'top-posts', null, { sort: 'views', count: 5 }),
      p('top-posts:2', 'top-posts', null, { scope: { platform: 'bluesky' }, sort: 'quotes', count: 10 }),
      p('funnel:northwind', 'funnel', null, { scope: { company: 'northwind' } }),
      p('next-7-days', 'next-7-days', null),
      p('company-watch:northwind-labs', 'company-watch', null, { scope: { company: 'northwind-labs' } }),
      p('cmo-log', 'cmo-log', null),
    ], at('house'))).toEqual([]);
    expect(BOARD_KINDS['cmo-log'].levels).toEqual(['house']);
  });

  it('a metric the platform does not report is refused, and a platform that reports nothing takes no metric', () => {
    expect(boardRefusals([
      p('a', 'platform', null, { scope: { platform: 'tiktok' }, show: ['views', 'linkClicks'] }),
      p('b', 'platform', null, { scope: { platform: 'linkedin' }, show: ['views'] }),
      p('c', 'platform', null, { scope: { platform: 'x' }, show: ['views', 'views'] }),
      p('d', 'top-posts', null, { scope: { platform: 'mastodon' }, sort: 'views' }),
      p('e', 'top-posts', null, { scope: { platform: 'discord' }, sort: 'likes' }),
      p('f', 'platform', null, { scope: { platform: 'myspace' } }),
    ], at('house'))).toEqual([
      `panel 1 (platform): tiktok does not report linkClicks: ${CAPABILITY.tiktok.why}`,
      `panel 2 (platform): linkedin does not report views: ${CAPABILITY.linkedin.why}`,
      'panel 3 (platform): show names a metric twice',
      `panel 4 (top-posts): sort: mastodon does not report views: ${CAPABILITY.mastodon.why}`,
      `panel 5 (top-posts): discord reports no post numbers to rank by: ${CAPABILITY.discord.why}`,
      `panel 5 (top-posts): sort: discord does not report likes: ${CAPABILITY.discord.why}`,
      'panel 6 (platform): "myspace" is not a platform the house reads (one of: x, youtube, tiktok, mastodon, bluesky, facebook, linkedin, telegram, discord)',
    ]);
  });

  it('house-only kinds are refused on a company\'s board; a company\'s board reads only what is under it', () => {
    expect(boardRefusals([
      p('cmo-log', 'cmo-log', 'northwind'),
      p('platform:x:x-1', 'platform', 'northwind-labs', { scope: { platform: 'x', accountId: 'x-1' } }),
      p('funnel:northwind', 'funnel', 'northwind-labs', { scope: { company: 'northwind' } }),
      p('company-watch:brookmere', 'company-watch', 'northwind', { scope: { company: 'brookmere' } }),
      p('platform:x:bluesky-1', 'platform', 'northwind', { scope: { platform: 'x', accountId: 'bluesky-1' } }),
      p('platform:x:x-9', 'platform', 'northwind', { scope: { platform: 'x', accountId: 'x-9' } }),
    ].map((panel, i) => ({ ...panel, id: `${panel.id}-${i}` })), at('northwind-labs')).map((r) => r.replace(/^panel \d+ /, ''))).toEqual([
      '(cmo-log): a cmo-log panel stands on the house\'s board only',
      '(cmo-log): it reads this board\'s level (northwind-labs), not "northwind"',
      '(platform): account "x-1" is not under northwind-labs',
      '(funnel): company "northwind" is not under northwind-labs',
      '(company-watch): it reads this board\'s level (northwind-labs), not "northwind"',
      '(company-watch): company "brookmere" is not under northwind-labs',
      '(platform): it reads this board\'s level (northwind-labs), not "northwind"',
      '(platform): account "bluesky-1" is on bluesky, not x',
      '(platform): it reads this board\'s level (northwind-labs), not "northwind"',
      '(platform): there is no account "x-9" in this house',
    ]);
  });

  it('every scope names what its kind reads, and only that; choices only where the kind has them', () => {
    expect(boardRefusals([
      p('a', 'platform', null),
      p('b', 'funnel', null),
      p('c', 'company-watch', null, { scope: { company: 'gone' } }),
      p('d', 'next-7-days', null, { scope: { platform: 'x', company: 'northwind' } }),
      p('e', 'top-posts', null, { count: 2 }),
      p('f', 'top-posts', null, { count: 11, window: '7d' }),
      p('g', 'platform', null, { scope: { platform: 'x' }, window: '90d', sort: 'views' }),
    ], at('house'))).toEqual([
      'panel 1 (platform): its scope names no platform',
      'panel 2 (funnel): its scope names no company',
      'panel 3 (company-watch): there is no company "gone" in this house',
      'panel 4 (next-7-days): a next-7-days panel names no platform',
      'panel 4 (next-7-days): a next-7-days panel names no company',
      'panel 5 (top-posts): count is a whole number from 3 to 10',
      'panel 6 (top-posts): a top-posts panel has no window choice',
      'panel 6 (top-posts): count is a whole number from 3 to 10',
      'panel 7 (platform): window is one of 7d, 30d',
      'panel 7 (platform): a platform panel has no sort choice',
    ]);
  });

  it('what a panel shows is its own: the pin rule and the stamp judge show, window, sort and count too', () => {
    const before = [{ ...p('top-posts', 'top-posts', null, { sort: 'views', count: 5 }), pinned: true, setBy: 'operator', at: 't0' }];
    expect(pinRefusals(before, [{ ...before[0], count: 8 }], 'cmo')).toEqual(['panel "top-posts" is pinned by the operator: the CMO cannot change it']);
    const stamped = stampBoard(before, [{ ...before[0], count: 8 }], { setBy: 'operator', at: 't1' });
    expect([stamped[0].count, stamped[0].at]).toEqual([8, 't1']);
  });
});

describe('the operator\'s levers on the new kinds', () => {
  it('ids, names and ADD PANEL: a platform and each account, TOP POSTS where something ranks, a funnel per tree, a watch per company', () => {
    expect([panelIdOf({ kind: 'platform', scope: { platform: 'x' } }), panelIdOf({ kind: 'platform', scope: { platform: 'x', accountId: 'x-2' } }),
      panelIdOf({ kind: 'funnel', scope: { company: 'brookmere' } }), panelIdOf({ kind: 'next-7-days', scope: {} })])
      .toEqual(['platform:x', 'platform:x:x-2', 'funnel:brookmere', 'next-7-days']);
    const names = { platforms: { x: 'X' }, accounts: { 'x-2': '@labs' }, companies: { brookmere: 'Brookmere' } };
    expect([panelWords({ kind: 'platform', scope: { platform: 'x', accountId: 'x-2' } }, [], names), panelWords({ kind: 'company-watch', scope: { company: 'brookmere' } }, [], names)])
      .toEqual(['X · @labs', 'WATCH · Brookmere']);

    const offered = addableEntries({ kinds: BOARD_KINDS, companyId: null, tiles: 0, cards: [], panels: [{ id: 'platform:x' }, { id: 'top-posts' }],
      accounts: ACCOUNTS, companies: COMPANIES, capability: CAPABILITY, names });
    const byGroup = (g) => offered.filter((a) => a.group === g);
    expect(byGroup('PLATFORM').map((a) => a.id)).toEqual(['platform:bluesky', 'platform:telegram', 'platform:x:x-1', 'platform:x:x-2', 'platform:bluesky:bluesky-1', 'platform:telegram:telegram-1']);
    // Its first three reported metrics and 7 days; a platform that reports nothing gets no metric.
    expect(byGroup('PLATFORM')[0].entry).toEqual({ id: 'platform:bluesky', kind: 'platform', span: 4, scope: { companyId: null, platform: 'bluesky' }, window: '7d', show: ['likes', 'replies', 'shares'], pinned: false });
    expect(byGroup('PLATFORM')[1].entry.show).toBeUndefined();
    expect(byGroup('TOP POSTS').map((a) => [a.id, a.entry.sort, a.entry.count])).toEqual([['top-posts:2', 'views', 5]]);
    expect(byGroup('FUNNEL').map((a) => a.id)).toEqual(['funnel:northwind', 'funnel:brookmere']);
    expect(byGroup('COMPANY WATCH').map((a) => a.id)).toEqual(['company-watch:northwind', 'company-watch:northwind-labs', 'company-watch:brookmere']);
    expect(offered.map((a) => a.group)).toContain('CMO LOG');

    // A company: its own funnel only, a watch on it and under it, never the CMO LOG; nothing ranks with no reporting platform.
    const labs = addableEntries({ kinds: BOARD_KINDS, companyId: 'brookmere', tiles: 0, cards: [], panels: [], accounts: ACCOUNTS.filter((a) => a.companyId === 'brookmere'),
      companies: COMPANIES.filter((c) => c.id === 'brookmere'), capability: CAPABILITY, names });
    expect(labs.map((a) => a.id)).toEqual(['accounts', 'angles', 'posts', 'platform:telegram', 'platform:telegram:telegram-1', 'funnel:brookmere', 'next-7-days', 'company-watch:brookmere']);
  });

  it('ADD PANEL shows one decision at a time: a lone entry as itself, several as a page with the way back', () => {
    const addable = [{ id: 'a', label: 'ACCOUNTS', group: 'ACCOUNTS' }, { id: 'p1', label: 'X', group: 'PLATFORM' }, { id: 'p2', label: 'BLUESKY', group: 'PLATFORM' }];
    expect(labels(addMenuItems(addable, null))).toEqual(['ACCOUNTS', 'PLATFORM · 2  ›']);
    expect(addMenuItems(addable, null)[1]).toMatchObject({ id: 'group:PLATFORM', stay: true });
    expect(labels(addMenuItems(addable, 'PLATFORM'))).toEqual(['‹  PLATFORM', 'X', 'BLUESKY']);
  });

  it('a PLATFORM\'s ⋯: SHOW offers only what it reports, WINDOW the two windows; a platform that reports nothing has no SHOW', () => {
    const x = { id: 'platform:x', kind: 'platform', span: 4, scope: { companyId: null, platform: 'x' } };
    expect(labels(panelMenuItems(x, 0, 2, choicePages(x, CHOICES)))).toEqual(['WIDTH · 4 OF 12  ›', 'SHOW · 3 OF 8  ›', 'WINDOW · 7 DAYS  ›', 'MOVE LATER', 'PIN', 'HIDE']);
    const show = choiceItems('show', x, CHOICES);
    expect(labels(show)).toEqual(['‹  SHOW', 'SEEN', 'LIKES', 'REPLIES', 'SHARES', 'SAVES', 'QUOTES', 'LINK CLICKS', 'PROFILE CLICKS']);
    expect(show.filter((i) => i.checked).map((i) => i.label)).toEqual(['SEEN', 'LIKES', 'REPLIES']);
    const tiktok = { ...x, id: 'platform:tiktok', scope: { companyId: null, platform: 'tiktok' }, show: ['views'] };
    expect(labels(choiceItems('show', tiktok, CHOICES))).toEqual(['‹  SHOW', 'SEEN', 'LIKES', 'REPLIES', 'SHARES']);
    const telegram = { ...x, id: 'platform:telegram', scope: { companyId: null, platform: 'telegram' } };
    expect(labels(choicePages(telegram, CHOICES))).toEqual(['WINDOW · 7 DAYS  ›']);
    expect(labels(choiceItems('show', telegram, CHOICES))).toEqual(['‹  SHOW']);

    expect(choiceLeverOf('show:shares', x, CHOICES)).toEqual({ lever: 'choose', id: 'platform:x', set: { show: ['views', 'likes', 'replies', 'shares'] } });
    expect(choiceLeverOf('show:likes', x, CHOICES)).toEqual({ lever: 'choose', id: 'platform:x', set: { show: ['views', 'replies'] } });
    expect(choiceLeverOf('show:views', tiktok, CHOICES)).toBeNull();
    expect(choiceLeverOf('window:30d', x, CHOICES)).toEqual({ lever: 'choose', id: 'platform:x', set: { window: '30d' } });
    expect(editBoard([x], choiceLeverOf('window:30d', x, CHOICES))[0]).toEqual({ ...x, window: '30d' });
  });

  it('TOP POSTS\' ⋯: BY a metric its platforms report, TOP n, ON a platform that ranks; a new platform keeps a reported sort', () => {
    const top = { id: 'top-posts', kind: 'top-posts', span: 6, scope: { companyId: null }, sort: 'views', count: 5 };
    expect(labels(choicePages(top, CHOICES))).toEqual(['BY · SEEN  ›', 'TOP · 5  ›', 'ON · ALL  ›']);
    expect(labels(choiceItems('platform', top, CHOICES))).toEqual(['‹  ON', 'ALL', 'X', 'BLUESKY']);
    expect(labels(choiceItems('count', top, CHOICES))).toEqual(['‹  TOP', '3', '5', '8', '10']);
    // Narrowed to Bluesky, which counts no views: it ranks by the first metric Bluesky reports.
    expect(choiceLeverOf('platform:bluesky', top, CHOICES)).toEqual({ lever: 'choose', id: 'top-posts', set: { scope: { companyId: null, platform: 'bluesky' }, sort: 'likes' } });
    const sky = { ...top, scope: { companyId: null, platform: 'bluesky' }, sort: 'quotes' };
    expect(labels(choiceItems('sort', sky, CHOICES))).toEqual(['‹  BY', 'LIKES', 'REPLIES', 'SHARES', 'QUOTES']);
    expect(choiceLeverOf('platform:', sky, CHOICES)).toEqual({ lever: 'choose', id: 'top-posts', set: { scope: { companyId: null }, sort: 'quotes' } });
    expect(choiceLeverOf('count:8', top, CHOICES)).toEqual({ lever: 'choose', id: 'top-posts', set: { count: 8 } });
    expect(choiceLeverOf('count:4', top, CHOICES)).toBeNull();
  });
});
