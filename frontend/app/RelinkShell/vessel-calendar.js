// vessel-calendar.js — every fold the VESSEL calendar and day view need over
// the operator's vitals log. Pure throughout: entries in, views out; the
// impure caller (VesselCalendar.jsx) fetches and posts.
//
// The dailies judgment MIRRORS the law in core/vessel/dailies.js (a day's
// definition is the latest `dailies-set` standing on/before that day; a
// daily counts when its completion logged that day). The server remains the
// authority — the streak on the summary strip is its fold; this module only
// shapes the read model the calendar renders. The one deliberate difference:
// same-day definition ties break on the occurredAt timestamp, not array
// order, so the mirror is stable however the API orders the page it returns.
//
// Day keys are the operator-local 'YYYY-MM-DD' of month-grid.js — the same
// local-day law as core/vessel/day-key.js, so the calendar's days are the
// streak's days.

import { dayKeyOf } from './month-grid.js';

const DAY_MS = 86400000;

// Kinds a day owns by WHEN THEY HAPPENED. `planned` belongs to its named
// future/past date instead; `dailies-set` is a definition, not an event —
// it belongs to no day.
const OCCURRED_KINDS = Object.freeze(['session', 'pr', 'bodyweight', 'life', 'daily']);

const DAY_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// A day key that names a REAL calendar day — the server's scheduledFor law
// (JS Date.parse quietly rolls 2026-02-30 into March; the components are
// checked back out of the parsed instant). Pure.
const _realDayKey = (text) => {
  if (typeof text !== 'string') return null;
  const m = DAY_KEY_RE.exec(text.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const parsed = new Date(Date.UTC(y, mo - 1, d));
  if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() !== mo - 1 || parsed.getUTCDate() !== d) {
    return null;
  }
  return m[0];
};

/**
 * The local day an entry belongs to, or null when it belongs to none.
 * session/pr/bodyweight/life/daily stand on their occurredAt day; planned
 * stands on its scheduledFor date verbatim; dailies-set names no day; an
 * unparseable timestamp never guesses. Pure.
 * @param {object} entry
 * @returns {string|null} 'YYYY-MM-DD'
 */
export const vesselDayOfEntry = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  if (entry.kind === 'planned') {
    return _realDayKey(entry.scheduledFor);
  }
  if (!OCCURRED_KINDS.includes(entry.kind)) return null;
  if (!Number.isFinite(Date.parse(entry.occurredAt))) return null;
  return dayKeyOf(entry.occurredAt);
};

/**
 * The vessel count taxonomy for buildMonthGrid: S sessions, D daily
 * completions, P planned. Other day-bound kinds (pr, bodyweight, life) join
 * their day in the day view but carry no month count — the cell shows only
 * what decides whether the day is worth opening. Pure; `count` mutates only
 * the per-day copy buildMonthGrid hands it (its documented contract).
 */
export const vesselCountSpec = Object.freeze({
  empty: Object.freeze({ S: 0, D: 0, P: 0 }),
  count: (counts, entry) => {
    const lane = { session: 'S', daily: 'D', planned: 'P' }[entry.kind];
    if (lane) counts[lane] += 1;
  },
});

/**
 * The cell's count lanes, in render order: S speaks live (work done, the
 * body's signal), D rests done, P awaits (work owed). `label` speaks the
 * count for the cell's aria-label. Frozen lane objects over the frozen list.
 */
export const vesselCountLanes = Object.freeze([
  { key: 'S', letter: 'S', tone: 'live', label: (n) => `${n} ${n === 1 ? 'session' : 'sessions'}` },
  { key: 'D', letter: 'D', tone: 'done', label: (n) => `${n} ${n === 1 ? 'daily' : 'dailies'} done` },
  { key: 'P', letter: 'P', tone: 'await', label: (n) => `${n} planned` },
]);

/**
 * The dailies definition in force on a day — the mirror of the server's
 * dailiesInForce: the latest `dailies-set` whose local day is on/before it
 * (latest occurredAt breaks same-day ties, so the fold is array-order
 * independent). [] when no definition stood yet OR the board was cleared —
 * both fall to the session law, exactly as the server judges. Pure.
 * @param {Array} entries
 * @param {string} dayKey 'YYYY-MM-DD'
 * @returns {Array<{id: string, title: string}>}
 */
export const dailiesInForceOn = (entries, dayKey) => {
  let items = [];
  let bestAt = null;
  for (const e of entries || []) {
    if (e?.kind !== 'dailies-set') continue;
    const at = Date.parse(e.occurredAt);
    if (!Number.isFinite(at) || dayKeyOf(e.occurredAt) > dayKey) continue;
    if (bestAt === null || at >= bestAt) {
      items = Array.isArray(e.items) ? e.items : [];
      bestAt = at;
    }
  }
  return items;
};

// The daily ids completed on one day. Pure.
const _completedIdsOn = (entries, dayKey) => new Set(
  (entries || []).filter((e) => e?.kind === 'daily' && vesselDayOfEntry(e) === dayKey)
    .map((e) => e.dailyId),
);

/**
 * The dailies in force on a day that have NO completion logged that day —
 * the backfill list for a past day's LOG FOR THIS DAY. [] when nothing was
 * in force (the session law owns those days). Pure.
 */
export const missingDailies = (entries, dayKey) => {
  const done = _completedIdsOn(entries, dayKey);
  return dailiesInForceOn(entries, dayKey).filter((item) => !done.has(item.id));
};

/**
 * Plan completion as one fold: Map(planId → session). The FIRST session in
 * array order carrying a planId is kept — the API page arrives newest-first,
 * so this is the most recent completing session, and the state survives a
 * duplicate log. Pure.
 * @returns {Map<string, object>}
 */
export const planCompletion = (entries) => {
  const byPlan = new Map();
  for (const e of entries || []) {
    if (e?.kind !== 'session' || !e.planId) continue;
    if (!byPlan.has(e.planId)) byPlan.set(e.planId, e);
  }
  return byPlan;
};

/**
 * One day, whole: the sessions (exercises intact), the dailies board judged
 * by the law of THIS day (each in-force item with its done mark), the
 * planned work with its completion state, and the day's PRs / bodyweight /
 * life markers. Arrays are fresh per call; entries themselves are shared,
 * never mutated. Pure.
 * @param {Array} entries
 * @param {string} dayKey 'YYYY-MM-DD'
 */
export const dayView = (entries, dayKey) => {
  const list = Array.isArray(entries) ? entries : [];
  const onDay = (e) => vesselDayOfEntry(e) === dayKey;
  const completedBy = planCompletion(list);
  const done = _completedIdsOn(list, dayKey);
  return {
    sessions: list.filter((e) => e.kind === 'session' && onDay(e)),
    dailies: {
      items: dailiesInForceOn(list, dayKey)
        .map((item) => ({ id: item.id, title: item.title, done: done.has(item.id) })),
    },
    planned: list.filter((e) => e.kind === 'planned' && onDay(e))
      .map((plan) => ({ ...plan, completedBy: completedBy.get(plan.id) ?? null })),
    prs: list.filter((e) => e.kind === 'pr' && onDay(e)),
    bodyweight: list.filter((e) => e.kind === 'bodyweight' && onDay(e)),
    markers: list.filter((e) => e.kind === 'life' && onDay(e)),
  };
};

/**
 * The most recent session's title — the default for a session backfill form,
 * so a restored day names the work the operator actually does. '' when no
 * session exists. Pure.
 */
export const lastSessionTitle = (entries) => {
  let title = '';
  let bestAt = null;
  for (const e of entries || []) {
    if (e?.kind !== 'session') continue;
    const at = Date.parse(e.occurredAt);
    if (!Number.isFinite(at)) continue;
    if (bestAt === null || at >= bestAt) { title = e.title || ''; bestAt = at; }
  }
  return title;
};

/**
 * The occurredAt a backfill carries: the day's LOCAL noon, as ISO. Noon is
 * the one hour that maps back to the same local day under every timezone
 * this machine can run in — the restored entry stands plainly inside its
 * day, never on a boundary. Pure.
 * @param {string} dayKey 'YYYY-MM-DD'
 * @returns {string} ISO timestamp
 */
export const backfillNoonIso = (dayKey) => new Date(`${dayKey}T12:00:00`).toISOString();

/**
 * The honesty read: was this entry written more than a day after it
 * happened? A restored entry shows its LOGGED date rather than letting the
 * record pretend it was written at the time. Pure.
 */
export const isRestored = (entry) => {
  const occurred = Date.parse(entry?.occurredAt);
  const recorded = Date.parse(entry?.recordedAt);
  return Number.isFinite(occurred) && Number.isFinite(recorded)
    && recorded - occurred > DAY_MS;
};
