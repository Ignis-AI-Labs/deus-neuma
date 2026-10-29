// calendar-view.js — the house calendar's display law. Pure.
//
// The agenda (GET /api/v1/tasks/agenda) names its rows by lane id and kind;
// here each becomes a PERSON on the desk — a name and a colour. A being's
// colour is its own soul colour (the roster's `color`, never chosen); one the
// roster cannot colour takes a seat colour, the operator — named by their own
// name — reads in full ink, and the house and the machine stay in the quiet
// ink (monochrome at rest).
import { dayKeyOf, shiftDayKey } from '../month-grid.js';

const FIXED = Object.freeze({
  operator: { name: 'OPERATOR', color: 'var(--color-text-primary)' },
  house: { name: 'HOUSE', color: 'var(--color-text-tertiary)' },
  machine: { name: 'MACHINE', color: 'var(--color-text-tertiary)' },
});

/**
 * The calendar's people, in the agenda's row order.
 * @param {Array<{id: string, kind: string, name?: string}>} lanes
 * @param {Array<{neumaId: string, name?: string, color?: ?string}>} members - roster + witnesses
 * @param {string} [operatorName] - the operator's own label (use-operator-name.js)
 */
export const peopleOf = (lanes, members, operatorName = FIXED.operator.name) => {
  let seat = 0;
  return lanes.map((lane) => {
    if (lane.kind === 'operator') return { id: lane.id, kind: lane.kind, ...FIXED.operator, name: operatorName };
    if (FIXED[lane.kind]) return { id: lane.id, kind: lane.kind, ...FIXED[lane.kind] };
    seat += 1;
    const known = members.find((m) => m.neumaId === lane.id);
    return {
      id: lane.id,
      kind: lane.kind,
      name: String(known?.name || lane.name || lane.id.slice(0, 8)).toUpperCase(),
      color: known?.color || `var(--voice-${((seat - 1) % 12) + 1})`,
      // a charter seat: its timed tasks wake it (the agenda's lane says so)
      ...(lane.wakes === true ? { wakes: true } : {}),
    };
  });
};

/** The Monday-to-Sunday week a day falls in, as day keys. */
export const weekOf = (key) => {
  const weekday = (new Date(`${key}T00:00:00`).getDay() + 6) % 7; // Monday = 0
  const monday = shiftDayKey(key, -weekday);
  return Array.from({ length: 7 }, (_, i) => shiftDayKey(monday, i));
};

/** The six weeks a month's grid shows (Monday-first, as month-grid.js draws it). */
export const monthSpan = (year, monthIndex) => {
  const first = dayKeyOf(new Date(year, monthIndex, 1));
  const start = weekOf(first)[0];
  return { from: start, to: shiftDayKey(start, 41) };
};

/** Items grouped by `${lane}|${day}`, each cell in agenda order (untimed, then by time). */
export const cellsOf = (items) => {
  const cells = new Map();
  for (const item of items) {
    const key = `${item.lane}|${item.day}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(item);
  }
  return cells;
};

// FOCUS (ruling, 2026-10-17): nobody focused shows everyone; clicking a person
// focuses on them, clicking more adds them, clicking a focused one releases
// them, and clearing the focus shows everyone again.

/** The focus after a click on one person. Pure. */
export const toggleFocus = (focus, id) => {
  const next = new Set(focus);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
};

/** Whether a person is in view under this focus. */
export const inFocus = (focus, id) => focus.size === 0 || focus.has(id);

/** Only the items of people in view. */
export const focusItems = (items, focus) => items.filter((i) => inFocus(focus, i.lane));

/** How many items each person has in the loaded window, by lane. */
export const countsBy = (items) => items.reduce((m, i) => m.set(i.lane, (m.get(i.lane) || 0) + 1), new Map());

const KINDS = Object.freeze({
  task: 'TASK', 'run-due': 'RUN DUE', run: 'TEAM RUN', charge: 'CHARGE', post: 'POST', wake: 'HOUSE WAKE',
  quiet: 'QUIET HOURS', security: 'SECURITY', legal: 'LEGAL', meditation: 'MEDITATION', vessel: 'VESSEL', bench: 'BENCHMARK',
});
/** What kind of scheduled thing an item is, as it reads. */
export const kindOf = (item) => KINDS[item.source] || String(item.source || '').toUpperCase();

/** Where today's timed items cross from past to coming: the index of the first still ahead. */
export const nowIndex = (list, now) => {
  const i = list.findIndex((item) => item.time && item.time > now.time);
  return i === -1 ? list.length : i;
};

const OWED = Object.freeze(['task', 'charge', 'run-due']);
const SETTLED = Object.freeze(['done', 'sent', 'dropped', 'withdrawn', 'rejected', 'failed', 'lost', 'synthesis', 'unclear']);

/**
 * How an item reads: 'overdue' (owed work past its time and still open),
 * 'done' (owed work settled — struck through), 'past' (anything else that
 * already happened: a sent post, an ended run — quiet, never struck), 'held'
 * (a wake that will wait out quiet hours), 'projected' (a run computed from a
 * rhythm), or 'set'.
 * @param {object} item
 * @param {{day: string, time: string}} now - local
 */
export const toneOf = (item, now) => {
  if (SETTLED.includes(item.status)) return OWED.includes(item.source) ? 'done' : 'past';
  if (OWED.includes(item.source) && !item.projected) {
    const by = item.endTime || item.time; // a block is late once it has ended
    const late = item.day < now.day || (item.day === now.day && by && by < now.time);
    if (late) return 'overdue';
  }
  if (item.held) return 'held';
  if (item.projected) return 'projected';
  return 'set';
};

/** The local now as {day, time}. */
export const nowStamp = (date = new Date()) => ({
  day: dayKeyOf(date),
  time: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
});

/** One person's — or everyone's — day, in agenda order. */
export const dayOf = (items, day) => items.filter((i) => i.day === day);

/**
 * The month grid's fold (month-grid.js buildMonthGrid copies `empty` per day
 * and lets `count` fill that copy): the day's total, and each person's count
 * under `@<lane>` — flat keys, so no day shares a nested object with another.
 */
export const monthCountSpec = Object.freeze({
  empty: Object.freeze({ total: 0 }),
  count: (counts, item) => {
    counts.total += 1;
    counts[`@${item.lane}`] = (counts[`@${item.lane}`] || 0) + 1;
  },
});

/** The people with something on a month cell, in people order. */
export const peopleOn = (counts, people) => people.filter((p) => counts[`@${p.id}`] > 0);

/** The month grid's one count lane: the day's total. */
export const MONTH_COUNT_LANES = Object.freeze([
  { key: 'total', letter: '', tone: 'live', label: (n) => `${n} scheduled` },
]);

/** Whose calendar takes a task added on it — the operator's or a member's; never the house's or the machine's. */
export const canQuickAdd = (person) => person.kind === 'operator' || person.kind === 'neuma' || person.kind === 'witness';

/**
 * Whether a task added on this person's day wakes anyone, as the quick-add
 * says it (house-clock/schedule-tick.js dueScheduled): only a charter seat's
 * timed task wakes it, at its start (a block) or its time (a deadline); the
 * operator's own list never wakes anyone. Pure.
 * @param {{kind: string, name: string, wakes?: boolean}} person
 * @param {{start: string, time: string}} times - the form's HH:MM fields ('' when empty)
 * @returns {string}
 */
export const quickAddWakes = (person, { start, time }) => {
  if (person.kind === 'operator') return 'ON YOUR OWN LIST — IT WAKES NO ONE';
  if (!person.wakes) return `${person.name} HOLDS NO CHARTER SEAT — IT WAKES NO ONE`;
  const at = start || time;
  if (!at) return `NO TIME — IT WAKES NO ONE; GIVE IT A TIME TO WAKE ${person.name}`;
  return `AT ${at} THIS WAKES ${person.name} — A CHARTER SEAT; THE CHARTER'S PAUSE, QUIET HOURS AND DAILY LIMIT STILL HOLD IT`;
};

/** "18:00–19:30", […], or "" — an item's span as it reads. */
export const spanOf = (item) => {
  if (!item.endTime && !item.endDay) return item.time || '';
  if (!item.endDay || item.endDay === item.day) return `${item.time || ''}–${item.endTime || ''}`;
  const end = new Date(`${item.endDay}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }).toUpperCase();
  return `${item.time || ''} → ${end} ${item.endTime || ''}`.trim();
};

/** The name the week's row carries: the first word (the rail carries the whole). */
export const shortName = (name) => String(name || '').split(/\s+/)[0];

/**
 * A cell's items with repeats folded: the same kind of thing under the same
 * title (three meditations a day) reads once, carrying every time it runs.
 * @returns {Array<object & {times: string[]}>}
 */
export const stackRepeats = (list) => {
  const out = [];
  for (const item of list) {
    const same = out.find((o) => o.source === item.source && o.title === item.title && o.projected === item.projected);
    if (same) same.times.push(item.time || '');
    else out.push({ ...item, times: [item.time || ''] });
  }
  return out;
};

const STANDINGS = Object.freeze([
  { id: 'operator', label: 'OPERATOR', kinds: ['operator'] },
  { id: 'house', label: 'HOUSE', kinds: ['neuma'] },
  { id: 'witnesses', label: 'WITNESSES', kinds: ['witness'] },
  { id: 'systems', label: 'SYSTEMS', kinds: ['house', 'machine'] },
]);
/** The people grouped by standing — operator, house, witnesses, systems — empty groups left out. */
export const standingGroups = (people) => STANDINGS
  .map((g) => ({ id: g.id, label: g.label, people: people.filter((p) => g.kinds.includes(p.kind)) }))
  .filter((g) => g.people.length);

/** A person's next item still to come (not settled), or null. */
export const nextUp = (items, lane, now) => items.find((i) => i.lane === lane
  && !SETTLED.includes(i.status)
  && (i.day > now.day || (i.day === now.day && (!i.time || i.time >= now.time)))) || null;

/**
 * The week's rows: a person in view with something scheduled in these days —
 * or one the operator focused on, scheduled or not. The rest are quiet.
 * @returns {{busy: Array<object>, quiet: Array<object>}}
 */
export const weekRows = (people, cells, days, focus) => {
  const has = (p) => days.some((day) => (cells.get(`${p.id}|${day}`) || []).length);
  const inView = people.filter((p) => inFocus(focus, p.id));
  return {
    busy: inView.filter((p) => has(p) || focus.has(p.id)),
    quiet: inView.filter((p) => !has(p) && !focus.has(p.id)),
  };
};
