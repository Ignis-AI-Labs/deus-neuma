// platform-fold — what a MARKETING board's PLATFORM and TOP POSTS panels draw
// (marketing-panel-plan.md §3), folded from the reads the window already
// makes (use-marketing-overview.js): the queue, the stats sweep's results, the
// tracked links and the site counter's counts. Pure.
//
// SHINKEI: a platform's metric is only ever one it reports (its CAPABILITY,
// as the results route hands it over); a platform that reports nothing shows
// the clicks its tracked links counted, never an empty column. A total is the
// sum of what was read, as of each day; a day nothing had been read by draws
// no point, and an unread total is null ("—"), each with its reason.

import { accountOf } from '../marketing-overview/overview-fold.js';

/** Each metric as the desk names it (the same word on every panel: views are SEEN). */
export const METRIC_WORDS = Object.freeze({
  views: 'SEEN', likes: 'LIKES', replies: 'REPLIES', shares: 'SHARES', saves: 'SAVES', quotes: 'QUOTES',
  linkClicks: 'LINK CLICKS', profileClicks: 'PROFILE CLICKS',
});
export const WINDOW_DAYS = Object.freeze({ '7d': 7, '30d': 30 });
export const DEFAULT_WINDOW = '7d';
/** How many metrics a PLATFORM panel shows until it is told which. */
export const SHOWN_METRICS = 3;
export const DEFAULT_TOP = 5;
const DAY = 864e5;

/** pure — the metrics a platform reports, in the one shape's order. */
export const reportsOf = (capability, platform) => {
  const reports = capability?.[platform]?.reports || [];
  return Object.keys(METRIC_WORDS).filter((m) => reports.includes(m));
};

/** pure — a PLATFORM panel's metrics: the ones it was told to show that the platform reports, else the first three it reports. */
export const shownMetrics = (panel, capability) => {
  const reports = reportsOf(capability, panel.scope?.platform);
  const chosen = (panel.show || []).filter((m) => reports.includes(m));
  return chosen.length ? reports.filter((m) => chosen.includes(m)) : reports.slice(0, SHOWN_METRICS);
};

/** pure — what TOP POSTS ranks by: its sort, else the first metric any of its platforms reports. */
export const sortOf = (panel, capability, platforms) => {
  if (panel.sort) return panel.sort;
  const reported = new Set((panel.scope?.platform ? [panel.scope.platform] : platforms).flatMap((p) => reportsOf(capability, p)));
  return Object.keys(METRIC_WORDS).find((m) => reported.has(m)) || null;
};

/** pure — the end of each of the last `days` days, oldest first; today's end is now. */
export const dayEnds = (days, now) => {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  return Array.from({ length: days }, (_, i) => Math.min(now, midnight.getTime() + (i - days + 2) * DAY));
};

// pure — a post's reading of one metric as of `t`, or null when none had been read by then.
const readingAt = (series, metric, t) => {
  let v = null;
  for (const r of series || []) if (Date.parse(r.at) <= t && Number.isFinite(r.metrics?.[metric])) v = r.metrics[metric];
  return v;
};

/** pure — the sum of the posts' readings of a metric as of `t`; null when no post had one read. */
export const totalAt = (posts, results, metric, t) => {
  const read = posts.map((e) => readingAt(results?.posts?.[e.id]?.series, metric, t)).filter((v) => v !== null);
  return read.length ? read.reduce((a, b) => a + b, 0) : null;
};

// pure — why a total is "—": the account's own reason, else nothing sent, else not read yet, else the platform's.
const whyNone = ({ ids, posts, results, platform }) => {
  const own = [...ids].map((id) => results?.unavailable?.[id]?.reason).find(Boolean);
  if (own) return own;
  if (!posts.length) return 'nothing sent on it yet';
  if (!posts.some((e) => results?.posts?.[e.id])) return 'not read yet — the sweep reads new posts every 6 hours';
  return results?.capability?.[platform]?.why || 'the platform did not report it';
};

// pure — the UTC day keys the site counter counts by, oldest first.
const dayKeys = (days, now) => Array.from({ length: days }, (_, i) => new Date(now - (days - 1 - i) * DAY).toISOString().slice(0, 10));

/** pure — the clicks a platform's tracked links counted, day by day, for a platform that reports no post numbers. */
const linkClicks = ({ ids, queue, links, counter, days, now, why }) => {
  const accountOfEntry = new Map((queue || []).map((e) => [e.id, accountOf(e)]));
  const codes = new Set((links || []).filter((l) => ids.has(l.accountId) || ids.has(accountOfEntry.get(l.entryId))).map((l) => l.code));
  const none = (reason) => ({ kind: 'links', codes: codes.size, values: dayKeys(days, now).map(() => null), current: null, why: reason });
  if (!codes.size) return none(`no tracked link in its posts — ${why}`);
  if (!counter?.at) return none('the site counter has not been read yet');
  const byDay = new Map();
  for (const c of counter.counts || []) {
    if (c.kind === 'click' && codes.has(c.code)) byDay.set(c.day, (byDay.get(c.day) || 0) + (Number(c.count) || 0));
  }
  // The counter was read: a day it counted no click for these codes is a true 0.
  const values = dayKeys(days, now).map((d) => byDay.get(d) || 0);
  return { kind: 'links', codes: codes.size, values, current: values.reduce((a, b) => a + b, 0), why: null };
};

/**
 * pure — a PLATFORM panel: one platform at the level (all its accounts on
 * it), or one account; each metric it shows as a total today with its trace
 * over the window. A platform that reports nothing: its tracked links' clicks.
 * @param {{panel: object, accounts: object[], queue: object[], results: object, links: object[], now: number}} input
 *   `accounts` — the level's accounts
 */
export const platformView = ({ panel, accounts, queue, results, links, now }) => {
  const { platform, accountId = null } = panel.scope;
  const on = accounts.filter((a) => a.channelId === platform && (!accountId || a.id === accountId));
  if (!on.length) return { kind: 'empty' };
  const ids = new Set(on.map((a) => a.id));
  const days = WINDOW_DAYS[panel.window] || WINDOW_DAYS[DEFAULT_WINDOW];
  const posts = (queue || []).filter((e) => e.status === 'sent' && e.kind !== 'reply' && ids.has(accountOf(e)));
  const capability = results?.capability || {};
  if (!reportsOf(capability, platform).length) {
    return { ...linkClicks({ ids, queue, links, counter: results?.links, days, now, why: capability[platform]?.why || '' }), posts: posts.length, days };
  }
  const ends = dayEnds(days, now);
  const why = whyNone({ ids, posts, results, platform });
  return {
    kind: 'metrics', posts: posts.length, days,
    metrics: shownMetrics(panel, capability).map((metric) => {
      const current = totalAt(posts, results, metric, now);
      return { metric, word: METRIC_WORDS[metric], values: ends.map((t) => totalAt(posts, results, metric, t)), current, why: current === null ? why : null };
    }),
  };
};

/**
 * pure — TOP POSTS: the level's sent posts (on one platform, when it names
 * one) that did the most by one metric, the most first; a post with no
 * reading of it cannot rank and is counted apart.
 * @param {{panel: object, accounts: object[], queue: object[], results: object}} input
 */
export const topPosts = ({ panel, accounts, queue, results }) => {
  const ids = new Set(accounts.map((a) => a.id));
  const platform = panel.scope?.platform || null;
  const sort = sortOf(panel, results?.capability, [...new Set(accounts.map((a) => a.channelId))]);
  const sent = (queue || []).filter((e) => e.status === 'sent' && e.kind !== 'reply' && ids.has(accountOf(e)) && (!platform || e.channelId === platform));
  const ranked = sent.map((entry) => ({ entry, value: results?.posts?.[entry.id]?.latest?.metrics?.[sort] }))
    .filter((r) => Number.isFinite(r.value))
    .sort((a, b) => b.value - a.value || String(b.entry.sentAt).localeCompare(String(a.entry.sentAt)));
  return { sort, word: METRIC_WORDS[sort] || null, rows: ranked.slice(0, panel.count || DEFAULT_TOP), top: ranked[0]?.value ?? null, sent: sent.length, unranked: sent.length - ranked.length };
};

/** pure — a post's own first words: the opening of what it says, never a label. */
export const firstWords = (text, words = 6) => {
  const all = String(text || '').trim().split(/\s+/).filter(Boolean);
  return all.length > words ? `${all.slice(0, words).join(' ')}…` : all.join(' ');
};
