/**
 * board-shape — the law of a MARKETING board (marketing-panel-plan.md §4).
 * Pure: real inputs, real reasons. Known kinds only, the five widths, scope
 * that exists in this house under this level, metrics a platform reports, at
 * most 24 panels, the site counter on the house's board alone; the pin rule
 * (the operator's pin beats the CMO); the stamp of who set each panel; and a
 * stored board read against a house that has since changed.
 */
import { describe, it, expect } from 'vitest';
import {
  BOARD_KINDS, BOARD_SPANS, BOARD_MAX, boardRefusals, pinRefusals, stampBoard, settleBoard, showRefusals,
} from '../../backend/services/marketing/board-shape.js';

const COMPANIES = Object.freeze([
  { id: 'northwind', parentId: null }, { id: 'northwind-labs', parentId: 'northwind' },
  { id: 'northwind-studio', parentId: 'northwind-labs' }, { id: 'brookmere', parentId: null },
]);
const CAMPAIGNS = Object.freeze([{ id: 'c-launch', companyId: 'northwind-studio' }, { id: 'c-brook', companyId: 'brookmere' }]);
const at = (level) => ({ level, companies: COMPANIES, campaigns: CAMPAIGNS });
const p = (id, kind, companyId, extra = {}) => ({ id, kind, span: 6, scope: { companyId }, ...extra });

describe('boardRefusals — what a board may hold', () => {
  it('accepts every kind of today at the house, with the five widths', () => {
    const board = [
      p('tiles', 'tiles', null, { span: 12 }), p('c1', 'campaign', null, { scope: { companyId: null, campaignId: 'c-launch' }, span: 8 }),
      p('accounts', 'accounts', null, { span: 4 }), p('angles', 'angles', null, { span: 3 }), p('links', 'links', null), p('posts', 'posts', null, { span: 12 }),
    ];
    expect(boardRefusals(board, at('house'))).toEqual([]);
    expect(Object.keys(BOARD_KINDS)).toEqual(['tiles', 'campaign', 'accounts', 'angles', 'posts', 'links',
      'platform', 'top-posts', 'funnel', 'next-7-days', 'company-watch', 'cmo-log']);
    expect(BOARD_SPANS).toEqual([3, 4, 6, 8, 12]);
  });

  it('a company board at any depth: its own scope, a campaign under it, an empty campaign door', () => {
    expect(boardRefusals([p('a', 'accounts', 'northwind'), p('c', 'campaign', 'northwind', { scope: { companyId: 'northwind', campaignId: 'c-launch' } }),
      p('none', 'campaign', 'northwind', { scope: { companyId: 'northwind', campaignId: null } })], at('northwind'))).toEqual([]);
  });

  it('names every reason at once, panel by panel, and refuses the whole board', () => {
    const reasons = boardRefusals([
      p('x', 'chart', null),
      p('w', 'posts', null, { span: 5 }),
      p('w', 'accounts', null),
      p('s', 'posts', 'brookmere'),
      p('g', 'campaign', null, { scope: { companyId: null, campaignId: 'c-gone' } }),
      { kind: 'angles', span: 6, scope: { companyId: null } },
      p('pin', 'posts', null, { pinned: 'yes' }),
    ], at('house'));
    expect(reasons).toEqual([
      'panel 1 (chart): "chart" is not a panel kind (one of: tiles, campaign, accounts, angles, posts, links, platform, top-posts, funnel, next-7-days, company-watch, cmo-log)',
      'panel 2 (posts): its width is one of 3, 4, 6, 8, 12 columns',
      'panel 3 (accounts): its id "w" is already on the board',
      'panel 4 (posts): it reads this board\'s level (the house), not "brookmere"',
      'panel 5 (campaign): there is no campaign "c-gone" in this house',
      'panel 6 (angles): its id is missing or malformed',
      'panel 7 (posts): pinned is true or false',
    ]);
  });

  it('the site counter is the house\'s alone; a campaign must sit under the level; the level must be a company here', () => {
    expect(boardRefusals([p('links', 'links', 'brookmere')], at('brookmere'))).toEqual(['panel 1 (links): a links panel stands on the house\'s board only']);
    expect(boardRefusals([p('c', 'campaign', 'northwind-labs', { scope: { companyId: 'northwind-labs', campaignId: 'c-brook' } })], at('northwind-labs')))
      .toEqual(['panel 1 (campaign): campaign "c-brook" is not under northwind-labs']);
    expect(boardRefusals([], at('elsewhere'))).toEqual(['there is no "elsewhere" company in this house']);
    expect(boardRefusals({}, at('house'))).toEqual(['a board is a list of panels']);
  });

  it('at most 24 panels', () => {
    const many = Array.from({ length: BOARD_MAX + 1 }, (_, i) => p(`c${i}`, 'campaign', null, { scope: { companyId: null, campaignId: null } }));
    expect(boardRefusals(many, at('house'))).toEqual(['a board holds at most 24 panels (this one has 25)']);
    expect(boardRefusals(many.slice(0, BOARD_MAX), at('house'))).toEqual([]);
  });

  it('a choice only where the kind takes one; metrics only ones the platform reports', () => {
    expect(boardRefusals([p('posts', 'posts', null, { show: ['views'], window: '7d' })], at('house')))
      .toEqual(['panel 1 (posts): a posts panel has no show choice', 'panel 1 (posts): a posts panel has no window choice']);
    expect(showRefusals(['views', 'likes'], 'tiktok')).toEqual([]);
    expect(showRefusals(['linkClicks'], 'tiktok')).toEqual(['tiktok does not report linkClicks: TikTok reports no link clicks or watch time to an app']);
    expect(showRefusals(['views'], 'linkedin')[0]).toMatch(/^linkedin does not report views: LinkedIn reports post numbers only to partner apps/);
    expect(showRefusals(['followers'], 'x')).toEqual(['"followers" is not a metric (one of: views, likes, replies, shares, saves, quotes, linkClicks, profileClicks)']);
    expect(showRefusals(['views'], 'myspace')).toEqual(['"myspace" is not a platform the house reads']);
    expect(showRefusals([], 'x')).toEqual(['show is a list of metrics']);
    expect(showRefusals(['profileClicks'])).toEqual([]);
  });
});

describe('pinRefusals — the operator\'s pin beats the CMO', () => {
  const before = [p('a', 'tiles', null, { span: 12 }), p('b', 'accounts', null, { pinned: true }), p('c', 'angles', null), p('d', 'posts', null)];

  it('the operator may do anything to their own board', () => {
    expect(pinRefusals(before, [], 'operator')).toEqual([]);
    expect(pinRefusals(before, [before[1], before[0]], 'operator')).toEqual([]);
  });

  it('the CMO may re-lay the rest around a pinned panel that keeps its place', () => {
    expect(pinRefusals(before, [p('d', 'posts', null, { span: 12 }), before[1], p('c', 'angles', null, { span: 4 })], 'cmo')).toEqual([]);
  });

  it('the CMO cannot remove, move, change or unpin a pinned panel, nor pin one', () => {
    expect(pinRefusals(before, [before[0], before[2]], 'cmo')).toEqual(['panel "b" is pinned by the operator: the CMO cannot remove it']);
    expect(pinRefusals(before, [before[1], before[0]], 'cmo')).toEqual(['panel "b" is pinned by the operator: the CMO cannot move it']);
    expect(pinRefusals(before, [before[0], { ...before[1], span: 12 }], 'cmo')).toEqual(['panel "b" is pinned by the operator: the CMO cannot change it']);
    expect(pinRefusals(before, [before[0], { ...before[1], pinned: false }], 'cmo')).toEqual(['panel "b" is pinned by the operator: the CMO cannot unpin it']);
    expect(pinRefusals(before, [before[0], before[1], { ...before[2], pinned: true }], 'cmo')).toEqual(['panel "c": only the operator pins a panel']);
  });
});

describe('stampBoard — who set each panel, and when', () => {
  it('a new, changed or moved panel takes this write\'s stamp; one left as it was keeps its own', () => {
    const first = stampBoard([], [p('a', 'tiles', null), p('b', 'posts', null)], { setBy: 'operator', at: 't1' });
    expect(first).toEqual([
      { id: 'a', kind: 'tiles', scope: { companyId: null }, span: 6, pinned: false, setBy: 'operator', at: 't1' },
      { id: 'b', kind: 'posts', scope: { companyId: null }, span: 6, pinned: false, setBy: 'operator', at: 't1' },
    ]);
    const next = stampBoard(first, [first[0], { ...first[1], span: 12, setBy: 'forged', at: 'forged' }, p('c', 'angles', null)], { setBy: 'cmo', at: 't2' });
    expect(next.map((x) => [x.id, x.span, x.setBy, x.at])).toEqual([['a', 6, 'operator', 't1'], ['b', 12, 'cmo', 't2'], ['c', 6, 'cmo', 't2']]);
    const swapped = stampBoard(next, [next[1], next[0], next[2]], { setBy: 'operator', at: 't3' });
    expect(swapped.map((x) => [x.id, x.setBy])).toEqual([['b', 'operator'], ['a', 'operator'], ['c', 'cmo']]);
  });
});

describe('settleBoard — a stored board read against the house as it stands', () => {
  it('a campaign gone, or a company deleted under it, drops its panel and says why; the rest stand', () => {
    const stored = [p('t', 'tiles', 'northwind'), p('c', 'campaign', 'northwind', { scope: { companyId: 'northwind', campaignId: 'c-launch' } }),
      p('g', 'campaign', 'northwind', { scope: { companyId: 'northwind', campaignId: 'c-gone' } })];
    const studioGone = COMPANIES.filter((c) => c.id !== 'northwind-studio');
    expect(settleBoard(stored, { level: 'northwind', companies: studioGone, campaigns: CAMPAIGNS })).toEqual({
      panels: [stored[0]],
      dropped: [
        { id: 'c', kind: 'campaign', why: 'campaign "c-launch" is not under northwind' },
        { id: 'g', kind: 'campaign', why: 'there is no campaign "c-gone" in this house' },
      ],
    });
  });
});
