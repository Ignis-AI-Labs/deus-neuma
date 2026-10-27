// board-edit — the operator's levers on a MARKETING board, as plain data
// (marketing-panel-plan.md §4): the board drawn for a level (its saved board,
// or the default when none is saved), one lever applied to it (WIDTH, MOVE
// EARLIER / LATER, HIDE, PIN / UNPIN, ADD PANEL), and the menus that offer
// them (CtxMenu items: an item that cannot apply is absent, never greyed).
// Saving starts from what is on screen: every lever returns the whole board.
// Pure.

import { DEFAULT_TOP, DEFAULT_WINDOW, SHOWN_METRICS, reportsOf, sortOf } from './platform-fold.js';

const SPANS = Object.freeze([3, 4, 6, 8, 12]);
// The kinds that take a row of their own when added.
const WIDE = new Set(['tiles', 'posts']);

/** pure — the board key of a level. */
export const levelKey = (companyId) => companyId || 'house';

/**
 * pure — a panel's id on its board: one per kind, one per campaign, one per
 * platform (or account on it), one per company a funnel or a watch reads; a
 * TOP POSTS panel keeps the id it was added under.
 */
export const panelIdOf = (entry) => {
  const s = entry.scope || {};
  switch (entry.kind) {
    case 'campaign': return `campaign:${s.campaignId || 'none'}`;
    case 'platform': return `platform:${s.platform}${s.accountId ? `:${s.accountId}` : ''}`;
    case 'funnel': case 'company-watch': return `${entry.kind}:${s.company}`;
    case 'top-posts': return entry.id || 'top-posts';
    default: return entry.kind;
  }
};

/** pure — a platform's name, an account's handle and a company's name, from the names the desk holds. */
const nameOf = (names, kind, id) => names?.[kind]?.[id] || (kind === 'platforms' ? String(id || '').toUpperCase() : id);

/**
 * pure — what a panel is called in its menu and in ADD PANEL; null for a kind
 * this desk cannot draw (it is never offered).
 * @param {{kind: string, scope: object}} entry
 * @param {Array<{id: string, name: string}>} cards - the level's campaigns
 * @param {{platforms?: object, accounts?: object, companies?: object}} [names] - id → the name the desk shows
 */
export const panelWords = (entry, cards = [], names = {}) => {
  const s = entry.scope || {};
  switch (entry.kind) {
    case 'tiles': return s.companyId ? 'SUBSIDIARIES' : 'COMPANIES';
    case 'campaign': return s.campaignId ? `CAMPAIGN · ${cards.find((c) => c.id === s.campaignId)?.name || s.campaignId}` : 'CAMPAIGNS';
    case 'accounts': return 'ACCOUNTS';
    case 'angles': return 'ANGLES × ACCOUNTS';
    case 'posts': return 'POSTS';
    case 'links': return 'SITE COUNTER';
    case 'platform': return s.accountId ? `${nameOf(names, 'platforms', s.platform)} · ${nameOf(names, 'accounts', s.accountId)}` : nameOf(names, 'platforms', s.platform);
    case 'top-posts': return s.platform ? `TOP POSTS · ${nameOf(names, 'platforms', s.platform)}` : 'TOP POSTS';
    case 'funnel': return `FUNNEL · ${nameOf(names, 'companies', s.company)}`;
    case 'next-7-days': return 'NEXT 7 DAYS';
    case 'company-watch': return `WATCH · ${nameOf(names, 'companies', s.company)}`;
    case 'cmo-log': return 'CMO LOG';
    default: return null;
  }
};

/**
 * pure — the board drawn for a level: the saved one, less any campaign panel
 * whose campaign this level no longer shows (said in `gone`), or the default
 * board with its ids when none is saved.
 * @param {{saved: ?Array<object>, defaults: ReadonlyArray<object>, campaignIds: string[]}} input
 * @returns {{panels: object[], gone: Array<{id: string, kind: string, why: string}>, saved: boolean}}
 */
export const drawnBoard = ({ saved, defaults, campaignIds }) => {
  if (!saved) return { panels: defaults.map((e) => ({ ...e, id: panelIdOf(e), pinned: false })), gone: [], saved: false };
  const shown = new Set(campaignIds);
  const lost = (p) => p.kind === 'campaign' && p.scope?.campaignId && !shown.has(p.scope.campaignId);
  return {
    panels: saved.filter((p) => !lost(p)),
    gone: saved.filter(lost).map((p) => ({ id: p.id, kind: p.kind, why: 'its campaign is not on this level any more' })),
    saved: true,
  };
};

/**
 * pure — one lever applied to the board; the whole next board.
 * @param {object[]} panels
 * @param {{lever: 'span', id: string, span: number} | {lever: 'move', id: string, by: -1|1} | {lever: 'hide', id: string}
 *   | {lever: 'pin', id: string, pinned: boolean} | {lever: 'add', entry: object} | {lever: 'choose', id: string, set: object}} act
 *   `choose` sets what the panel shows (board-choices.js)
 */
export const editBoard = (panels, act) => {
  const i = panels.findIndex((p) => p.id === act.id);
  switch (act.lever) {
    case 'span': return panels.map((p, k) => (k === i ? { ...p, span: act.span } : p));
    case 'pin': return panels.map((p, k) => (k === i ? { ...p, pinned: act.pinned } : p));
    case 'hide': return panels.filter((_, k) => k !== i);
    case 'add': return [...panels, act.entry];
    case 'choose': return panels.map((p, k) => (k === i ? { ...p, ...act.set } : p));
    case 'move': {
      const j = i + act.by;
      if (i < 0 || j < 0 || j >= panels.length) return panels;
      const next = [...panels];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    }
    default: return panels;
  }
};

/** pure — the board as the route takes it: who set a panel, and when, are the store's to stamp. */
export const asStored = (panels) => panels.map(({ setBy, at, ...panel }) => panel);

const item = (id, label, extra = {}) => ({ kind: 'item', id, label, ...extra });
const SEP = Object.freeze({ kind: 'separator' });

/** pure — a panel's ⋯ menu, at its place on the board; `choices` are its choice pages (board-choices.js choicePages). */
export const panelMenuItems = (panel, index, count, choices = []) => [
  item('width-page', `WIDTH · ${panel.span} OF 12  ›`, { stay: true }),
  ...choices,
  ...(index > 0 ? [item('earlier', 'MOVE EARLIER')] : []),
  ...(index < count - 1 ? [item('later', 'MOVE LATER')] : []),
  item('pin', panel.pinned ? 'UNPIN' : 'PIN'),
  SEP,
  item('hide', 'HIDE'),
];

/** pure — the WIDTH page: the way back, then the five widths, the panel's own marked. */
export const widthMenuItems = (span, spans = SPANS) => [
  item('width-back', '‹  WIDTH', { stay: true }),
  SEP,
  ...spans.map((s) => item(`span:${s}`, `${s} OF 12`, { checked: s === span })),
];

/** pure — the lever a ⋯ menu item names for a panel, or null for a page turn. */
export const leverOf = (itemId, panel) => {
  if (itemId === 'earlier' || itemId === 'later') return { lever: 'move', id: panel.id, by: itemId === 'earlier' ? -1 : 1 };
  if (itemId === 'hide') return { lever: 'hide', id: panel.id };
  if (itemId === 'pin') return { lever: 'pin', id: panel.id, pinned: !panel.pinned };
  const span = /^span:(\d+)$/.exec(itemId);
  return span ? { lever: 'span', id: panel.id, span: Number(span[1]) } : null;
};

/** pure — the first TOP POSTS id not on the board (a board may rank by more than one goal). */
const freeTopId = (on) => {
  for (let n = 1; ; n += 1) {
    const id = n === 1 ? 'top-posts' : `top-posts:${n}`;
    if (!on.has(id)) return id;
  }
};

/**
 * pure — what ADD PANEL offers at a level: each kind the board may hold here
 * and this desk can draw, not already on the board — the companies only where
 * there are companies under the level, one entry per campaign of the level,
 * one PLATFORM per platform the level's accounts are on and per account (its
 * first three reported metrics, 7 days), TOP POSTS where some platform here
 * reports a number to rank by, a FUNNEL per top-level company at the house (a
 * funnel never spans two trees) or the level's own, a COMPANY WATCH per
 * company here. Each names the group it is listed under in ADD PANEL.
 * @param {{kinds: ?object, companyId: ?string, tiles: number, cards: Array<{id: string, name: string}>, panels: object[],
 *   accounts?: object[], companies?: Array<{id: string, depth?: number}>, capability?: object, names?: object}} input
 *   accounts — the level's; companies — the level's own and every company under it (at the house, all of them)
 * @returns {Array<{id: string, label: string, group: string, entry: object}>}
 */
export const addableEntries = ({ kinds, companyId, tiles, cards, panels, accounts = [], companies = [], capability = {}, names = {} }) => {
  const level = companyId ? 'company' : 'house';
  const on = new Set(panels.map((p) => p.id));
  const offer = (entry, group = null) => {
    const id = panelIdOf(entry);
    const label = panelWords(entry, cards, names);
    return on.has(id) || !label ? [] : [{ id, label, group: group || label, entry: { ...entry, id, pinned: false } }];
  };
  const scope = { companyId };
  const platforms = [...new Set(accounts.map((a) => a.channelId))];
  const platformEntry = (s) => {
    const reports = reportsOf(capability, s.platform);
    return { kind: 'platform', span: 4, scope: { companyId, ...s }, window: DEFAULT_WINDOW, ...(reports.length ? { show: reports.slice(0, SHOWN_METRICS) } : {}) };
  };
  const sort = sortOf({ scope }, capability, platforms);
  const byKind = {
    tiles: () => (tiles ? offer({ kind: 'tiles', span: 12, scope }) : []),
    campaign: () => cards.flatMap((c) => offer({ kind: 'campaign', span: 6, scope: { companyId, campaignId: c.id } }, 'CAMPAIGN')),
    platform: () => [...platforms.map((platform) => ({ platform })), ...accounts.map((a) => ({ platform: a.channelId, accountId: a.id }))]
      .flatMap((s) => offer(platformEntry(s), 'PLATFORM')),
    'top-posts': () => (sort ? offer({ id: freeTopId(on), kind: 'top-posts', span: 6, scope, sort, count: DEFAULT_TOP }) : []),
    funnel: () => companies.filter((c) => (companyId ? c.id === companyId : !c.depth))
      .flatMap((c) => offer({ kind: 'funnel', span: 6, scope: { companyId, company: c.id } }, 'FUNNEL')),
    'company-watch': () => companies.flatMap((c) => offer({ kind: 'company-watch', span: 6, scope: { companyId, company: c.id } }, 'COMPANY WATCH')),
  };
  return Object.entries(kinds || {}).flatMap(([kind, spec]) => {
    if (!spec.levels.includes(level)) return [];
    return byKind[kind] ? byKind[kind]() : offer({ kind, span: WIDE.has(kind) ? 12 : 6, scope });
  });
};
