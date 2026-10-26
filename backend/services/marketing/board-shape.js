// board-shape — the law of a MARKETING board (marketing-panel-plan.md §4): one
// board per zoom level (the house, or one company at any depth), each a list
// of panels in order on the 12-column grid. A panel is a KIND, a SCOPE, a
// width (`span`) and, for a kind that has choices, what it shows. A board is
// refused whole, with every reason named, or accepted whole: nothing partial
// is ever written.
//
// The operator's pin beats the CMO (owner, 2026-10-24): a write made by the
// CMO may not remove, move, change or unpin a panel the operator pinned, and
// only the operator pins.
//
// Slice 4 adds the kinds the CMO lays out per goal (PLATFORM, TOP POSTS,
// FUNNEL, NEXT 7 DAYS, COMPANY WATCH, CMO LOG): a metric is only ever one the
// platform reports (CAPABILITY), a platform that reports nothing takes no
// metric at all, and a funnel reads one company's tree, never two.
//
// Pure.

import { CAPABILITY, METRICS } from '../social/stats/stats-metrics.js';

export const BOARD_VERSION = 1;
export const HOUSE_LEVEL = 'house';
export const BOARD_SPANS = Object.freeze([3, 4, 6, 8, 12]);
export const BOARD_MAX = 24;
export const BOARD_SETTERS = Object.freeze(['operator', 'cmo']);
export const BOARD_WINDOWS = Object.freeze(['7d', '30d']);
export const TOP_COUNT = Object.freeze({ min: 3, max: 10 });

/**
 * Every panel kind a board may hold, the levels it stands on, what its scope
 * names (`level`: the board's own company; `campaign`: one campaign under it;
 * `platform`: one platform at the level, or one account on it; `company`: one
 * company at or under the level — at the house, any of its companies), the
 * choices it takes (`show`, `window`, `sort`, `count`), and whether its scope
 * may narrow it to one platform (`platformFilter`). The ONE list: the
 * validator, the default board and ADD PANEL all read it; new kinds are added
 * here.
 */
export const BOARD_KINDS = Object.freeze({
  tiles: Object.freeze({ levels: ['house', 'company'], scope: 'level', choices: [] }),
  campaign: Object.freeze({ levels: ['house', 'company'], scope: 'campaign', choices: [] }),
  accounts: Object.freeze({ levels: ['house', 'company'], scope: 'level', choices: [] }),
  angles: Object.freeze({ levels: ['house', 'company'], scope: 'level', choices: [] }),
  posts: Object.freeze({ levels: ['house', 'company'], scope: 'level', choices: [] }),
  // The site counter counts house-wide, so it is the house's board's alone.
  links: Object.freeze({ levels: ['house'], scope: 'level', choices: [] }),
  platform: Object.freeze({ levels: ['house', 'company'], scope: 'platform', choices: ['show', 'window'] }),
  'top-posts': Object.freeze({ levels: ['house', 'company'], scope: 'level', choices: ['sort', 'count'], platformFilter: true }),
  funnel: Object.freeze({ levels: ['house', 'company'], scope: 'company', choices: [] }),
  'next-7-days': Object.freeze({ levels: ['house', 'company'], scope: 'level', choices: [] }),
  'company-watch': Object.freeze({ levels: ['house', 'company'], scope: 'company', choices: [] }),
  // What the CMO did and plans is the house's office, so it is the house's board's alone.
  'cmo-log': Object.freeze({ levels: ['house'], scope: 'level', choices: [] }),
});

// What a stored panel carries beyond its choices; `setBy` and `at` are the
// store's to stamp, never the caller's.
const FIELDS = Object.freeze(['kind', 'scope', 'span', 'show', 'window', 'sort', 'count', 'pinned']);
const ID = /^[A-Za-z0-9:_-]{1,120}$/;

const levelOf = (level) => (level === HOUSE_LEVEL ? 'house' : 'company');
const levelCompany = (level) => (level === HOUSE_LEVEL ? null : level);

/** Is `companyId` the level's company or under it? Walks parents, loop-safe. Pure. */
const underLevel = (companies, level, companyId) => {
  if (level === HOUSE_LEVEL) return true;
  const byId = new Map(companies.map((c) => [c.id, c]));
  const seen = new Set();
  for (let id = companyId; id && !seen.has(id); id = byId.get(id)?.parentId ?? null) {
    if (id === level) return true;
    seen.add(id);
  }
  return false;
};

/**
 * Why metrics cannot be shown for a platform: each must be one the platform
 * reports (`CAPABILITY.reports`); with no platform named, one some platform
 * reports. Pure.
 * @param {unknown} show
 * @param {?string} platform
 * @returns {string[]}
 */
export const showRefusals = (show, platform = null) => {
  if (!Array.isArray(show) || !show.length) return ['show is a list of metrics'];
  const cap = platform ? CAPABILITY[platform] : null;
  if (platform && !cap) return [`"${platform}" is not a platform the house reads`];
  const reported = cap ? cap.reports : [...new Set(Object.values(CAPABILITY).flatMap((c) => c.reports))];
  return show.flatMap((m) => {
    if (!METRICS.includes(m)) return [`"${m}" is not a metric (one of: ${METRICS.join(', ')})`];
    if (!reported.includes(m)) return [platform ? `${platform} does not report ${m}: ${cap.why}` : `no platform reports ${m}`];
    return [];
  });
};

// pure — why one panel's choices cannot stand.
const choiceRefusals = (panel, spec) => {
  const out = [];
  for (const choice of ['show', 'window', 'sort', 'count']) {
    if (panel[choice] === undefined || panel[choice] === null) continue;
    if (!spec.choices.includes(choice)) { out.push(`a ${panel.kind} panel has no ${choice} choice`); continue; }
    if (choice === 'show') out.push(...showRefusals(panel.show, panel.scope?.platform ?? null));
    if (choice === 'show' && new Set(panel.show).size !== panel.show.length) out.push('show names a metric twice');
    if (choice === 'window' && !BOARD_WINDOWS.includes(panel.window)) out.push(`window is one of ${BOARD_WINDOWS.join(', ')}`);
    if (choice === 'sort') out.push(...showRefusals([panel.sort], panel.scope?.platform ?? null).map((r) => `sort: ${r}`));
    if (choice === 'count' && !(Number.isInteger(panel.count) && panel.count >= TOP_COUNT.min && panel.count <= TOP_COUNT.max)) {
      out.push(`count is a whole number from ${TOP_COUNT.min} to ${TOP_COUNT.max}`);
    }
  }
  return out;
};

// pure — why a platform (and, when named, one account on it) is not at this level.
const platformRefusals = (scope, { level, companies, accounts = [] }, { reporting = false } = {}) => {
  const cap = Object.hasOwn(CAPABILITY, scope.platform) ? CAPABILITY[scope.platform] : null;
  if (!cap) return [`"${scope.platform}" is not a platform the house reads (one of: ${Object.keys(CAPABILITY).join(', ')})`];
  if (reporting && !cap.reports.length) return [`${scope.platform} reports no post numbers to rank by: ${cap.why}`];
  if (scope.accountId === undefined || scope.accountId === null) return [];
  const account = accounts.find((a) => a.id === scope.accountId);
  if (!account) return [`there is no account "${scope.accountId}" in this house`];
  if (account.channelId !== scope.platform) return [`account "${scope.accountId}" is on ${account.channelId}, not ${scope.platform}`];
  return level === HOUSE_LEVEL || (account.companyId && underLevel(companies, level, account.companyId)) ? []
    : [`account "${scope.accountId}" is not under ${level}`];
};

// pure — why a panel's own subject (its campaign, platform or company) does not stand under the level.
const subjectRefusals = (panel, spec, ctx) => {
  const { scope } = panel;
  const has = (k) => scope[k] !== undefined && scope[k] !== null;
  const named = (k, what) => (has(k) ? [`a ${panel.kind} panel names no ${what}`] : []);
  const out = [];
  if (spec.scope !== 'campaign') out.push(...named('campaignId', 'campaign'));
  if (spec.scope !== 'platform' && !spec.platformFilter) out.push(...named('platform', 'platform'));
  if (spec.scope !== 'platform') out.push(...named('accountId', 'account'));
  if (spec.scope !== 'company') out.push(...named('company', 'company'));
  if (spec.scope === 'platform' && !has('platform')) out.push('its scope names no platform');
  if ((spec.scope === 'platform' || spec.platformFilter) && has('platform')) out.push(...platformRefusals(scope, ctx, { reporting: spec.platformFilter }));
  if (spec.scope === 'company') {
    if (!has('company')) out.push('its scope names no company');
    else if (!ctx.companies.some((c) => c.id === scope.company)) out.push(`there is no company "${scope.company}" in this house`);
    else if (!underLevel(ctx.companies, ctx.level, scope.company)) out.push(`company "${scope.company}" is not under ${ctx.level}`);
  }
  if (spec.scope !== 'campaign' || !has('campaignId')) return out;
  const campaign = ctx.campaigns.find((c) => c.id === scope.campaignId);
  if (!campaign) return [...out, `there is no campaign "${scope.campaignId}" in this house`];
  return underLevel(ctx.companies, ctx.level, campaign.companyId) ? out : [...out, `campaign "${scope.campaignId}" is not under ${ctx.level}`];
};

// pure — why one panel's scope does not exist in this house, under this level.
const scopeRefusals = (panel, spec, ctx) => {
  const scope = panel.scope;
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) return ['its scope is missing'];
  const own = levelCompany(ctx.level);
  const out = (scope.companyId ?? null) === own ? []
    : [`it reads this board's level (${own || 'the house'}), not "${scope.companyId}"`];
  return [...out, ...subjectRefusals(panel, spec, ctx)];
};

// pure — why one panel cannot stand on this board.
const panelRefusals = (panel, ctx) => {
  if (!panel || typeof panel !== 'object' || Array.isArray(panel)) return ['it is not a panel'];
  const spec = Object.hasOwn(BOARD_KINDS, panel.kind) ? BOARD_KINDS[panel.kind] : null;
  if (!spec) return [`"${panel.kind}" is not a panel kind (one of: ${Object.keys(BOARD_KINDS).join(', ')})`];
  const out = [];
  if (typeof panel.id !== 'string' || !ID.test(panel.id)) out.push('its id is missing or malformed');
  if (!spec.levels.includes(levelOf(ctx.level))) out.push(`a ${panel.kind} panel stands on the house's board only`);
  if (!BOARD_SPANS.includes(panel.span)) out.push(`its width is one of ${BOARD_SPANS.join(', ')} columns`);
  if (panel.pinned !== undefined && typeof panel.pinned !== 'boolean') out.push('pinned is true or false');
  return [...out, ...scopeRefusals(panel, spec, ctx), ...choiceRefusals(panel, spec)];
};

/**
 * Every reason a board cannot be recorded for a level of this house; empty
 * when it can. Pure.
 * @param {unknown} panels
 * @param {{level: string, companies: Array<{id: string, parentId?: ?string}>, campaigns: Array<{id: string, companyId?: ?string}>,
 *   accounts?: Array<{id: string, channelId: string, companyId?: ?string}>}} ctx
 * @returns {string[]}
 */
export const boardRefusals = (panels, ctx) => {
  if (ctx.level !== HOUSE_LEVEL && !ctx.companies.some((c) => c.id === ctx.level)) {
    return [`there is no "${ctx.level}" company in this house`];
  }
  if (!Array.isArray(panels)) return ['a board is a list of panels'];
  const out = panels.length > BOARD_MAX ? [`a board holds at most ${BOARD_MAX} panels (this one has ${panels.length})`] : [];
  const seen = new Set();
  panels.forEach((panel, i) => {
    const name = `panel ${i + 1}${panel?.kind ? ` (${panel.kind})` : ''}`;
    if (panel?.id && seen.has(panel.id)) out.push(`${name}: its id "${panel.id}" is already on the board`);
    seen.add(panel?.id);
    out.push(...panelRefusals(panel, ctx).map((r) => `${name}: ${r}`));
  });
  return out;
};

// pure — a panel's own fields, in one comparable shape.
const fieldsOf = (panel) => JSON.stringify(FIELDS.map((k) => (k === 'pinned' ? Boolean(panel[k]) : panel[k] ?? null)));

/**
 * The pin rule: why a write by `setBy` may not stand against the board it
 * replaces. The operator may do anything to their own board; the CMO may not
 * remove, move, change or unpin a pinned panel, nor pin one. A pinned panel
 * keeps its place (its index) on the board. Pure.
 * @param {ReadonlyArray<object>} previous - the stored board ([] when none)
 * @param {ReadonlyArray<object>} next
 * @param {'operator'|'cmo'} setBy
 * @returns {string[]}
 */
export const pinRefusals = (previous, next, setBy) => {
  if (setBy !== 'cmo') return [];
  const out = [];
  previous.forEach((p, i) => {
    if (!p.pinned) return;
    const at = next.findIndex((n) => n.id === p.id);
    const why = at < 0 ? 'remove' : at !== i ? 'move' : !next[at].pinned ? 'unpin' : fieldsOf(next[at]) !== fieldsOf(p) ? 'change' : null;
    if (why) out.push(`panel "${p.id}" is pinned by the operator: the CMO cannot ${why} it`);
  });
  const pinnedBefore = new Set(previous.filter((p) => p.pinned).map((p) => p.id));
  for (const n of next) if (n.pinned && !pinnedBefore.has(n.id)) out.push(`panel "${n.id}": only the operator pins a panel`);
  return out;
};

/**
 * The board as stored: each panel's fields kept, and stamped with who set it
 * and when — a panel new to the board, changed, or in a new place is stamped
 * with this write; one left as it was keeps its stamp. Pure.
 * @param {ReadonlyArray<object>} previous
 * @param {ReadonlyArray<object>} next - a board boardRefusals accepted
 * @param {{setBy: 'operator'|'cmo', at: string}} stamp
 */
export const stampBoard = (previous, next, { setBy, at }) => next.map((panel, i) => {
  const kept = { id: panel.id, ...Object.fromEntries(FIELDS.filter((k) => panel[k] !== undefined && panel[k] !== null).map((k) => [k, panel[k]])) };
  kept.pinned = Boolean(panel.pinned);
  const before = previous[i]?.id === panel.id ? previous[i] : null;
  return before && fieldsOf(before) === fieldsOf(kept) ? { ...kept, setBy: before.setBy, at: before.at } : { ...kept, setBy, at };
});

/**
 * A stored board read against the house as it stands now: a panel whose
 * campaign is gone, or no longer under the level, is dropped from what is
 * drawn (never a crash), and each drop says why. Pure.
 * @param {ReadonlyArray<object>} panels
 * @param {{level: string, companies: Array<object>, campaigns: Array<object>}} ctx
 * @returns {{panels: object[], dropped: Array<{id: string, kind: string, why: string}>}}
 */
export const settleBoard = (panels, ctx) => {
  const dropped = [];
  const kept = panels.filter((panel) => {
    const why = panelRefusals(panel, ctx);
    if (why.length) dropped.push({ id: String(panel?.id), kind: String(panel?.kind), why: why.join('; ') });
    return !why.length;
  });
  return { panels: kept, dropped };
};
