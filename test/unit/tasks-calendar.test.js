// tasks-calendar.js — pure proofs of the TASKS calendar's read model: the
// day-join law (explicit dueDate pins the day; a bare dueTime is TODAY),
// the month counts, and the overdue-first day view.

import { describe, it, expect } from 'vitest';
import {
  taskDayOfEntry, taskCountSpec, taskCountLanes, taskDayView, taskTotals,
  calendarLaneOptions, filterByLane,
} from '../../frontend/app/RelinkShell/tasks-calendar.js';

const NOW = new Date(2026, 8, 20, 12); // 2026-09-20 local noon

const DEADLINES = [
  { id: '1', source: 'OPERATOR', title: 'milestone', dueDate: '2026-09-20' },
  { id: '2', source: 'KE · LANE', title: 'daily by evening', dueTime: '18:00' },
  { id: '3', source: 'SOL · STANDING', title: 'later this month', dueDate: '2026-09-28', dueTime: '09:00' },
];

describe('tasks-calendar — the day join', () => {
  it('an explicit dueDate pins the day; a bare dueTime is TODAY only', () => {
    expect(taskDayOfEntry(DEADLINES[0], NOW)).toBe('2026-09-20');
    expect(taskDayOfEntry(DEADLINES[1], NOW)).toBe('2026-09-20');
    // Tomorrow the daily joins TOMORROW — a due time recurs, a month of
    // identical cells would be noise.
    expect(taskDayOfEntry(DEADLINES[1], new Date(2026, 8, 21, 12))).toBe('2026-09-21');
    expect(taskDayOfEntry({}, NOW)).toBeNull();
  });

  it('the month grid counts T due and O overdue per the taxonomy', () => {
    const counts = { ...taskCountSpec.empty };
    for (const entry of DEADLINES) taskCountSpec.count(counts, entry);
    expect(counts).toEqual({ T: 3, O: 0 }); // nothing is overdue at local noon
    const late = { ...taskCountSpec.empty };
    taskCountSpec.count(late, { ...DEADLINES[1], overdue: true });
    expect(late).toEqual({ T: 1, O: 1 });
    expect(taskCountLanes.map((l) => l.key)).toEqual(['O', 'T']);
  });

  it('the day view is overdue-first, then by moment; totals speak the house', () => {
    // 'milestone' has no time (due 23:59, not overdue at noon); the daily at
    // 18:00 is upcoming too — add one that IS overdue to see the ordering.
    const overdue = { id: '4', source: 'OPERATOR', title: 'late errand', dueDate: '2026-09-20', dueTime: '08:00' };
    const view = taskDayView([DEADLINES[0], overdue], '2026-09-20', NOW);
    expect(view.map((r) => r.title)).toEqual(['late errand', 'milestone']);
    expect(view[0].overdue).toBe(true);

    const totals = taskTotals([...DEADLINES, overdue], NOW);
    expect(totals.dueToday).toBe(3);
    expect(totals.overdue).toBe(1);
  });
});

describe('tasks-calendar — the house lane filter', () => {
  const HOUSE = [
    { id: '1', source: 'OPERATOR', title: 'mine', laneId: 'me', kind: 'operator', laneName: 'ME', dueDate: '2026-09-20' },
    { id: '2', source: 'KE · STANDING', title: 'ke standing', laneId: 'ke', kind: 'neuma', laneName: 'KE', dueDate: '2026-09-20' },
    { id: '3', source: 'KE · LANE', title: 'ke own', laneId: 'ke', kind: 'neuma', laneName: 'KE', dueTime: '18:00' },
    { id: '4', source: 'SOL · LANE', title: 'sol own', laneId: 'sol', kind: 'witness', laneName: 'SOL', dueDate: '2026-09-21' },
  ];

  it('the rail counts the standings and the lanes', () => {
    const options = calendarLaneOptions(HOUSE);
    expect(options.me).toBe(1);
    expect(options.house).toBe(2);
    expect(options.witnesses).toBe(1);
    expect(options.lanes).toEqual([
      { laneId: 'ke', kind: 'neuma', name: 'KE', count: 2 },
      { laneId: 'sol', kind: 'witness', name: 'SOL', count: 1 },
    ]);
  });

  it('filterByLane admits the standings, a single lane, and falls open on unknowns', () => {
    const titled = (list) => list.map((r) => r.title).sort();
    expect(filterByLane(HOUSE, 'all').length).toBe(4);
    expect(titled(filterByLane(HOUSE, 'me'))).toEqual(['mine']);
    expect(titled(filterByLane(HOUSE, 'house'))).toEqual(['ke own', 'ke standing']);
    expect(titled(filterByLane(HOUSE, 'witnesses'))).toEqual(['sol own']);
    expect(titled(filterByLane(HOUSE, 'ke'))).toEqual(['ke own', 'ke standing']);
    // An unknown filter is ALL, never an empty lie.
    expect(filterByLane(HOUSE, 'ghost').length).toBe(4);
  });
});
