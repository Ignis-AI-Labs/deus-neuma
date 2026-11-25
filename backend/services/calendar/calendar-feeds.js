/**
 * CALENDAR FEEDS — the calendars the operator keeps elsewhere, read into the house calendar.
 *
 * Design note, 2026-11-20, the day the CRM booked its first call: […] The house calendar already goes OUT as a feed (tasks-ics.js). This is the way IN: the operator pastes a
 * calendar's private address (Google Calendar: Settings, the calendar, […]; Outlook and
 * Apple have the same), and everything on it — a call booked through a scheduling page among it — stands on the house
 * calendar, is tied to the lead it is with, and is announced before it starts (meeting-reminders.js).
 *
 * READ-ONLY, and one-way: nothing is ever written to the other calendar. The address is a secret (whoever holds it
 * reads the calendar), so it is kept in the house's private files and never sent back to the desk whole — the list
 * shows the host and the calendar's own name.
 *
 * OFF until the operator turns on the "Your calendars" connection (electron/connections.json): a feed is asked for
 * every few minutes by itself, and nothing that runs by itself starts on its own.
 * impure (the house's files, the network through the web guard).
 */
import path from 'path';
import crypto from 'crypto';
import { walletDir } from '../user-realm.js';
import { readJson, writePrivate, ABSENT } from '../house-office-legacy.js';
import { createWriteChain } from '../write-chain.js';
import { assertSafeWebTarget, nextRedirectUrl } from '../web-guard.js';
import { requestWebOnce, readBounded } from '../web-fetch.js';
import { isConnectionOn } from '../connections/connection-switches.js';
import { parseIcs, occurrencesIn } from '../../../core/calendar/ics-read.js';
import { createLogger } from '../logger.js';

const log = createLogger('CalendarFeeds');
export const CONNECTION_ID = 'calendar-feeds';
export const FEEDS_MAX = 6;
export const FEED_FRESH_MS = 5 * 60 * 1000;
const FEED_BYTES = 8 * 1024 * 1024;
const serialize = createWriteChain();
const fileOf = (wallet) => path.join(walletDir(wallet), 'calendar-feeds.json');

/** A calendar's address as it is asked for: `webcal://` is https by another name; anything but https is refused. Pure. */
export const feedUrl = (input) => {
  const raw = String(input ?? '').trim().replace(/^webcal:\/\//i, 'https://');
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && u.hostname.includes('.') ? u.toString() : null;
  } catch {
    return null;
  }
};

// impure — one calendar's text through the web guard (redirects re-checked), or why not.
const fetchCalendar = async (target, { signal } = {}) => {
  let url = target;
  for (let hops = 0; hops <= 4; hops += 1) {
    const guard = await assertSafeWebTarget(url);
    if (!guard.ok) return { ok: false, why: guard.reason === 'unresolvable' ? 'the address does not exist' : `the address was refused (${guard.reason})` };
    const { res, error } = await requestWebOnce(url, guard.addrs, { signal, headers: { Accept: 'text/calendar, text/plain;q=0.8' } });
    if (error) return { ok: false, why: /no answer within/.test(error) ? 'it did not answer in time' : 'it could not be reached' };
    if (res.statusCode >= 300 && res.statusCode < 400) {
      const next = nextRedirectUrl(url, res.headers.location);
      res.destroy();
      if (!next) return { ok: false, why: 'it redirects nowhere' };
      url = next;
      continue;
    }
    if (res.statusCode !== 200) { res.destroy(); return { ok: false, why: res.statusCode === 404 || res.statusCode === 403 ? 'the calendar\'s address is wrong, or was reset where it is kept' : `it answered ${res.statusCode}` }; }
    const { buf, truncated } = await readBounded(res, FEED_BYTES);
    if (truncated) return { ok: false, why: 'the calendar is larger than 8 MB' };
    const parsed = parseIcs(buf.toString('utf8'));
    return parsed.ok ? { ok: true, ...parsed } : { ok: false, why: 'what is at that address is not a calendar (it must be the calendar\'s iCal address, ending in .ics)' };
  }
  return { ok: false, why: 'it redirects without end' };
};

const readFeeds = async (wallet) => {
  const doc = await readJson(fileOf(wallet));
  return doc === ABSENT || !Array.isArray(doc?.feeds) ? [] : doc.feeds;
};

/** The house's calendars, as the desk may see them: never the address itself. impure. */
export const listFeeds = async (wallet) => (await readFeeds(wallet)).map((f) => ({
  id: f.id, label: f.label, host: new URL(f.url).hostname, addedAt: f.addedAt, lastReadAt: cache.get(f.id)?.at ? new Date(cache.get(f.id).at).toISOString() : null,
  lastError: cache.get(f.id)?.why ?? null,
}));

/**
 * Add a calendar by its private iCal address. It is read once here: an address that is not a calendar is never kept.
 * impure.
 * @param {string} wallet
 * @param {{url: string, label?: string}} feed
 * @returns {Promise<{ok: true, feed: object, events: number}|{ok: false, reason: string}>}
 */
export const addFeed = (wallet, { url, label }, { fetch = fetchCalendar } = {}) => serialize(async () => {
  const address = feedUrl(url);
  if (!address) return { ok: false, reason: 'paste the calendar\'s private iCal address: it starts with https:// (or webcal://) and usually ends in .ics' };
  const feeds = await readFeeds(wallet);
  if (feeds.some((f) => f.url === address)) return { ok: false, reason: 'that calendar is already here' };
  if (feeds.length >= FEEDS_MAX) return { ok: false, reason: `at most ${FEEDS_MAX} calendars — remove one first` };
  const read = await fetch(address);
  if (!read.ok) return { ok: false, reason: `That calendar could not be read: ${read.why}.` };
  const feed = { id: `cal-${crypto.randomBytes(4).toString('hex')}`, label: String(label ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) || read.name || new URL(address).hostname, url: address, addedAt: new Date().toISOString() };
  await writePrivate(fileOf(wallet), { feeds: [...feeds, feed] });
  cache.set(feed.id, { at: Date.now(), events: read.events, why: null });
  log.info('A calendar was added', { wallet, host: new URL(address).hostname, events: read.events.length });
  return { ok: true, feed: { id: feed.id, label: feed.label, host: new URL(address).hostname }, events: read.events.length };
});

/** Take a calendar off. True when one was there. impure. */
export const removeFeed = (wallet, id) => serialize(async () => {
  const feeds = await readFeeds(wallet);
  if (!feeds.some((f) => f.id === id)) return false;
  await writePrivate(fileOf(wallet), { feeds: feeds.filter((f) => f.id !== id) });
  cache.delete(id);
  return true;
});

// What each calendar last said, kept for FEED_FRESH_MS so ten open windows are one request.
const cache = new Map();

/**
 * Everything on the house's calendars inside a window. A calendar that could not be read keeps what it last said
 * (marked stale) and is named in `gaps` — a meeting never vanishes because one request failed. While the connection
 * is off nothing is asked, and that is said. impure.
 * @param {string} wallet
 * @param {{fromMs: number, toMs: number}} win
 * @returns {Promise<{off: boolean, feeds: number, events: Array<object>, gaps: Array<{feed: string, why: string}>}>}
 */
export const readFeedEvents = async (wallet, { fromMs, toMs }, { fetch = fetchCalendar, now = Date.now() } = {}) => {
  const feeds = await readFeeds(wallet);
  if (!feeds.length) return { off: false, feeds: 0, events: [], gaps: [] };
  if (!isConnectionOn(CONNECTION_ID)) return { off: true, feeds: feeds.length, events: [], gaps: [] };
  const gaps = [];
  const events = [];
  for (const feed of feeds) {
    let kept = cache.get(feed.id);
    if (!kept || now - kept.at > FEED_FRESH_MS) {
      const read = await fetch(feed.url).catch((err) => ({ ok: false, why: err.message }));
      if (read.ok) { kept = { at: now, events: read.events, why: null }; cache.set(feed.id, kept); } else {
        log.warn('A calendar could not be read', { wallet, feed: feed.id, why: read.why });
        gaps.push({ feed: feed.label, why: read.why });
        // Tried now: not asked again until the next window, and what it last said still stands.
        kept = { at: now, events: kept?.events ?? [], why: read.why };
        cache.set(feed.id, kept);
      }
    } else if (kept.why) gaps.push({ feed: feed.label, why: kept.why });
    for (const o of occurrencesIn(kept.events, fromMs, toMs)) events.push({ ...o, feed: feed.label });
  }
  return { off: false, feeds: feeds.length, events: events.sort((a, b) => a.startMs - b.startMs), gaps };
};

/** Forget what was kept (tests; a calendar re-read on demand). */
export const forgetFeedCache = () => cache.clear();
