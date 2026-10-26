// board-choices — what a MARKETING panel shows, as the operator chooses it
// from its ⋯ (marketing-panel-plan.md §3–4, slice 4): a PLATFORM panel's
// metrics (SHOW) and its window (7 or 30 days); TOP POSTS' metric (SORT), how
// many (COUNT) and which platform. Each choice is a page of the panel's one
// menu, like WIDTH: the way back, then the choices, the panel's own marked.
// A metric is only ever offered where the platform reports it (its
// CAPABILITY), so a platform that reports nothing has no SHOW page at all.
// Pure.

import { METRIC_WORDS, WINDOW_DAYS, DEFAULT_WINDOW, DEFAULT_TOP, reportsOf, shownMetrics, sortOf } from './platform-fold.js';

const COUNTS = Object.freeze([3, 5, 8, 10]);
const item = (id, label, extra = {}) => ({ kind: 'item', id, label, ...extra });
const SEP = Object.freeze({ kind: 'separator' });
const windowWords = (w) => `${WINDOW_DAYS[w]} DAYS`;

/** pure — the platforms TOP POSTS may narrow to: the level's that report something to rank by. */
const rankable = (ctx) => ctx.platforms.filter((p) => reportsOf(ctx.capability, p).length);

/** pure — the metrics TOP POSTS may rank by: its platform's, else any the level's platforms report. */
const sortable = (panel, ctx) => {
  const from = panel.scope?.platform ? [panel.scope.platform] : ctx.platforms;
  const reported = new Set(from.flatMap((p) => reportsOf(ctx.capability, p)));
  return Object.keys(METRIC_WORDS).filter((m) => reported.has(m));
};

/**
 * pure — the choice pages a panel's ⋯ opens, each a page turn naming what it
 * holds now; none for a kind with no choices (and no SHOW for a platform
 * that reports nothing).
 * @param {object} panel
 * @param {{capability: object, platforms: string[], names?: {platforms?: object}}} ctx
 */
export const choicePages = (panel, ctx) => {
  if (panel.kind === 'platform') {
    const shown = shownMetrics(panel, ctx.capability);
    return [
      ...(shown.length ? [item('page:show', `SHOW · ${shown.length} OF ${reportsOf(ctx.capability, panel.scope.platform).length}  ›`, { stay: true })] : []),
      item('page:window', `WINDOW · ${windowWords(panel.window || DEFAULT_WINDOW)}  ›`, { stay: true }),
    ];
  }
  if (panel.kind === 'top-posts') {
    const sort = sortOf(panel, ctx.capability, ctx.platforms);
    const platform = panel.scope?.platform;
    return [
      ...(sort ? [item('page:sort', `BY · ${METRIC_WORDS[sort]}  ›`, { stay: true })] : []),
      item('page:count', `TOP · ${panel.count || DEFAULT_TOP}  ›`, { stay: true }),
      ...(rankable(ctx).length > 1 || platform ? [item('page:platform', `ON · ${platform ? ctx.names?.platforms?.[platform] || platform.toUpperCase() : 'ALL'}  ›`, { stay: true })] : []),
    ];
  }
  return [];
};

/**
 * pure — one choice page: the way back, then its choices, what the panel
 * shows now checked. SHOW's metrics stay open to toggle several.
 * @param {string} page - show | window | sort | count | platform
 */
export const choiceItems = (page, panel, ctx) => {
  const back = item('page:main', `‹  ${{ show: 'SHOW', window: 'WINDOW', sort: 'BY', count: 'TOP', platform: 'ON' }[page]}`, { stay: true });
  const shown = page === 'show' ? shownMetrics(panel, ctx.capability) : [];
  const list = {
    show: () => reportsOf(ctx.capability, panel.scope.platform).map((m) => item(`show:${m}`, METRIC_WORDS[m], { checked: shown.includes(m), stay: true })),
    window: () => Object.keys(WINDOW_DAYS).map((w) => item(`window:${w}`, windowWords(w), { checked: (panel.window || DEFAULT_WINDOW) === w })),
    sort: () => sortable(panel, ctx).map((m) => item(`sort:${m}`, METRIC_WORDS[m], { checked: sortOf(panel, ctx.capability, ctx.platforms) === m })),
    count: () => COUNTS.map((n) => item(`count:${n}`, String(n), { checked: (panel.count || DEFAULT_TOP) === n })),
    platform: () => [item('platform:', 'ALL', { checked: !panel.scope?.platform }),
      ...rankable(ctx).map((p) => item(`platform:${p}`, ctx.names?.platforms?.[p] || p.toUpperCase(), { checked: panel.scope?.platform === p }))],
  }[page];
  return list ? [back, SEP, ...list()] : [back];
};

/**
 * pure — the lever a choice names: the panel's fields to set, or null (a page
 * turn, or the one metric left shown, which a panel cannot be without).
 * @returns {?{lever: 'choose', id: string, set: object}}
 */
export const choiceLeverOf = (itemId, panel, ctx) => {
  const [choice, value] = String(itemId).split(/:(.*)/s);
  const set = (fields) => ({ lever: 'choose', id: panel.id, set: fields });
  if (choice === 'show') {
    const shown = shownMetrics(panel, ctx.capability);
    if (shown.includes(value) && shown.length === 1) return null;
    const next = shown.includes(value) ? shown.filter((m) => m !== value) : [...shown, value];
    return set({ show: reportsOf(ctx.capability, panel.scope.platform).filter((m) => next.includes(m)) });
  }
  if (choice === 'window' && WINDOW_DAYS[value]) return set({ window: value });
  if (choice === 'sort' && METRIC_WORDS[value]) return set({ sort: value });
  if (choice === 'count' && COUNTS.includes(Number(value))) return set({ count: Number(value) });
  if (choice === 'platform') {
    const scope = { ...panel.scope };
    if (value) scope.platform = value;
    else delete scope.platform;
    // A metric the new platform does not report cannot stay the one it ranks by.
    const sort = sortOf(panel, ctx.capability, ctx.platforms);
    const keeps = sortable({ ...panel, scope }, ctx).includes(sort);
    return set({ scope, sort: keeps ? sort : sortOf({ ...panel, scope, sort: null }, ctx.capability, ctx.platforms) });
  }
  return null;
};
