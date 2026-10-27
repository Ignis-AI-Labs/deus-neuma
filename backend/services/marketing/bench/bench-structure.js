// bench-structure — the campaign benchmark's STRUCTURE score (campaign plan
// §6.2, slice 13): is each campaign built the way the plan says one is? Each
// item is MET, NOT MET, or NOT MEASURED with the reason — and only measured
// items count toward the share. The pass line is 100%.
//
// Pure: a house's real records in, verdicts out.

const DAY_MS = 24 * 60 * 60 * 1000;
const LIVE = new Set(['draft', 'approved', 'sending', 'sent']);
const WAITING = new Set(['draft', 'approved']);
const URL_IN_TEXT = /https:\/\/[^\s<>"'`]+/g;
const TRACKED = /^https:\/\/(?:www\.)?deusneuma\.ai\/go\/[0-9a-z]+/;
const UNLINKED_CHANNELS = new Set(['tiktok']);

const item = (id, label, met, why) => ({ id, label, met, why });
const notMeasured = (id, label, why) => item(id, label, null, why);

const set = (v) => typeof v === 'string' ? v.trim().length > 0 : v != null;

// 1 — goal, KPI target and window are declared.
const declared = (c) => {
  const missing = [
    ...(set(c.goal?.kind) ? [] : ['a goal']),
    ...(set(c.kpi?.metric) && Number(c.kpi?.target) > 0 ? [] : ['a KPI with a target']),
    ...(set(c.window?.start) && set(c.window?.end) ? [] : ['a window (start and end)']),
  ];
  return item('declared', 'Goal, KPI target and window set', missing.length === 0,
    missing.length ? `missing ${missing.join(', ')}` : `${c.goal.kind} · ${c.kpi.metric} ${c.kpi.target} · ${c.window.start} → ${c.window.end}`);
};

// 2 — every sub names an angle, a cadence, and an account of the campaign's company.
const subsBuilt = (c, accounts) => {
  const subs = Array.isArray(c.subs) ? c.subs : [];
  if (!subs.length) return item('subs', 'Every sub has an angle, a cadence and its company\'s account', false, 'no sub-campaign: the campaign runs on no account');
  const short = subs.filter((s) => {
    const account = accounts.find((a) => a.id === s.accountId);
    return !(Array.isArray(s.angleIds) && s.angleIds.length) || !set(s.cadence) || !account || account.companyId !== c.companyId;
  });
  return item('subs', 'Every sub has an angle, a cadence and its company\'s account', short.length === 0,
    short.length ? `${short.length} of ${subs.length} sub(s) short: ${short.map((s) => s.accountId || '?').join(', ')}` : `${subs.length} sub(s) complete`);
};

// 3 — every live post names its campaign, angle and account.
const postsTagged = (posts) => {
  if (!posts.length) return notMeasured('posts-tagged', 'Every post names campaign, angle and account', 'no posts on this campaign yet');
  const short = posts.filter((e) => !set(e.angleId || e.pillar) || !set(e.recordedAccountId));
  return item('posts-tagged', 'Every post names campaign, angle and account', short.length === 0,
    `${posts.length - short.length} of ${posts.length} post(s) carry angle and account`);
};

// 4 — every post with a link carries a tracked code.
const linksCoded = (posts) => {
  const linkable = posts.filter((e) => !UNLINKED_CHANNELS.has(e.channelId) && (String(e.text || '').match(URL_IN_TEXT) || []).length);
  if (!linkable.length) return notMeasured('links-coded', 'Every linked post carries a tracked code', 'no post on this campaign carries a link');
  const coded = linkable.filter((e) => String(e.text).match(URL_IN_TEXT).every((u) => TRACKED.test(u)));
  return item('links-coded', 'Every linked post carries a tracked code', coded.length === linkable.length,
    `${coded.length} of ${linkable.length} linked post(s) carry a tracked code`);
};

// 5 — the next seven days are staged on every sub's account.
const nextWeekStaged = (c, posts, now) => {
  if (c.status !== 'active') return notMeasured('next-7-days', 'The next 7 days are staged', `the campaign is ${c.status || 'not running'}`);
  const soon = posts.filter((e) => WAITING.has(e.status) && e.scheduledFor
    && Date.parse(e.scheduledFor) >= now && Date.parse(e.scheduledFor) <= now + 7 * DAY_MS);
  const subs = Array.isArray(c.subs) ? c.subs : [];
  const bare = subs.filter((s) => !soon.some((e) => e.accountId === s.accountId));
  const met = subs.length ? bare.length === 0 : soon.length > 0;
  return item('next-7-days', 'The next 7 days are staged', met,
    subs.length ? `${subs.length - bare.length} of ${subs.length} sub(s) have a post in the next 7 days${bare.length ? ` (bare: ${bare.map((s) => s.accountId).join(', ')})` : ''}`
      : `${soon.length} post(s) in the next 7 days`);
};

// 6 — stats under a day old for every post younger than 30 days.
const statsFresh = (posts, results, now) => {
  if (!results) return notMeasured('stats-fresh', 'Stats under 24 h old for posts under 30 days', 'no stats are collected in this build yet (the stats sweep)');
  const young = posts.filter((e) => e.status === 'sent' && e.sentAt && now - Date.parse(e.sentAt) < 30 * DAY_MS);
  if (!young.length) return notMeasured('stats-fresh', 'Stats under 24 h old for posts under 30 days', 'no post went out in the last 30 days');
  const fresh = young.filter((e) => results.some((r) => r.entryId === e.id && now - Date.parse(r.at) < DAY_MS));
  return item('stats-fresh', 'Stats under 24 h old for posts under 30 days', fresh.length === young.length, `${fresh.length} of ${young.length} recent post(s) read in the last day`);
};

// 7 — every account the campaign runs on reads clear in the house check.
const accountsClear = (c, houseCheck) => {
  if (!houseCheck?.probed) return notMeasured('house-check', 'Its accounts read clear in the house check', 'the house check ran without its live probes (run with --probes)');
  const ids = (Array.isArray(c.subs) ? c.subs : []).map((s) => s.accountId);
  if (!ids.length) return notMeasured('house-check', 'Its accounts read clear in the house check', 'the campaign runs on no account');
  const notClear = ids.filter((id) => !houseCheck.accounts.find((a) => a.id === id)?.clear);
  return item('house-check', 'Its accounts read clear in the house check', notClear.length === 0,
    notClear.length ? `not clear: ${notClear.join(', ')}` : `${ids.length} account(s) clear`);
};

/**
 * Every STRUCTURE item of one campaign. Pure.
 * @param {object} campaign - shape v2 (campaign-shape.js)
 * @param {{posts: object[], accounts: object[], houseCheck: ?object, results: ?object[], now: number}} ctx
 *   posts: this campaign's live posts, `accountId` resolved and `recordedAccountId` as stored
 */
export const structureOf = (campaign, { posts, accounts, houseCheck, results, now }) => {
  const live = posts.filter((e) => LIVE.has(e.status) && !e.placeholder);
  return [
    declared(campaign),
    subsBuilt(campaign, accounts),
    postsTagged(live),
    linksCoded(live),
    nextWeekStaged(campaign, live, now),
    statsFresh(live, results, now),
    accountsClear(campaign, houseCheck),
  ];
};

/** The share of measured items met, and what was not measured. Pure. */
export const structureScore = (items) => {
  const measured = items.filter((i) => i.met !== null);
  const met = measured.filter((i) => i.met).length;
  return {
    met,
    measured: measured.length,
    share: measured.length ? Math.round((met / measured.length) * 1000) / 10 : null,
    notMeasured: items.length - measured.length,
  };
};
