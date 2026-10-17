/**
 * Vessel calendar — the pure folds behind the VESSEL month grid and day
 * view, proven pure (RULE 0: real inputs, real outputs, no mock anywhere).
 * The scenarios pin: the day-join (planned by scheduledFor, dailies-set
 * belongs to no day), the S/D/P count fold over the shared month-grid leaf,
 * the day view judged by the dailies law of ITS day, plan completion as one
 * fold, the backfill list, and the honesty reads (restored entries, the
 * local-noon backfill stamp).
 */
import { describe, expect, it } from 'vitest';
import { buildMonthGrid, dayKeyOf } from '../../frontend/app/RelinkShell/month-grid.js';
import {
  vesselDayOfEntry, vesselCountSpec, vesselCountLanes, dailiesInForceOn,
  dayView, planCompletion, missingDailies, lastSessionTitle,
  backfillNoonIso, isRestored,
} from '../../frontend/app/RelinkShell/vessel-calendar.js';

// Same fixture style as vessel-dailies.test.js: 10:00Z stands on the same
// local day under this host's offset; day keys are derived through dayKeyOf
// itself so the assertions hold under any offset the suite runs on.
const day = (offset, time = 'T10:00:00Z') => {
  const d = new Date(Date.parse('2026-08-28T00:00:00Z') + offset * 86400000);
  return d.toISOString().slice(0, 10) + time;
};
const key = (iso) => dayKeyOf(iso);

const A = { id: 'a', title: 'Pre-desk 15 min' };
const B = { id: 'b', title: 'Stretch' };
const setDef = (at, items) => ({ id: `def-${at}`, kind: 'dailies-set', items, occurredAt: at, recordedAt: at });
const done = (at, dailyId, title) => ({ id: `done-${dailyId}-${at}`, kind: 'daily', dailyId, title, occurredAt: at, recordedAt: at });
const session = (at, over = {}) => ({ id: `s-${at}`, kind: 'session', title: 'push day', occurredAt: at, recordedAt: at, ...over });

describe('vesselDayOfEntry — the day-join', () => {
  it('sessions, PRs, bodyweight, life, and dailies stand on their local occurredAt day', () => {
    for (const kind of ['session', 'pr', 'bodyweight', 'life', 'daily']) {
      expect(vesselDayOfEntry({ kind, occurredAt: day(-1) })).toBe(key(day(-1)));
    }
  });

  it('planned stands on its scheduledFor date verbatim — not on any timestamp', () => {
    expect(vesselDayOfEntry({ kind: 'planned', scheduledFor: '2026-09-03', occurredAt: day(0), recordedAt: day(0) }))
      .toBe('2026-09-03');
    expect(vesselDayOfEntry({ kind: 'planned', scheduledFor: '2026-02-30' })).toBeNull(); // not a date shape
  });

  it('dailies-set belongs to NO day — a definition is not an event', () => {
    expect(vesselDayOfEntry(setDef(day(-1), [A]))).toBeNull();
  });

  it('an unparseable timestamp never guesses a day', () => {
    expect(vesselDayOfEntry({ kind: 'session', occurredAt: 'not-a-date' })).toBeNull();
    expect(vesselDayOfEntry(null)).toBeNull();
    expect(vesselDayOfEntry({ kind: 'mystery', occurredAt: day(0) })).toBeNull();
  });
});

describe('the count fold over the shared month grid — S sessions · D dailies · P planned', () => {
  const NOW = new Date(2026, 7, 15, 12, 0, 0).getTime();
  const grid = (entries) => buildMonthGrid(2026, 7, entries, {
    now: NOW, dayKeyOfEntry: vesselDayOfEntry, countSpec: vesselCountSpec,
  });
  const cellFor = (weeks, date) => weeks.flat().find((c) => c.date === date);

  it('folds the vessel taxonomy; PRs and markers join no count lane', () => {
    const weeks = grid([
      { id: 's1', kind: 'session', occurredAt: new Date(2026, 7, 14, 7).toISOString() },
      { id: 's2', kind: 'session', occurredAt: new Date(2026, 7, 14, 18).toISOString() },
      { id: 'd1', kind: 'daily', dailyId: 'a', occurredAt: new Date(2026, 7, 14, 21).toISOString() },
      { id: 'p1', kind: 'planned', title: 'leg day', scheduledFor: '2026-08-20' },
      { id: 'pr1', kind: 'pr', occurredAt: new Date(2026, 7, 14, 8).toISOString() },
      { id: 'm1', kind: 'life', marker: 'sunlight', occurredAt: new Date(2026, 7, 20, 9).toISOString() },
    ]);
    expect(cellFor(weeks, 14).counts).toEqual({ S: 2, D: 1, P: 0 });
    expect(cellFor(weeks, 20).counts).toEqual({ S: 0, D: 0, P: 1 });
  });

  it('a dailies-set counts nowhere — every counted entry is an event', () => {
    const weeks = grid([
      setDef(day(-20), [A, B]),
      { id: 'd1', kind: 'daily', dailyId: 'a', occurredAt: new Date(2026, 7, 10, 9).toISOString() },
    ]);
    const total = weeks.flat().reduce((n, c) => n + c.counts.S + c.counts.D + c.counts.P, 0);
    expect(total).toBe(1);
  });

  it('the spec is frozen and the lanes carry the S/D/P tones', () => {
    expect(Object.isFrozen(vesselCountSpec)).toBe(true);
    expect(Object.isFrozen(vesselCountSpec.empty)).toBe(true);
    expect(vesselCountLanes.map((l) => [l.key, l.letter, l.tone])).toEqual([
      ['S', 'S', 'live'], ['D', 'D', 'done'], ['P', 'P', 'await'],
    ]);
    expect(vesselCountLanes[0].label(1)).toBe('1 session');
    expect(vesselCountLanes[1].label(2)).toBe('2 dailies done');
  });
});

describe('dailiesInForceOn — the mirror of the day law', () => {
  it('the latest snapshot on/before the day stands; later snapshots change later days only', () => {
    const entries = [setDef(day(-5), [A]), setDef(day(-2), [A, B])];
    expect(dailiesInForceOn(entries, key(day(-3)))).toEqual([A]);
    expect(dailiesInForceOn(entries, key(day(-2)))).toEqual([A, B]);
    expect(dailiesInForceOn(entries, key(day(-6)))).toEqual([]); // pre-definition
  });

  it('a cleared board falls to the session law, exactly as the server judges', () => {
    const entries = [setDef(day(-5), [A]), setDef(day(-1), [])];
    expect(dailiesInForceOn(entries, key(day(-1)))).toEqual([]);
  });

  it('the fold is array-order independent — occurredAt breaks the ties', () => {
    // Local-time construction: both snapshots stand on 2026-08-23 in ANY
    // offset (the day-key mirror reads local days, like the server's law).
    const morning = new Date(2026, 7, 23, 9, 0, 0).toISOString();
    const evening = new Date(2026, 7, 23, 21, 0, 0).toISOString();
    const oldestFirst = [setDef(morning, [A]), setDef(evening, [A, B])];
    const newestFirst = [...oldestFirst].reverse();
    expect(dailiesInForceOn(oldestFirst, '2026-08-23')).toEqual([A, B]);
    expect(dailiesInForceOn(newestFirst, '2026-08-23')).toEqual([A, B]);
  });
});

describe('dayView — one day, whole', () => {
  const withExercises = session(day(-1), {
    title: 'push day',
    exercises: [{ lift: 'bench press', sets: [{ reps: 8, weight: 60, unit: 'kg' }, { reps: 6, weight: 60, unit: 'kg' }] }],
  });
  const entries = [
    setDef(day(-3), [A, B]),
    done(day(-1), 'a', A.title),
    withExercises,
    { id: 'pr1', kind: 'pr', lift: 'bench press', weight: 60, reps: 8, unit: 'kg', occurredAt: day(-1), recordedAt: day(-1) },
    { id: 'bw1', kind: 'bodyweight', weight: 80.5, unit: 'kg', occurredAt: day(-1), recordedAt: day(-1) },
    { id: 'm1', kind: 'life', marker: 'sunlight', occurredAt: day(-1), recordedAt: day(-1) },
    { id: 's-other', kind: 'session', title: 'other day', occurredAt: day(-2), recordedAt: day(-2) },
  ];

  it('the dailies board is judged by the law of ITS day, with the done marks of ITS day', () => {
    const view = dayView(entries, key(day(-1)));
    expect(view.dailies.items).toEqual([
      { id: 'a', title: A.title, done: true },
      { id: 'b', title: B.title, done: false },
    ]);
  });

  it('sessions keep their exercises; the rest of the day partitions by kind; other days stay out', () => {
    const view = dayView(entries, key(day(-1)));
    expect(view.sessions).toEqual([withExercises]);
    expect(view.sessions[0].exercises[0].sets).toHaveLength(2);
    expect(view.prs.map((e) => e.id)).toEqual(['pr1']);
    expect(view.bodyweight.map((e) => e.id)).toEqual(['bw1']);
    expect(view.markers.map((e) => e.id)).toEqual(['m1']);
    expect(dayView(entries, key(day(0))).sessions).toEqual([]);
  });

  it('planned items carry their completion state from the plan fold', () => {
    const plan = { id: 'p1', kind: 'planned', title: 'leg day', scheduledFor: key(day(-1)) };
    const completed = session(day(0), { title: 'leg day', planId: 'p1' });
    expect(dayView([...entries, plan], key(day(-1))).planned[0].completedBy).toBeNull();
    expect(dayView([...entries, plan, completed], key(day(-1))).planned[0].completedBy).toBe(completed);
  });
});

describe('planCompletion — one fold, the first (newest) session stands', () => {
  it('maps planId to session; sessions without a planId complete nothing', () => {
    const newest = session(day(0), { planId: 'p1' });
    const older = session(day(-2), { planId: 'p1' });
    const map = planCompletion([newest, session(day(-1)), older]);
    expect(map.get('p1')).toBe(newest);
    expect(map.size).toBe(1);
  });
});

describe('missingDailies — the backfill list', () => {
  it('in-force minus done; empty when all landed or nothing stood', () => {
    const entries = [setDef(day(-3), [A, B]), done(day(-1), 'a', A.title)];
    expect(missingDailies(entries, key(day(-1)))).toEqual([B]);
    expect(missingDailies([...entries, done(day(-1), 'b', B.title)], key(day(-1)))).toEqual([]);
    expect(missingDailies(entries, key(day(-4)))).toEqual([]); // pre-definition
  });
});

describe('the honesty reads', () => {
  it('backfillNoonIso is the day\'s LOCAL noon — it always maps back to its own day', () => {
    for (const k of ['2026-01-01', '2026-08-14', '2026-12-31']) {
      const iso = backfillNoonIso(k);
      expect(dayKeyOf(iso)).toBe(k);
      expect(new Date(iso).getHours()).toBe(12);
    }
  });

  it('isRestored flags entries written more than a day after they happened', () => {
    expect(isRestored({ occurredAt: day(-3), recordedAt: day(0) })).toBe(true);
    expect(isRestored({ occurredAt: day(-1, 'T23:00:00Z'), recordedAt: day(0, 'T10:00:00Z') })).toBe(false);
    expect(isRestored({ occurredAt: 'garbage', recordedAt: day(0) })).toBe(false);
  });

  it('lastSessionTitle is the newest session\'s title, or empty', () => {
    expect(lastSessionTitle([session(day(-2), { title: 'pull day' }), session(day(-1), { title: 'push day' })]))
      .toBe('push day');
    expect(lastSessionTitle([setDef(day(-1), [A])])).toBe('');
  });
});
