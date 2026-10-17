/**
 * Dailies — the operator's daily workouts, and the streak law over them.
 *
 * The DEFINITION rides the vitals log itself as a `dailies-set` snapshot
 * entry (append-only, like everything on the vessel record): the current
 * definition is the latest snapshot, and each past day is judged against
 * the definition that stood ON that day — editing today's dailies can never
 * retro-break yesterday's streak. Days before any definition keep the old
 * session law (≥1 logged session counts), so a standing streak survives the
 * moment dailies are first set up.
 *
 * A day joins the streak only when EVERY daily in force that day has a
 * logged `daily` completion (Design note, 2026-08-28: […]). Completions are the operator's word
 * — logged by them, or by their neuma when they say it happened. The record
 * cannot verify a body; it can only say plainly that a padded streak serves
 * no one.
 *
 * Pure module: entries in, views/aggregates out; ids and timestamps come
 * from the impure caller. Validation errors are tagged corrections
 * (vitals.js law).
 */

import { localDayKey } from './day-key.js';
import { localMonthKey } from '../time/day-key.js';

export const DAILY_TITLE_MAX = 60;
export const DAILIES_MAX = 12;

// ── Rest days (Design note, 2026-09-05 ────────────────────────────────────────────
// Recovery is part of the practice: a claimed rest day completes the day by
// rest — the streak holds, and the record says plainly it was rest, not work.
// The law is deliberately tight, because the operator asked for the
// tightness: a few days a month, never clustered, always at his word.

/** Rest days the log grants per calendar month (Founder: […]). */
export const REST_DAYS_PER_MONTH = 4;

/** Full training days that must sit between two rest days (Founder: […] — rest Monday, back at it Wednesday, rest again Thursday
 *  at the earliest). */
export const REST_DAYS_TRAINING_BETWEEN = 2;

const _correction = (msg) => Object.assign(new Error(msg), { correction: true });

/**
 * Normalize a `dailies-set` snapshot's items: every item carries an id (the
 * impure caller mints ids for new items so completions stay linked across
 * edits) and a titled name; an empty list is a lawful clearing. Pure.
 * @param {Array<{id: string, title: string}>} items
 * @returns {Array<{id: string, title: string}>}
 */
export const normalizeDailyItems = (items) => {
  if (!Array.isArray(items)) throw _correction('items must be a list of dailies.');
  if (items.length > DAILIES_MAX) throw _correction(`at most ${DAILIES_MAX} dailies — a day has to be completable.`);
  const seen = new Set();
  return items.map((item) => {
    const id = typeof item?.id === 'string' ? item.id.trim() : '';
    const title = typeof item?.title === 'string' ? item.title.trim() : '';
    if (!id) throw _correction('every daily needs an id.');
    if (!title) throw _correction('every daily needs a title.');
    if (title.length > DAILY_TITLE_MAX) throw _correction(`a daily title must stay under ${DAILY_TITLE_MAX} characters.`);
    if (seen.has(id)) throw _correction('daily ids must be unique.');
    seen.add(id);
    return { id, title };
  });
};

/**
 * The definition in force on a given day: the latest `dailies-set` snapshot
 * whose day is ≤ that day (record order breaks same-day ties — the last word
 * of the day stands). [] before any snapshot. Pure.
 * @param {Array} entries
 * @param {number} dayK - a localDayKey
 * @returns {Array<{id: string, title: string}>}
 */
export const dailiesInForce = (entries, dayK) => {
  let items = [];
  for (const e of entries || []) {
    if (e?.kind !== 'dailies-set') continue;
    const k = localDayKey(e.occurredAt);
    if (k !== null && k <= dayK) items = Array.isArray(e.items) ? e.items : [];
  }
  return items;
};

/** The current definition — the log's last snapshot, [] when never set. Pure. */
export const currentDailies = (entries) => {
  let items = [];
  for (const e of entries || []) {
    if (e?.kind === 'dailies-set') items = Array.isArray(e.items) ? e.items : [];
  }
  return items;
};

/**
 * Resolve a completion against the CURRENT definition — by id, or by title
 * (case-insensitive) so a neuma can log "stretch" at the operator's word
 * without ever seeing an id. Unknown → tagged correction naming the real
 * list. Pure.
 * @param {Array} entries
 * @param {{dailyId?: string, title?: string}} args
 * @returns {{dailyId: string, title: string}}
 */
export const resolveDailyCompletion = (entries, args) => {
  const items = currentDailies(entries);
  if (items.length === 0) throw _correction('no dailies are set up yet — the operator defines them in VESSEL.');
  const askedId = typeof args?.dailyId === 'string' ? args.dailyId.trim() : '';
  const askedTitle = typeof args?.title === 'string' ? args.title.trim().toLowerCase() : '';
  const hit = items.find((i) => (askedId && i.id === askedId)
    || (askedTitle && i.title.toLowerCase() === askedTitle));
  if (!hit) {
    throw _correction(`no such daily — the current dailies are: ${items.map((i) => i.title).join(' · ')}.`);
  }
  return { dailyId: hit.id, title: hit.title };
};

/** The ids completed on one day. Pure. */
const _completedOn = (entries, dayK) => new Set(
  (entries || []).filter((e) => e?.kind === 'daily' && localDayKey(e.occurredAt) === dayK)
    .map((e) => e.dailyId),
);

/** Whether one day carries a rest-day entry. Pure. */
export const isRestDay = (entries, dayK) =>
  (entries || []).some((e) => e?.kind === 'rest-day' && localDayKey(e.occurredAt) === dayK);

// pure — epoch-day integer back to its UTC-midnight instant, for month keys.
const DAY_MS = 86400000;
const dayKeyMs = (dayK) => dayK * DAY_MS;

/** Rest days already used in the calendar month a given day sits in. Pure. */
export const restDaysUsedInMonth = (entries, dayK) => {
  const month = localMonthKey(dayKeyMs(dayK));
  return (entries || []).filter((e) => {
    if (e?.kind !== 'rest-day') return false;
    const k = localDayKey(e.occurredAt);
    return k !== null && localMonthKey(k * DAY_MS) === month;
  }).length;
};

/**
 * The rest-day law as a pure check: {ok:true} or {ok:false, reason} in the
 * operator's own words. A past day is claimed under the law of ITS day —
 * same allowance, same spacing. Pure.
 */
export const canRestOn = (entries, dayK) => {
  if (isRestDay(entries, dayK)) {
    return { ok: false, reason: 'that day is already claimed as a rest day.' };
  }
  const used = restDaysUsedInMonth(entries, dayK);
  if (used >= REST_DAYS_PER_MONTH) {
    return { ok: false, reason: `no rest days left this month — all ${REST_DAYS_PER_MONTH} used.` };
  }
  // Spacing judges the NEAREST rest day on either side — a past-day claim
  // must not sit beside a rest day any more than a new one may.
  const others = (entries || [])
    .filter((e) => e?.kind === 'rest-day')
    .map((e) => localDayKey(e.occurredAt))
    .filter((k) => k !== null && k !== dayK);
  if (others.length > 0) {
    const nearest = Math.min(...others.map((k) => Math.abs(dayK - k)));
    if (nearest <= REST_DAYS_TRAINING_BETWEEN) {
      return {
        ok: false,
        reason: `too close to another rest day — ${REST_DAYS_TRAINING_BETWEEN} full training days must sit between rest days.`,
      };
    }
  }
  return { ok: true };
};

/** The append door's law: throws the tagged correction when the day may not
 *  rest. Pure — the route maps the tag to a 400 with this exact text. */
export const assertRestDayAllowed = (entries, dayK) => {
  const verdict = canRestOn(entries, dayK);
  if (!verdict.ok) throw _correction(verdict.reason);
  return { kind: 'rest-day' };
};

/**
 * Whether one day is complete under the law of ITS day: every daily then in
 * force completed — or, before any definition existed, at least one logged
 * session (the old law, so history keeps its standing). A claimed rest day
 * completes the day by recovery. Pure.
 */
export const dayComplete = (entries, dayK) => {
  if (isRestDay(entries, dayK)) return true;
  const required = dailiesInForce(entries, dayK);
  if (required.length > 0) {
    const done = _completedOn(entries, dayK);
    return required.every((item) => done.has(item.id));
  }
  return (entries || []).some((e) => e?.kind === 'session' && localDayKey(e.occurredAt) === dayK);
};

/**
 * The streak: consecutive complete days counting back from today — or from
 * yesterday while today is still being lived (an unfinished today never
 * breaks a streak; an unstarted one never extends it). Pure.
 * @param {Array} entries
 * @param {string} now ISO
 * @returns {number}
 */
export const dailyStreakDays = (entries, now) => {
  const today = localDayKey(now);
  if (today === null) return 0;
  let cursor = dayComplete(entries, today) ? today : today - 1;
  let streak = 0;
  while (dayComplete(entries, cursor)) {
    streak += 1;
    cursor -= 1;
  }
  return streak;
};

/**
 * Today's board: each current daily with its done mark, plus the counts the
 * strip shows. null when no dailies are defined — the lane then renders (and
 * the streak means) exactly what it did before dailies existed. Pure.
 * @param {Array} entries
 * @param {string} now ISO
 * @returns {{items: Array<{id, title, done}>, done: number, total: number}|null}
 */
export const dailiesTodayView = (entries, now) => {
  const items = currentDailies(entries);
  if (items.length === 0) return null;
  const dayK = localDayKey(now);
  const doneSet = _completedOn(entries, dayK);
  const board = items.map((i) => ({ id: i.id, title: i.title, done: doneSet.has(i.id) }));
  return {
    items: board,
    done: board.filter((i) => i.done).length,
    total: board.length,
    ...(isRestDay(entries, dayK) ? { resting: true } : {}),
    restDaysLeft: Math.max(0, REST_DAYS_PER_MONTH - restDaysUsedInMonth(entries, dayK)),
  };
};

/**
 * The digest line for the OPERATOR VESSEL prompt section — present only when
 * dailies are defined. Names what is missing today so a being can ask after
 * it precisely, and carries the word-law so it never polices. Pure.
 * @returns {string} '' when no dailies are defined
 */
export const dailiesDigestLine = (entries, now) => {
  const view = dailiesTodayView(entries, now);
  if (!view) return '';
  if (view.resting) {
    return `- Dailies: rest day — recovery is part of the practice, nothing is asked of the body today (${view.restDaysLeft} rest day${view.restDaysLeft === 1 ? '' : 's'} left this month).`;
  }
  const streak = dailyStreakDays(entries, now);
  const missing = view.items.filter((i) => !i.done).map((i) => i.title);
  const state = missing.length === 0
    ? 'all done today'
    : `${view.done}/${view.total} today — open: ${missing.join(' · ')}`;
  return `- Dailies (every one must land for the day to count): ${state}${streak > 0 ? ` · ${streak}-day streak` : ''}. Kept at their word — completions are logged only when they say so.`;
};
