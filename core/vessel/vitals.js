/**
 * Vitals — the human vessel's record.
 *
 * The operator's body is a vessel like any other: it keeps a maintenance log.
 * PRs, bodyweight, training sessions, and life markers (sunlight, social)
 * are appended here by the operator (UI) and by beings (vessel_log — add-only,
 * same one-way discipline as the operator task list). Every number in this
 * module is a recorded measurement or a deterministic aggregate of recorded
 * measurements — nothing is estimated, scored, or invented (the
 * docs/architecture/measurement/stats-and-benchmarks.md honesty doctrine).
 *
 * Pure module: entries in, entries/aggregates out; ids and timestamps come
 * from the impure caller. Validation errors are tagged corrections.
 */

import { localDayKey } from './day-key.js';
import { normalizeDailyItems, resolveDailyCompletion, dailiesDigestLine, dailyStreakDays, assertRestDayAllowed } from './dailies.js';

// 'daily' (a completion), 'dailies-set' (the definition snapshot), and
// 'rest-day' (a claimed recovery day) are the dailies lane — the law over
// them lives in ./dailies.js. 'planned' is work the operator says is coming;
// it feeds no aggregate until a session (optionally carrying its planId)
// says the work happened.
export const VITAL_KINDS = Object.freeze(['pr', 'bodyweight', 'session', 'life', 'daily', 'dailies-set', 'rest-day', 'planned']);
export const VITAL_UNITS = Object.freeze(['kg', 'lb']);
export const LIFE_MARKERS = Object.freeze(['sunlight', 'social', 'other']);
export const LIFT_MAX_CHARS = 60;
export const TITLE_MAX_CHARS = 120;
export const NOTE_MAX_CHARS = 280;
export const PLAN_ID_MAX_CHARS = 64;
export const EXERCISES_MAX = 20;
export const SETS_MAX = 20;

const DAY_MS = 86400000;

const _correction = (msg) => Object.assign(new Error(msg), { correction: true });

const _text = (value, max, what) => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw _correction(`${what} is required.`);
  if (text.length > max) throw _correction(`${what} must stay under ${max} characters.`);
  return text;
};

const _number = (value, { min, max, what, integer = false }) => {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw _correction(`${what} must be a number.`);
  if (integer && !Number.isInteger(n)) throw _correction(`${what} must be a whole number.`);
  if (n < min || n > max) throw _correction(`${what} must be between ${min} and ${max}.`);
  return n;
};

const _unit = (value) => {
  if (!VITAL_UNITS.includes(value)) throw _correction('unit must be kg or lb.');
  return value;
};

const _occurredAt = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || Number.isNaN(Date.parse(text))) {
    throw _correction('occurredAt must be an ISO date or timestamp — YYYY-MM-DD works.');
  }
  return text;
};

// A plan date is a strict YYYY-MM-DD that names a REAL calendar day — JS
// Date.parse quietly rolls 2026-02-30 into March, so the components are
// checked back out of the parsed instant.
const _scheduledFor = (value) => {
  const text = typeof value === 'string' ? value.trim() : '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) throw _correction('scheduledFor must be a YYYY-MM-DD date.');
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const parsed = new Date(Date.UTC(y, mo - 1, d));
  if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() !== mo - 1 || parsed.getUTCDate() !== d) {
    throw _correction('scheduledFor must be a real calendar date.');
  }
  return text;
};

const _set = (value) => {
  const reps = _number(value?.reps, { min: 1, max: 1000, what: 'set reps', integer: true });
  const hasWeight = value?.weight !== undefined && value?.weight !== null && value?.weight !== '';
  const hasUnit = typeof value?.unit === 'string' && value.unit.trim() !== '';
  // Weight and unit stand or fall together: a weighted set is meaningless
  // without its unit, and a unit without a weight records nothing.
  if (hasUnit && !hasWeight) throw _correction('a set unit needs the set\'s weight — drop the unit or give the weight.');
  if (!hasWeight) return { reps };
  if (!hasUnit) throw _correction('a weighted set needs its unit (kg or lb).');
  return { reps, weight: _number(value.weight, { min: 0.5, max: 2000, what: 'set weight' }), unit: _unit(value.unit) };
};

/**
 * Validate and normalize a session/plan exercise list: ≤20 exercises of
 * {lift, sets ≤20 × {reps, weight?, unit?}}. Lift names fold to lowercase
 * like PR lifts, so a session set and a declared PR share one board line.
 * Pure.
 */
export const normalizeExercises = (value) => {
  if (value.length > EXERCISES_MAX) throw _correction(`exercises must stay at ${EXERCISES_MAX} or fewer.`);
  return value.map((ex) => {
    const lift = _text(ex?.lift, LIFT_MAX_CHARS, 'a lift name').toLowerCase();
    const sets = Array.isArray(ex?.sets) ? ex.sets : [];
    if (sets.length === 0) throw _correction(`"${lift}" needs at least one set.`);
    if (sets.length > SETS_MAX) throw _correction(`"${lift}" must stay at ${SETS_MAX} sets or fewer.`);
    return { lift, sets: sets.map(_set) };
  });
};

// The exercises field as an entry carries it: absent, an empty list (reads as
// absent — never stored), or a real list. Anything else is a correction.
const _exercisesField = (value) => {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw _correction('exercises must be an array of {lift, sets}.');
  if (value.length === 0) return undefined;
  return normalizeExercises(value);
};

/**
 * Validate and normalize one entry's fields. Throws the tagged correction
 * on any malformed part. Pure.
 * @param {{kind: string, ...}} args
 * @returns {Object} the normalized fields
 */
export const validateEntry = (args) => {
  const kind = args?.kind;
  if (!VITAL_KINDS.includes(kind)) {
    throw _correction(`kind must be one of: ${VITAL_KINDS.join(', ')}.`);
  }
  const out = { kind };
  if (kind === 'pr') {
    // Lift names normalize to lowercase so "Bench Press" and "bench press"
    // are one line on the PR board, not two.
    out.lift = _text(args?.lift, LIFT_MAX_CHARS, 'a lift name').toLowerCase();
    out.weight = _number(args?.weight, { min: 0.5, max: 2000, what: 'weight' });
    out.reps = _number(args?.reps ?? 1, { min: 1, max: 1000, what: 'reps', integer: true });
    out.unit = _unit(args?.unit);
  } else if (kind === 'bodyweight') {
    out.weight = _number(args?.weight, { min: 20, max: 1000, what: 'bodyweight' });
    out.unit = _unit(args?.unit);
  } else if (kind === 'session') {
    out.title = _text(args?.title, TITLE_MAX_CHARS, 'a session title');
    if (args?.durationMin !== undefined && args.durationMin !== null && args.durationMin !== '') {
      out.durationMin = _number(args.durationMin, { min: 1, max: 1440, what: 'duration (minutes)', integer: true });
    }
    // planId links this session to the planned entry it completes.
    if (args?.planId && String(args.planId).trim()) out.planId = _text(args.planId, PLAN_ID_MAX_CHARS, 'a planId');
    const exercises = _exercisesField(args?.exercises);
    if (exercises) out.exercises = exercises;
    if (args?.note && String(args.note).trim()) out.note = _text(args.note, NOTE_MAX_CHARS, 'a note');
  } else if (kind === 'planned') {
    // Work the operator says is coming — a date and what's on it, never a
    // duration (the work has not happened; nothing has been measured).
    out.title = _text(args?.title, TITLE_MAX_CHARS, 'a plan title');
    out.scheduledFor = _scheduledFor(args?.scheduledFor);
    const exercises = _exercisesField(args?.exercises);
    if (exercises) out.exercises = exercises;
    if (args?.note && String(args.note).trim()) out.note = _text(args.note, NOTE_MAX_CHARS, 'a note');
  } else if (kind === 'dailies-set') {
    out.items = normalizeDailyItems(args?.items);
    // The task-ledger bridge tags its auto-synced snapshots so it only ever
    // rewrites its OWN definitions — a hand-set VESSEL snapshot (no tag)
    // stays authoritative until the operator clears it.
    if (args?.via === 'task-ledger') out.via = 'task-ledger';
  } else if (kind === 'daily') {
    // A completion resolves against the log's current definition, which only
    // appendEntry holds — validateEntry alone cannot admit this kind.
    throw _correction('a daily completion must go through appendEntry (it resolves against the current dailies).');
  } else if (kind === 'rest-day') {
    // A rest-day claim is judged against the log's allowance and spacing law,
    // which only appendEntry holds — validateEntry alone cannot admit it.
    throw _correction('a rest day must go through appendEntry (the allowance and spacing law judges it there).');
  } else { // life
    if (!LIFE_MARKERS.includes(args?.marker)) {
      throw _correction(`marker must be one of: ${LIFE_MARKERS.join(', ')}.`);
    }
    out.marker = args.marker;
    if (args?.note && String(args.note).trim()) out.note = _text(args.note, NOTE_MAX_CHARS, 'a note');
  }
  return out;
};

/**
 * Append one entry to the log. Pure — the caller mints id/now.
 * @param {Array} entries
 * @param {{kind: string, occurredAt?: string, ...}} args
 * @param {{id: string, now: string}} stamp
 * @returns {{entries: Array, entry: Object}}
 */
export const appendEntry = (entries, args, { id, now }) => {
  // A `daily` completion and a `rest-day` claim are the two kinds whose
  // validity depends on the LOG — the completion resolves against the current
  // dailies definition; the rest day is judged against the allowance and
  // spacing law of the day it claims. Each may carry a note like any other
  // kind: the operator's own word on the record. occurredAt is the
  // missed-day road: something done (or rested) but never marked is appended
  // with the day it happened; recordedAt keeps the honest moment of logging.
  const fields = args?.kind === 'daily'
    ? {
      kind: 'daily',
      ...resolveDailyCompletion(entries, args),
      ...(args?.note && String(args.note).trim() ? { note: _text(args.note, NOTE_MAX_CHARS, 'a note') } : {}),
    }
    : args?.kind === 'rest-day'
      ? { ...assertRestDayAllowed(entries, localDayKey(args?.occurredAt ?? now)), ...(args?.note && String(args.note).trim() ? { note: _text(args.note, NOTE_MAX_CHARS, 'a note') } : {}) }
      : validateEntry(args);
  const entry = { id, ...fields, occurredAt: _occurredAt(args?.occurredAt, now), recordedAt: now };
  return { entries: [...(Array.isArray(entries) ? entries : []), entry], entry };
};

// --- Aggregates: deterministic folds over recorded measurements ----------

/**
 * The PR board: per lift+unit, the heaviest weight on record (ties broken by
 * most reps, then most recent). Declared PR entries and every weighted set of
 * a structured session compete on the SAME comparator — a set that outlifts
 * the declared PR is the record. Sorted most-recent record first. Pure.
 */
export const prsByLift = (entries) => {
  const best = new Map();
  const judge = (cand) => {
    const key = `${cand.lift}|${cand.unit}`;
    const cur = best.get(key);
    if (!cur
      || cand.weight > cur.weight
      || (cand.weight === cur.weight && cand.reps > cur.reps)
      || (cand.weight === cur.weight && cand.reps === cur.reps && cand.occurredAt > cur.occurredAt)) {
      best.set(key, cand);
    }
  };
  for (const e of entries || []) {
    if (e?.kind === 'pr') {
      judge({ lift: e.lift, weight: e.weight, reps: e.reps, unit: e.unit, occurredAt: e.occurredAt });
    } else if (e?.kind === 'session' && Array.isArray(e.exercises)) {
      // A set with no weight records work, not a load — it never stands on
      // the board. The set's date is its session's occurredAt.
      for (const ex of e.exercises) {
        for (const s of Array.isArray(ex?.sets) ? ex.sets : []) {
          if (Number.isFinite(s?.weight)) {
            judge({ lift: ex.lift, weight: s.weight, reps: s.reps, unit: s.unit, occurredAt: e.occurredAt });
          }
        }
      }
    }
  }
  return [...best.values()].sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)));
};

/**
 * Bodyweight: latest reading, the delta against the nearest reading at least
 * 30 days old (same unit), and the full series oldest-first. Null when no
 * readings exist. Pure.
 */
export const bodyweightTrend = (entries, now) => {
  const readings = (entries || []).filter((e) => e?.kind === 'bodyweight')
    .slice().sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)));
  if (readings.length === 0) return null;
  const latest = readings[readings.length - 1];
  const cutoff = Date.parse(now) - 30 * DAY_MS;
  const ref = [...readings].reverse().find((e) => Date.parse(e.occurredAt) <= cutoff);
  const delta30d = ref && ref.unit === latest.unit
    ? Math.round((latest.weight - ref.weight) * 10) / 10
    : null;
  return {
    latest,
    delta30d,
    series: readings.map((e) => ({ at: e.occurredAt, weight: e.weight, unit: e.unit })),
  };
};

/**
 * Sessions: total, most recent, whole days since the last one, and how many
 * landed in the last 7 days. Pure.
 */
export const sessionsSummary = (entries, now) => {
  const sessions = (entries || []).filter((e) => e?.kind === 'session')
    .slice().sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)));
  if (sessions.length === 0) return { total: 0, lastAt: null, lastTitle: null, daysSince: null, perWeek: 0 };
  const nowMs = Date.parse(now);
  const lastAt = sessions[0].occurredAt;
  const daysSince = Math.max(0, Math.floor((nowMs - Date.parse(lastAt)) / DAY_MS));
  const perWeek = sessions.filter((e) => Date.parse(e.occurredAt) >= nowMs - 7 * DAY_MS).length;
  return { total: sessions.length, lastAt, lastTitle: sessions[0].title, daysSince, perWeek };
};

/**
 * Consecutive days with at least one session, counting back from today — or
 * from yesterday when today hasn't logged yet (the day isn't lost while it's
 * still being lived). Pure.
 */
export const streakDays = (entries, now) => {
  const days = new Set(
    (entries || []).filter((e) => e?.kind === 'session')
      .map((e) => localDayKey(e.occurredAt))
      .filter((k) => k !== null),
  );
  const today = localDayKey(now);
  let cursor = days.has(today) ? today : today - 1;
  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor -= 1;
  }
  return streak;
};

/** The life markers logged today (sunlight / social / other). Pure. */
export const markersToday = (entries, now) => {
  const today = localDayKey(now);
  return [...new Set(
    (entries || []).filter((e) => e?.kind === 'life' && localDayKey(e.occurredAt) === today)
      .map((e) => e.marker),
  )];
};

const _fmtDays = (n) => (n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`);
const _fmtDelta = (d) => (d === null ? '' : ` (${d > 0 ? '+' : '−'}${Math.abs(d)} over 30d)`);

// A scheduledFor is already an operator-local calendar date (YYYY-MM-DD), so
// its day key is plain UTC math over its components — no clock, no timezone.
const _dayKeyOfLocalDate = (ymd) => {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
};

const _fmtAhead = (n) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);

/**
 * The nearest planned entry whose day is today or ahead, judged by the
 * operator-local calendar (the same local-day law as the streak). Pure.
 * @returns {{entry: Object, daysAhead: number}|null}
 */
export const nextPlanned = (entries, now) => {
  const today = localDayKey(now);
  if (today === null) return null;
  let best = null;
  for (const e of entries || []) {
    if (e?.kind !== 'planned') continue;
    const daysAhead = _dayKeyOfLocalDate(e.scheduledFor) - today;
    if (!Number.isFinite(daysAhead) || daysAhead < 0) continue;
    if (!best || daysAhead < best.daysAhead) best = { entry: e, daysAhead };
  }
  return best;
};

/**
 * The OPERATOR VESSEL prompt digest: the record, plainly, so a being can ask
 * after it and nudge gently. Empty string when nothing is logged — an empty
 * section never rides the prompt. Pure.
 * @param {Array} entries
 * @param {string} now
 * @returns {string}
 */
export const formatVitalsSection = (entries, now) => {
  if (!Array.isArray(entries) || entries.length === 0) return '';
  const sessions = sessionsSummary(entries, now);
  const bw = bodyweightTrend(entries, now);
  const prs = prsByLift(entries);
  const streak = streakDays(entries, now);
  const markers = markersToday(entries, now);

  // With dailies defined, the streak the digest speaks IS the all-dailies
  // streak (the same number the VESSEL tile shows); its own line carries the
  // board. Without them, everything reads exactly as it always did.
  const dailiesLine = dailiesDigestLine(entries, now);
  const spokenStreak = dailiesLine ? dailyStreakDays(entries, now) : streak;
  const planned = nextPlanned(entries, now);

  const lines = [];
  if (sessions.total > 0) {
    lines.push(`- Last training session: "${sessions.lastTitle}" (${_fmtDays(sessions.daysSince)}) · ${sessions.perWeek} this week${spokenStreak > 1 ? ` · ${spokenStreak}-day streak` : ''}`);
  }
  if (dailiesLine) lines.push(dailiesLine);
  // What's ahead rides beside the record — additive only: no upcoming plan,
  // no line, and the digest is byte-identical to before planned existed.
  if (planned) {
    const first = Array.isArray(planned.entry.exercises) ? planned.entry.exercises[0] : null;
    const preview = first ? ` · ${first.lift} ${first.sets.length}×${first.sets[0].reps}` : '';
    lines.push(`- Planned: "${planned.entry.title}" (${_fmtAhead(planned.daysAhead)})${preview}`);
  }
  if (bw) {
    lines.push(`- Bodyweight: ${bw.latest.weight} ${bw.latest.unit}${_fmtDelta(bw.delta30d)}`);
  }
  if (prs.length > 0) {
    const newest = prs[0];
    lines.push(`- PRs on record: ${prs.length} lift(s) — latest: ${newest.lift} ${newest.weight} ${newest.unit} × ${newest.reps}`);
  }
  if (markers.length > 0) {
    lines.push(`- Today: ${markers.join(' · ')} logged`);
  }
  if (lines.length === 0) return '';
  return `## Your Operator's Vessel\nThe record of their body's maintenance — measurements they logged or asked you to log, never estimates. You may ask after it and nudge gently when the record goes quiet; never shame, and never invent a number that is not here.\n${lines.join('\n')}`;
};
