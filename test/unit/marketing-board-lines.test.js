// board-lines (marketing panel slice 5) — called for real (RULE 0: pure, no
// double): the board the operator sees at a level is the desk's own default
// when none is saved; board_read's lines name every panel in its place and
// what the level may hold; and the CMO's arrangement is made whole (the
// level, the desk's ids, the operator's pins carried) before the law judges it.
import { describe, it, expect } from 'vitest';
import { boardAt, boardLines, arrangedBoard } from '../../backend/services/marketing/board-lines.js';
import { defaultBoard } from '../../frontend/app/RelinkShell/marketing/marketing-board.js';
import { boardRefusals, pinRefusals } from '../../backend/services/marketing/board-shape.js';

const HOUSE = Object.freeze({
  level: 'house',
  companies: [{ id: 'northwind', name: 'Northwind', parentId: null }, { id: 'northwind-labs', name: 'Northwind Labs', parentId: 'northwind' }, { id: 'brookmere', name: 'Brookmere', parentId: null }],
  campaigns: [{ id: 'c0ffee0000000001', name: 'Launch Week', companyId: 'northwind', status: 'active' }],
  accounts: [{ id: 'x-1', channelId: 'x', companyId: 'northwind' }, { id: 'bluesky-1', channelId: 'bluesky', companyId: 'northwind' },
    { id: 'x-2', channelId: 'x', companyId: 'northwind-labs' }, { id: 'linkedin-1', channelId: 'linkedin', companyId: 'brookmere' }],
});
const at = (level) => ({ ...HOUSE, level });

describe('board-lines — what the CMO seat reads', () => {
  it('no board saved: the board is the desk\'s own default, with the desk\'s ids', () => {
    const board = boardAt(null, HOUSE);
    expect(board.saved).toBe(false);
    const desk = defaultBoard({ companyId: null, tiles: 2, campaignIds: ['c0ffee0000000001'], platforms: ['x', 'bluesky', 'linkedin'] });
    expect(board.panels.map(({ kind, span, scope }) => ({ kind, span, scope }))).toEqual(desk.map(({ kind, span, scope }) => ({ kind, span, scope })));
    expect(board.panels.map((p) => p.id)).toEqual(['tiles', 'campaign:c0ffee0000000001', 'accounts', 'angles', 'links',
      'platform:x', 'platform:bluesky', 'platform:linkedin', 'next-7-days', 'cmo-log', 'posts']);
    // An account under no company adds the NO COMPANY tile; a company's tiles are its subsidiaries.
    expect(boardAt(null, { ...HOUSE, accounts: [...HOUSE.accounts, { id: 'x-3', channelId: 'x', companyId: null }] }).panels[0]).toMatchObject({ kind: 'tiles' });
    expect(boardAt(null, at('northwind')).panels.map((p) => p.id)).toEqual(['tiles', 'campaign:c0ffee0000000001', 'accounts', 'angles',
      'platform:x', 'platform:bluesky', 'next-7-days', 'posts']);
    expect(boardAt(null, at('brookmere')).panels.map((p) => p.id)).toEqual(['campaign:none', 'accounts', 'angles', 'platform:linkedin', 'next-7-days', 'posts']);
  });

  it('board_read: one line per panel in its place, then what the level may hold', () => {
    expect(boardLines({ ctx: HOUSE, saved: null }).split('\n')).toEqual([
      'MARKETING BOARD house · DEFAULT (none saved) · 11/24 panels · place id kind span scope choices pin set',
      '1 tiles tiles 12 default',
      '2 campaign:c0ffee0000000001 campaign 6 campaignId=c0ffee0000000001 default',
      '3 accounts accounts 6 default',
      '4 angles angles 6 default',
      '5 links links 6 default',
      '6 platform:x platform 6 platform=x default',
      '7 platform:bluesky platform 6 platform=bluesky default',
      '8 platform:linkedin platform 6 platform=linkedin default',
      '9 next-7-days next-7-days 6 default',
      '10 cmo-log cmo-log 12 default',
      '11 posts posts 12 default',
      'levels (company<parent): house · northwind · northwind-labs<northwind · brookmere',
      'kinds: tiles · campaign scope campaignId · accounts · angles · posts · links · platform scope platform[+accountId] show=[metrics it reports] window=7d|30d'
        + ' · top-posts platform? sort=metric count=3-10 · funnel scope company · next-7-days · company-watch scope company · cmo-log',
      'spans: 3 4 6 8 12 of 12',
      'platforms here: x views,likes,replies,shares,quotes,saves,linkClicks,profileClicks · bluesky likes,replies,shares,quotes · linkedin reports none (links only)',
      'campaigns here: c0ffee0000000001 Launch Week (northwind, active)',
      'companies here: northwind Northwind · northwind-labs Northwind Labs · brookmere Brookmere',
      'accounts here: x-1 northwind · bluesky-1 northwind · x-2 northwind-labs · linkedin-1 brookmere',
    ]);
  });

  it('a saved company board: its choices, the operator\'s pin, who set each panel, what was dropped; the house-only kinds are not offered', () => {
    const saved = [
      { id: 'posts', kind: 'posts', span: 12, scope: { companyId: 'northwind' }, pinned: true, setBy: 'operator', at: '2026-10-24T10:00:00.000Z' },
      { id: 'platform:x', kind: 'platform', span: 6, scope: { companyId: 'northwind', platform: 'x' }, show: ['views', 'likes'], window: '30d', pinned: false, setBy: 'cmo', at: '2026-10-24T11:00:00.000Z' },
    ];
    const lines = boardLines({ ctx: at('northwind'), saved, dropped: [{ id: 'campaign:gone', kind: 'campaign', why: 'there is no campaign "gone" in this house' }] }).split('\n');
    expect(lines.slice(0, 4)).toEqual([
      'MARKETING BOARD northwind (Northwind) · saved · 2/24 panels · place id kind span scope choices pin set',
      '1 posts posts 12 PINNED set operator 2026-10-24T10:00',
      '2 platform:x platform 6 platform=x show=views,likes window=30d set cmo 2026-10-24T11:00',
      'dropped (not drawn): campaign:gone — there is no campaign "gone" in this house',
    ]);
    const kinds = lines.find((l) => l.startsWith('kinds: '));
    expect(kinds).not.toMatch(/\blinks\b|cmo-log/);
    expect(lines.find((l) => l.startsWith('platforms here: '))).toBe('platforms here: x views,likes,replies,shares,quotes,saves,linkClicks,profileClicks · bluesky likes,replies,shares,quotes');
    expect(lines.find((l) => l.startsWith('companies here: '))).toBe('companies here: northwind Northwind · northwind-labs Northwind Labs');
  });
});

describe('board-lines — the CMO\'s arrangement made whole', () => {
  const previous = [
    { id: 'posts', kind: 'posts', span: 12, scope: { companyId: 'northwind' }, pinned: true, setBy: 'operator', at: 'T' },
    { id: 'accounts', kind: 'accounts', span: 6, scope: { companyId: 'northwind' }, pinned: false, setBy: 'operator', at: 'T' },
  ];

  it('fills the level\'s company, the desk\'s ids, and carries the operator\'s pins — and the law accepts it', () => {
    const board = arrangedBoard([{ kind: 'posts', span: 12 }, { kind: 'platform', span: 6, scope: { platform: 'bluesky' }, show: ['likes'] }], { level: 'northwind', previous });
    expect(board).toEqual([
      { kind: 'posts', span: 12, scope: { companyId: 'northwind' }, id: 'posts', pinned: true },
      { kind: 'platform', span: 6, scope: { companyId: 'northwind', platform: 'bluesky' }, show: ['likes'], id: 'platform:bluesky', pinned: false },
    ]);
    expect(boardRefusals(board, at('northwind'))).toEqual([]);
    expect(pinRefusals(previous, board, 'cmo')).toEqual([]);
    // At the house a panel reads the house (companyId null).
    expect(arrangedBoard([{ kind: 'links', span: 6 }], { level: 'house' })).toEqual([{ kind: 'links', span: 6, scope: { companyId: null }, id: 'links', pinned: false }]);
  });

  it('what the seat says still stands as said, for the law to judge: an explicit unpin, a pin, a wrong scope', () => {
    const unpin = arrangedBoard([{ kind: 'posts', span: 12, pinned: false }], { level: 'northwind', previous });
    expect(pinRefusals(previous, unpin, 'cmo')).toEqual(['panel "posts" is pinned by the operator: the CMO cannot unpin it']);
    const pin = arrangedBoard([{ kind: 'posts', span: 12 }, { kind: 'angles', span: 6, pinned: true }], { level: 'northwind', previous });
    expect(pinRefusals(previous, pin, 'cmo')).toEqual(['panel "angles": only the operator pins a panel']);
    const elsewhere = arrangedBoard([{ kind: 'posts', span: 12, scope: { companyId: 'brookmere' } }], { level: 'northwind', previous });
    expect(boardRefusals(elsewhere, at('northwind'))).toEqual(['panel 1 (posts): it reads this board\'s level (northwind), not "brookmere"']);
    expect(arrangedBoard('not a list', { level: 'house' })).toBe('not a list');
  });
});
