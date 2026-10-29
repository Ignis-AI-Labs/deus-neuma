// board-lines — the MARKETING board as the CMO seat reads and arranges it
// (marketing-panel-plan.md §4, slice 5). Three things, all pure:
//
//   - the board the operator SEES at a level: its saved board, or — none saved —
//     the desk's own default (marketing-board.js defaultBoard over the same house,
//     ids from board-edit.js), so the seat arranges what is really on screen;
//   - board_read's lines: compact, one panel per line, then what this level may
//     hold (kinds and their choices, the metrics each platform here reports, the
//     campaigns, companies and accounts a scope may name). Data, never prose;
//   - the CMO's arrangement made whole: what the seat may leave out is filled in
//     (the level's company, the desk's panel id, the operator's pins carried as
//     they stand), so the same validator and pin rule judge it as the operator's.

import { CAPABILITY } from '../social/stats/stats-metrics.js';
import { BOARD_KINDS, BOARD_SPANS, BOARD_MAX, BOARD_WINDOWS, TOP_COUNT, HOUSE_LEVEL } from './board-shape.js';
import { defaultBoard } from '../../../frontend/app/RelinkShell/marketing/marketing-board.js';
import { drawnBoard, panelIdOf } from '../../../frontend/app/RelinkShell/marketing/board-edit.js';
import { scopeOf, inScope } from '../../../frontend/app/RelinkShell/marketing-overview/overview-fold.js';

const companyOf = (level) => (level === HOUSE_LEVEL ? null : level);

/**
 * What a level shows, as the desk reads it: its campaigns, its accounts (at the
 * house every one), the platforms they are on in the accounts' order, and the
 * tiles across its top (at the house each top company, and NO COMPANY while an
 * account has none — zoom-fold.js houseTiles; at a company its subsidiaries). Pure.
 * @param {{level: string, companies: object[], campaigns: object[], accounts: object[]}} ctx
 */
const levelView = ({ level, companies, campaigns, accounts: read }) => {
  // null — the keys file is locked and the accounts can't be read (board-house.js); the lines say LOCKED.
  const accounts = read || [];
  const scope = scopeOf(companies, companyOf(level));
  const here = accounts.filter((a) => inScope(scope, a.companyId));
  const known = new Set(companies.map((c) => c.id));
  const tiles = level === HOUSE_LEVEL
    ? companies.filter((c) => !c.parentId).length + (accounts.some((a) => !a.companyId || !known.has(a.companyId)) ? 1 : 0)
    : companies.filter((c) => c.parentId === level).length;
  return {
    campaigns: campaigns.filter((c) => inScope(scope, c.companyId)),
    accounts: here,
    platforms: [...new Set(here.map((a) => a.channelId))],
    companies: companies.filter((c) => inScope(scope, c.id)),
    tiles,
  };
};

/**
 * The board the operator sees at a level: the saved one, or the desk's default. Pure.
 * @param {?object[]} saved - the level's settled saved board, null when none is saved
 * @param {object} ctx - the house (board-house.js)
 * @returns {{panels: object[], saved: boolean}}
 */
export const boardAt = (saved, ctx) => {
  const view = levelView(ctx);
  const defaults = defaultBoard({ companyId: companyOf(ctx.level), tiles: view.tiles, campaignIds: view.campaigns.map((c) => c.id), platforms: view.platforms });
  const drawn = drawnBoard({ saved, defaults, campaignIds: view.campaigns.map((c) => c.id) });
  return { panels: drawn.panels, saved: drawn.saved };
};

// pure — one panel's scope beyond its level, as `key=value`.
const scopeWords = (scope = {}) => Object.entries(scope).filter(([k, v]) => k !== 'companyId' && v !== null && v !== undefined).map(([k, v]) => `${k}=${v}`);
// pure — one panel's choices, as `key=value`.
const choiceWords = (p) => ['show', 'window', 'sort', 'count'].filter((k) => p[k] !== undefined && p[k] !== null)
  .map((k) => `${k}=${Array.isArray(p[k]) ? p[k].join(',') : p[k]}`);
// pure — who set a panel and when.
const setWords = (p) => (p.setBy ? `set ${p.setBy} ${String(p.at || '').slice(0, 16)}` : 'default');

// What each kind's scope names, and the choices it takes — in the words a filing uses.
const KIND_WORDS = Object.freeze({
  campaign: 'scope campaignId', platform: 'scope platform[+accountId]', funnel: 'scope company', 'company-watch': 'scope company',
});
const CHOICE_WORDS = Object.freeze({
  show: 'show=[metrics it reports]', window: `window=${BOARD_WINDOWS.join('|')}`, sort: 'sort=metric', count: `count=${TOP_COUNT.min}-${TOP_COUNT.max}`,
});

/** The kinds a level may hold, each with its scope and choices. Pure. */
const kindLines = (level) => Object.entries(BOARD_KINDS)
  .filter(([, spec]) => spec.levels.includes(level === HOUSE_LEVEL ? 'house' : 'company'))
  .map(([kind, spec]) => [kind, KIND_WORDS[kind], spec.platformFilter ? 'platform?' : null, ...spec.choices.map((c) => CHOICE_WORDS[c])].filter(Boolean).join(' '));

/**
 * board_read's answer: the level's board, one panel per line in its place,
 * then what the level may hold. Pure.
 * @param {{ctx: object, saved: ?object[], dropped?: object[]}} input - `saved` settled (settleBoard), null when none is saved
 * @returns {string}
 */
export const boardLines = ({ ctx, saved, dropped = [] }) => {
  const view = levelView(ctx);
  const board = boardAt(saved, ctx);
  const name = (id) => ctx.companies.find((c) => c.id === id)?.name || id;
  return [
    `MARKETING BOARD ${ctx.level}${ctx.level === HOUSE_LEVEL ? '' : ` (${name(ctx.level)})`} · ${board.saved ? 'saved' : 'DEFAULT (none saved)'} · ${board.panels.length}/${BOARD_MAX} panels · place id kind span scope choices pin set`,
    ...board.panels.map((p, i) => [i + 1, p.id, p.kind, p.span, ...scopeWords(p.scope), ...choiceWords(p), p.pinned ? 'PINNED' : null, setWords(p)].filter((w) => w !== null).join(' ')),
    ...(dropped.length ? [`dropped (not drawn): ${dropped.map((d) => `${d.id} — ${d.why}`).join('; ')}`] : []),
    `levels (company<parent): house${ctx.companies.map((c) => ` · ${c.id}${c.parentId ? `<${c.parentId}` : ''}`).join('')}`,
    `kinds: ${kindLines(ctx.level).join(' · ')}`,
    `spans: ${BOARD_SPANS.join(' ')} of 12`,
    `platforms here: ${view.platforms.map((p) => `${p} ${CAPABILITY[p]?.reports.length ? CAPABILITY[p].reports.join(',') : 'reports none (links only)'}`).join(' · ') || 'none'}`,
    `campaigns here: ${view.campaigns.map((c) => `${c.id} ${c.name} (${c.companyId || 'no company'}, ${c.status})`).join(' · ') || 'none'}`,
    `companies here: ${view.companies.map((c) => `${c.id} ${c.name}`).join(' · ') || 'none'}`,
    ctx.locked ? `accounts here: LOCKED — ${ctx.locked.why}; no layout can be saved until it opens`
      : `accounts here: ${view.accounts.map((a) => `${a.id}${a.companyId ? ` ${a.companyId}` : ''}`).join(' · ') || 'none'}`,
  ].join('\n');
};

/**
 * The CMO's arrangement made whole: each panel's scope reads the level (its
 * `companyId` filled when left out), its id is the desk's (panelIdOf) when
 * none is given, and `pinned` — never the seat's to set — is carried from the
 * stored board when left out. Anything else stands as sent, for the validator
 * and the pin rule to judge. Pure.
 * @param {unknown} panels
 * @param {{level: string, previous?: ReadonlyArray<object>}} opts - `previous` the stored board ([] when none)
 */
export const arrangedBoard = (panels, { level, previous = [] }) => {
  if (!Array.isArray(panels)) return panels;
  const pinned = new Set(previous.filter((p) => p.pinned).map((p) => p.id));
  return panels.map((p) => {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return p;
    const scope = p.scope === undefined ? { companyId: companyOf(level) }
      : p.scope && typeof p.scope === 'object' && !Array.isArray(p.scope) ? { companyId: companyOf(level), ...p.scope } : p.scope;
    const entry = { ...p, scope };
    const id = typeof p.id === 'string' && p.id ? p.id : panelIdOf(entry);
    return { ...entry, id, pinned: p.pinned ?? pinned.has(id) };
  });
};
