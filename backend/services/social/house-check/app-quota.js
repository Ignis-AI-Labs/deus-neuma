// app-quota — whether a platform's shared limits cover the posts the house
// has planned (campaign plan §2.2, §6.1 check 13). One developer app serves
// many accounts, and on YouTube, X and TikTok the app's budget is shared by
// every account on it.
//
// The limits are the platforms' own published numbers, read 2026-10-23
// (plan §2.2): YouTube's per-project upload allowance (the same figure
// youtube-metadata.js names when it runs out), X's per-app posting cap, and
// TikTok's per-creator daily posts and the five posting users a day an
// unaudited app is held to. A platform not listed has no shared app limit a
// plan could reach.
//
// The plan is the house's queue: every live post on the app's accounts in the
// next seven days, an unscheduled one counted today. Pure throughout.

const DAY_MS = 24 * 60 * 60 * 1000;
const PLAN_DAYS = 7;
const LIVE = new Set(['draft', 'approved', 'sending']);

export const APP_LIMITS = Object.freeze({
  youtube: Object.freeze({ perAppDay: 100, words: 'uploads a day for the whole Google Cloud project' }),
  x: Object.freeze({ perAppDay: 10000, words: 'posts a day for the whole X app' }),
  tiktok: Object.freeze({ perAccountDay: 15, postingUsersDay: 5 }),
});

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Each account's planned posts per calendar day over the next week. Pure.
 * @param {Array<{status: string, scheduledFor?: ?string, accountId: string}>} entries - the house's, account resolved
 * @param {number} now
 * @returns {Map<string, Map<string, number>>} accountId → day → posts
 */
export const plannedByDay = (entries, now) => {
  const out = new Map();
  for (const e of entries) {
    if (!LIVE.has(e.status) || e.placeholder) continue;
    const at = e.scheduledFor ? Date.parse(e.scheduledFor) : now;
    if (!Number.isFinite(at) || at > now + PLAN_DAYS * DAY_MS) continue;
    const day = dayOf(Math.max(at, now));
    if (!out.has(e.accountId)) out.set(e.accountId, new Map());
    const days = out.get(e.accountId);
    days.set(day, (days.get(day) || 0) + 1);
  }
  return out;
};

const busiest = (days) => Math.max(0, ...(days ? [...days.values()] : []));

/**
 * The quota verdict's facts for one account, or null when its platform has no
 * shared limit. Pure.
 * @param {string} accountId
 * @param {string} channelId
 * @param {string[]} appAccounts - every account of the house on the same app (itself included)
 * @param {Map<string, Map<string, number>>} plan - plannedByDay output
 * @returns {?{words: string, problems: string[]}}
 */
export const quotaFor = (accountId, channelId, appAccounts, plan) => {
  const limits = APP_LIMITS[channelId];
  if (!limits) return null;
  if (limits.perAppDay) {
    const sum = new Map();
    for (const id of appAccounts) for (const [day, n] of plan.get(id) || []) sum.set(day, (sum.get(day) || 0) + n);
    const peak = busiest(sum);
    const cap = limits.perAppDay.toLocaleString('en-US');
    const words = `The app allows ${cap} ${limits.words}; its ${appAccounts.length} account(s) plan at most ${peak} on one day.`;
    return { words, problems: peak > limits.perAppDay ? [`The busiest planned day needs ${peak}, past the app's ${cap}.`] : [] };
  }
  const own = busiest(plan.get(accountId));
  const problems = [
    ...(own > limits.perAccountDay ? [`The busiest planned day has ${own} posts on this account; TikTok allows about ${limits.perAccountDay} a day per account.`] : []),
    ...(appAccounts.length > limits.postingUsersDay ? [`The app serves ${appAccounts.length} accounts; until TikTok audits it, only ${limits.postingUsersDay} may post in a day.`] : []),
  ];
  return {
    words: `TikTok allows about ${limits.perAccountDay} posts a day per account; this one plans at most ${own}. The app serves ${appAccounts.length} account(s).`,
    problems,
  };
};
