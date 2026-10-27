/**
 * board-edit — the operator's levers on a MARKETING board, as plain data.
 * Pure: real inputs, real outputs. The board drawn (saved, or the default
 * with ids), each lever, the ⋯ menu and its WIDTH page (an item that cannot
 * apply is absent), and what ADD PANEL offers at the house and at a company.
 */
import { describe, it, expect } from 'vitest';
import {
  levelKey, panelIdOf, drawnBoard, editBoard, asStored, panelMenuItems, widthMenuItems, leverOf, addableEntries,
} from '../../frontend/app/RelinkShell/marketing/board-edit.js';
import { defaultBoard } from '../../frontend/app/RelinkShell/marketing/marketing-board.js';

const KINDS = {
  tiles: { levels: ['house', 'company'], scope: 'level', choices: [] },
  campaign: { levels: ['house', 'company'], scope: 'campaign', choices: [] },
  accounts: { levels: ['house', 'company'], scope: 'level', choices: [] },
  posts: { levels: ['house', 'company'], scope: 'level', choices: [] },
  links: { levels: ['house'], scope: 'level', choices: [] },
  chart: { levels: ['house', 'company'], scope: 'level', choices: ['show'] },
};
const labels = (items) => items.filter((i) => i.kind === 'item').map((i) => i.label);

describe('drawnBoard — what a level shows', () => {
  it('no saved board: the default, each panel with its id and unpinned', () => {
    const defaults = defaultBoard({ companyId: null, tiles: 2, campaignIds: ['c1'] });
    const { panels, saved, gone } = drawnBoard({ saved: null, defaults, campaignIds: ['c1'] });
    expect(panels.map((p) => [p.id, p.span, p.pinned])).toEqual([['tiles', 12, false], ['campaign:c1', 6, false], ['accounts', 6, false],
      ['angles', 6, false], ['links', 6, false], ['next-7-days', 6, false], ['cmo-log', 6, false], ['posts', 12, false]]);
    expect([saved, gone]).toEqual([false, []]);
    expect(levelKey(null)).toBe('house');
    expect(levelKey('northwind')).toBe('northwind');
    expect(panelIdOf({ kind: 'campaign', scope: { campaignId: null } })).toBe('campaign:none');
  });

  it('a saved board, less a campaign this level no longer shows (named in gone)', () => {
    const saved = [{ id: 'posts', kind: 'posts', span: 12, scope: {} }, { id: 'campaign:c9', kind: 'campaign', span: 6, scope: { campaignId: 'c9' } },
      { id: 'campaign:none', kind: 'campaign', span: 6, scope: { campaignId: null } }];
    expect(drawnBoard({ saved, defaults: [], campaignIds: ['c1'] })).toEqual({
      panels: [saved[0], saved[2]], gone: [{ id: 'campaign:c9', kind: 'campaign', why: 'its campaign is not on this level any more' }], saved: true,
    });
  });
});

describe('editBoard — one lever, the whole next board', () => {
  const board = ['a', 'b', 'c'].map((id) => ({ id, kind: id, span: 6, pinned: false, setBy: 'cmo', at: 't' }));
  it('width, move earlier/later (never past an end), hide, pin, add', () => {
    expect(editBoard(board, { lever: 'span', id: 'b', span: 12 }).map((p) => p.span)).toEqual([6, 12, 6]);
    expect(editBoard(board, { lever: 'move', id: 'b', by: -1 }).map((p) => p.id)).toEqual(['b', 'a', 'c']);
    expect(editBoard(board, { lever: 'move', id: 'b', by: 1 }).map((p) => p.id)).toEqual(['a', 'c', 'b']);
    expect(editBoard(board, { lever: 'move', id: 'a', by: -1 })).toBe(board);
    expect(editBoard(board, { lever: 'hide', id: 'c' }).map((p) => p.id)).toEqual(['a', 'b']);
    expect(editBoard(board, { lever: 'pin', id: 'a', pinned: true })[0].pinned).toBe(true);
    expect(editBoard(board, { lever: 'add', entry: { id: 'd' } }).map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(asStored(board)[0]).toEqual({ id: 'a', kind: 'a', span: 6, pinned: false });
  });
});

describe('the ⋯ menu', () => {
  it('only what applies at the panel\'s place; the WIDTH page marks its own width', () => {
    expect(labels(panelMenuItems({ span: 6, pinned: false }, 0, 3))).toEqual(['WIDTH · 6 OF 12  ›', 'MOVE LATER', 'PIN', 'HIDE']);
    expect(labels(panelMenuItems({ span: 12, pinned: true }, 2, 3))).toEqual(['WIDTH · 12 OF 12  ›', 'MOVE EARLIER', 'UNPIN', 'HIDE']);
    expect(labels(panelMenuItems({ span: 4 }, 1, 3))).toEqual(['WIDTH · 4 OF 12  ›', 'MOVE EARLIER', 'MOVE LATER', 'PIN', 'HIDE']);
    const width = widthMenuItems(8);
    expect(labels(width)).toEqual(['‹  WIDTH', '3 OF 12', '4 OF 12', '6 OF 12', '8 OF 12', '12 OF 12']);
    expect(width.filter((i) => i.checked).map((i) => i.label)).toEqual(['8 OF 12']);
    const panel = { id: 'p', pinned: true };
    expect([leverOf('earlier', panel), leverOf('pin', panel), leverOf('span:3', panel), leverOf('width-page', panel)])
      .toEqual([{ lever: 'move', id: 'p', by: -1 }, { lever: 'pin', id: 'p', pinned: false }, { lever: 'span', id: 'p', span: 3 }, null]);
  });
});

describe('addableEntries — what ADD PANEL offers', () => {
  const cards = [{ id: 'c1', name: 'Launch Week' }, { id: 'c2', name: 'Short Push' }];
  it('at the house: each kind not on the board, one per campaign; never a kind this desk cannot draw', () => {
    const on = [{ id: 'posts' }, { id: 'campaign:c1' }];
    expect(addableEntries({ kinds: KINDS, companyId: null, tiles: 2, cards, panels: on }).map((a) => [a.label, a.entry.span]))
      .toEqual([['COMPANIES', 12], ['CAMPAIGN · Short Push', 6], ['ACCOUNTS', 6], ['SITE COUNTER', 6]]);
  });
  it('at a company: no site counter, no SUBSIDIARIES where it has none; the scope is the company\'s', () => {
    const offered = addableEntries({ kinds: KINDS, companyId: 'brookmere', tiles: 0, cards: cards.slice(1), panels: [] });
    expect(offered.map((a) => a.label)).toEqual(['CAMPAIGN · Short Push', 'ACCOUNTS', 'POSTS']);
    expect(offered[0].entry).toEqual({ id: 'campaign:c2', kind: 'campaign', span: 6, scope: { companyId: 'brookmere', campaignId: 'c2' }, pinned: false });
    expect(addableEntries({ kinds: null, companyId: null, tiles: 0, cards, panels: [] })).toEqual([]);
  });
});
