// stats-sweep — the house's posts, read back on a decaying schedule (campaign
// plan §4.3, slice 9): every sent post with a platform id, read with its own
// account's credential (stats-readers.js), fresh posts often and old posts
// rarely (stats-schedule.js), the results appended per house per account per
// post (marketing/results-store.js). A platform that says slow down is left
// alone as long as it asked, once logged; a project quota every channel
// shares (YouTube) is budgeted with uploads first; what an access cannot read
// is recorded as unavailable, with why, and shown as —. The site counter's
// clicks and downloads for the house's own codes are read here too.
//
// Read-only, everywhere: nothing is posted, liked or followed. Stands on the
// operator's own backend; stops with NEUMA_STATS_SWEEP=0; an agent's pipeline
// lane runs it only with NEUMA_STATS_SWEEP=1.
//
// impure — the house's stores and the network.

import { readServed } from '../../house-served.js';
import { createLogger } from '../../logger.js';
import { houseEntries } from '../queue-house.js';
import { channelOfAccountId, entryAccountId } from '../account-shape.js';
import { loadResults, changeResults } from '../../marketing/results-store.js';
import { loadLinks } from '../../marketing/link-store.js';
import { siteCounterStatus, readGoCounts } from '../../marketing/site-counter.js';
import { duePosts, backingOff, youtubeBudgetAllows, quotaDay } from './stats-schedule.js';
import { CAPABILITY } from './stats-metrics.js';
import { statsReaderFor } from './stats-readers.js';

const log = createLogger('StatsSweep');
const TICK_MS = 30 * 60 * 1000;
const FIRST_TICK_MS = 2 * 60 * 1000;
const LINKS_EVERY_MS = 6 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

// The YouTube posts approved to go out within a day: their uploads come first.
const uploadsAhead = (entries, now) => entries.filter((e) => e.channelId === 'youtube' && e.status === 'approved'
  && (!e.scheduledFor || Date.parse(e.scheduledFor) <= now + DAY)).length;

const groupByAccount = (posts) => {
  const out = new Map();
  for (const p of posts) out.set(entryAccountId(p), [...(out.get(entryAccountId(p)) || []), p]);
  return out;
};

// impure — one account's pass; its outcome folded into `u` (the record's updates).
const sweepAccount = async (house, accountId, posts, { record, u, now, ahead }) => {
  const channelId = channelOfAccountId(accountId);
  const at = new Date(now).toISOString();
  const markPulled = () => { for (const p of posts) u.pulls[p.id] = at; };
  // A slow-down this pass already met (a shared app's) counts at once.
  const standing = { ...record.backoff, ...u.backoff };
  if (backingOff(standing, accountId, now) || backingOff(standing, `app:${channelId}`, now)) return 'backing off';
  if (!CAPABILITY[channelId]?.reads) {
    u.unavailable[accountId] = { reason: CAPABILITY[channelId]?.why || 'no stats read for this platform', at };
    markPulled();
    return 'not readable';
  }
  if (channelId === 'youtube' && !youtubeBudgetAllows(u.spend.youtube, ahead, Math.ceil(posts.length / 50), now)) return 'quota held for uploads';
  const res = await statsReaderFor(channelId)(house, accountId, posts);
  if (res.spent) {
    const day = quotaDay(now);
    const before = u.spend.youtube?.day === day ? u.spend.youtube.units : 0;
    u.spend.youtube = { day, units: before + res.spent };
  }
  if (res.ok) {
    for (const r of res.results) u.results.push({ ...r, accountId, channelId, at, source: channelId });
    markPulled();
    u.cleared.push(accountId);
    return `read ${res.results.length}`;
  }
  if (res.kind === 'backoff') {
    const key = res.scope === 'app' ? `app:${channelId}` : accountId;
    u.backoff[key] = { until: new Date(now + res.ms).toISOString(), reason: res.detail };
    log.warn('a platform asked the house to slow down; the sweep waits as long as it asked', { house, key, minutes: Math.round(res.ms / 60000), detail: res.detail });
    return 'slowed down';
  }
  if (res.kind === 'unavailable') {
    if (record.unavailable?.[accountId]?.reason !== res.detail) log.info('a platform cannot report this account\'s numbers; shown as —', { house, accountId, detail: res.detail });
    u.unavailable[accountId] = { reason: res.detail, at };
    markPulled();
    return 'not readable';
  }
  log.warn('stats read failed; tried again next pass', { house, accountId, detail: res.detail });
  return 'failed';
};

// impure — the site counter's aggregates for the house's own codes, every 6 hours.
const sweepLinks = async (house, record, u, now) => {
  if (record.links && now - Date.parse(record.links.at) < LINKS_EVERY_MS) return;
  if (!(await siteCounterStatus(house)).configured) return;
  const codes = (await loadLinks(house)).map((l) => l.code);
  if (!codes.length) return;
  const read = await readGoCounts(house, codes);
  if (read.ok) u.links = { at: new Date(now).toISOString(), counts: read.counts };
  else log.warn('the site counter could not be read; tried again next pass', { house, detail: read.detail });
};

/**
 * One pass over one house. impure.
 * @param {string} house
 * @param {{now?: number}} [opts]
 * @returns {Promise<{accounts: Record<string, string>, read: number}>}
 */
export const sweepHouse = async (house, { now = Date.now() } = {}) => {
  const [entries, record] = await Promise.all([houseEntries(house), loadResults(house)]);
  const u = { results: [], pulls: {}, backoff: {}, unavailable: {}, cleared: [], spend: { ...record.spend }, links: null };
  const accounts = {};
  const ahead = uploadsAhead(entries, now);
  for (const [accountId, posts] of groupByAccount(duePosts(entries, record.pulls, now))) {
    accounts[accountId] = await sweepAccount(house, accountId, posts, { record, u, now, ahead });
  }
  await sweepLinks(house, record, u, now);
  await changeResults(house, (r) => {
    const unavailable = { ...r.unavailable, ...u.unavailable };
    for (const id of u.cleared) delete unavailable[id];
    return {
      ...r,
      results: [...r.results, ...u.results],
      pulls: { ...r.pulls, ...u.pulls },
      backoff: { ...r.backoff, ...u.backoff },
      unavailable,
      spend: u.spend,
      links: u.links || r.links,
    };
  });
  return { accounts, read: u.results.length };
};

/** One pass over every house this backend serves. impure. */
export const statsSweepTick = async () => {
  const served = await readServed();
  for (const house of served.houses) {
    await sweepHouse(house).catch((err) => log.error('stats sweep failed for a house', { house, error: err.message }));
  }
};

/**
 * Whether this backend runs the sweep, and why not (pure over its env). An
 * agent's pipeline lane (NEUMA_PIPELINE_ID) reads the same keys as the
 * operator's desk, and every read it made would spend the owner's platform
 * allowances (X's paid reads, YouTube's shared quota) on a lane's copy of
 * the queue: it stands only when asked (NEUMA_STATS_SWEEP=1).
 * @param {Record<string, string|undefined>} env
 * @returns {?string} the reason it stays down, or null when it stands
 */
export const sweepStaysDown = (env) => {
  if (env.NEUMA_STATS_SWEEP === '0') return 'NEUMA_STATS_SWEEP=0';
  if (env.NEUMA_PIPELINE_ID && env.NEUMA_STATS_SWEEP !== '1') return `an agent pipeline lane (${env.NEUMA_PIPELINE_ID}); NEUMA_STATS_SWEEP=1 stands it`;
  return null;
};

/** Stand the sweep (guarded at boot) — on the operator's own backend only (sweepStaysDown). impure. */
export const startStatsSweep = ({ intervalMs = TICK_MS } = {}) => {
  const down = sweepStaysDown(process.env);
  if (down) {
    log.info('stats sweep off', { why: down });
    return () => {};
  }
  const run = () => statsSweepTick().catch((err) => log.error('stats sweep tick failed', { error: err.message }));
  const first = setTimeout(run, FIRST_TICK_MS);
  const timer = setInterval(run, intervalMs);
  first.unref?.();
  timer.unref?.();
  log.info('stats sweep standing', { everyMs: intervalMs });
  return () => { clearTimeout(first); clearInterval(timer); };
};
