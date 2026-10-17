// Assigned plan — pure ops, recurrence period math, prompt sections.
// No IO anywhere in the module under test: real inputs, real outputs.

import { describe, it, expect } from 'vitest';
import {
  addAssigned, updateAssigned, prune, materializeRecurrence,
  formatAssignedSection, formatOperatorSection,
  addSubtask, updateSubtask, removeSubtask, replaceSubtasks,
  dayKey, weekKey, biweekKey, monthKey, emptyPlan,
  ASSIGNED_MAX_LIVE, ASSIGNED_MAX_SETTLED, ASSIGNED_TITLE_MAX_CHARS, SUBTASK_MAX_PER_TASK,
} from '../../core/tasks/assigned-plan.js';

const stamp = (n) => ({ id: `id-${String(n).padStart(4, '0')}`, now: `2026-07-17T12:${String(n % 60).padStart(2, '0')}:00.000Z` });

// Local-day law fixtures: recurrence period boundaries are the OPERATOR-LOCAL
// calendar's (core/time/day-key.js), so recurrence tests build timestamps from
// explicit LOCAL components — the law is pinned in any host timezone, and no
// fixture quietly depends on the host being UTC+N. Month is 0-based.
const at = (y, m, d, h = 12, min = 0) => new Date(y, m, d, h, min).toISOString();

describe('assigned plan — add/update validation', () => {
  it('adds a task with cadence and normalizes fields', () => {
    const { plan, task } = addAssigned(emptyPlan(), { title: '  Morning run  ', cadence: 'daily' }, stamp(1));
    expect(task).toMatchObject({ id: 'id-0001', title: 'Morning run', cadence: 'daily', status: 'open' });
    expect(plan.tasks).toHaveLength(1);
  });

  it('refuses bad input with tagged corrections naming the fix', () => {
    const attempt = (fn) => {
      try { fn(); return null; } catch (e) { return e; }
    };
    let e = attempt(() => addAssigned(emptyPlan(), { title: '  ', cadence: 'daily' }, stamp(1)));
    expect(e.message).toMatch(/needs a title/);
    expect(e.correction).toBe(true);
    e = attempt(() => addAssigned(emptyPlan(), { title: 'x', cadence: 'hourly' }, stamp(1)));
    expect(e.message).toMatch(/cadence must be one of/);
    e = attempt(() => addAssigned(emptyPlan(), { title: 'x'.repeat(ASSIGNED_TITLE_MAX_CHARS + 1), cadence: 'daily' }, stamp(1)));
    expect(e.message).toMatch(/title must stay under/);
    e = attempt(() => addAssigned(emptyPlan(), { title: 'x', cadence: 'daily', dueDate: '2026-08-01' }, stamp(1)));
    expect(e.message).toMatch(/due date only makes sense on a milestone or a one-shot/);
    e = attempt(() => addAssigned(emptyPlan(), { title: 'x', cadence: 'milestone', dueDate: 'next friday' }, stamp(1)));
    expect(e.message).toMatch(/YYYY-MM-DD/);
  });

  it('baseline work refuses done — it stands until dropped', () => {
    let { plan, task } = addAssigned(emptyPlan(), { title: 'drink water', cadence: 'baseline' }, stamp(1));
    expect(() => updateAssigned(plan, { id: task.id, status: 'done' }, stamp(2))).toThrow(/never settles/);
    ({ plan } = updateAssigned(plan, { id: task.id, status: 'dropped' }, stamp(3)));
    expect(plan.tasks[0].status).toBe('dropped');
  });

  it('marking done stamps completedAt; reopening past the live cap is refused', () => {
    let plan = emptyPlan();
    for (let i = 1; i <= ASSIGNED_MAX_LIVE; i++) {
      ({ plan } = addAssigned(plan, { title: `task ${i}`, cadence: 'milestone' }, stamp(i)));
    }
    expect(() => addAssigned(plan, { title: 'one too many', cadence: 'daily' }, stamp(99))).toThrow(/already holds/);
    let first = plan.tasks[0];
    ({ plan, task: first } = updateAssigned(plan, { id: first.id, status: 'done' }, stamp(50)));
    expect(first.completedAt).toBe(stamp(50).now);
    // cap is full again — reopening the done task must refuse
    ({ plan } = addAssigned(plan, { title: 'backfill', cadence: 'daily' }, stamp(51)));
    expect(() => updateAssigned(plan, { id: first.id, status: 'open' }, stamp(52))).toThrow(/already holds/);
  });

  it('changing cadence away from milestone drops the due date', () => {
    let { plan, task } = addAssigned(emptyPlan(), { title: 'race day', cadence: 'milestone', dueDate: '2026-09-01' }, stamp(1));
    ({ plan, task } = updateAssigned(plan, { id: task.id, cadence: 'weekly' }, stamp(2)));
    expect(task.cadence).toBe('weekly');
    expect(task.dueDate).toBeUndefined();
  });

  it('an empty update is refused', () => {
    const { plan, task } = addAssigned(emptyPlan(), { title: 'x', cadence: 'daily' }, stamp(1));
    expect(() => updateAssigned(plan, { id: task.id }, stamp(2))).toThrow(/changed nothing/);
  });
});

describe('assigned plan — subtasks', () => {
  it('adds, toggles, renames, and removes steps; corrections hold', () => {
    let { plan, task } = addAssigned(emptyPlan(), { title: 'work out', cadence: 'daily' }, stamp(1));
    let out = addSubtask(plan, { taskId: task.id, title: ' push-ups ' }, { id: 's1', now: '2026-07-17T13:00:00.000Z' });
    plan = out.plan;
    expect(out.subtask).toMatchObject({ id: 's1', title: 'push-ups', status: 'open' });
    expect(plan.tasks[0].subtasks).toHaveLength(1);

    out = updateSubtask(plan, { taskId: task.id, subtaskId: 's1', status: 'done' }, { now: '2026-07-17T14:00:00.000Z' });
    expect(out.subtask.status).toBe('done');
    expect(() => updateSubtask(plan, { taskId: task.id, subtaskId: 's1', status: 'active' }, stamp(2))).toThrow(/open or done/);
    expect(() => addSubtask(plan, { taskId: task.id, title: '  ' }, stamp(3))).toThrow(/needs a title/);
    expect(() => addSubtask(plan, { taskId: 'nope', title: 'x' }, stamp(4))).toThrow(/no task with id/);
    expect(() => updateSubtask(plan, { taskId: task.id, subtaskId: 'nope', status: 'done' }, stamp(5))).toThrow(/no subtask with id/);
    expect(() => updateSubtask(plan, { taskId: task.id, subtaskId: 's1' }, stamp(6))).toThrow(/changed nothing/);

    ({ plan } = removeSubtask(plan, { taskId: task.id, subtaskId: 's1' }, stamp(7)));
    expect(plan.tasks[0].subtasks).toHaveLength(0);
  });

  it('caps the checklist at SUBTASK_MAX_PER_TASK', () => {
    let { plan, task } = addAssigned(emptyPlan(), { title: 'big', cadence: 'once' }, stamp(1));
    for (let i = 0; i < SUBTASK_MAX_PER_TASK; i++) {
      ({ plan } = addSubtask(plan, { taskId: task.id, title: `step ${i}` }, { id: `s${i}`, now: stamp(2).now }));
    }
    expect(() => addSubtask(plan, { taskId: task.id, title: 'one too many' }, stamp(3))).toThrow(/already holds/);
  });

  it('a reopened recurring task restarts its checklist fresh', () => {
    let { plan, task } = addAssigned(emptyPlan(), { title: 'train', cadence: 'daily' }, { id: 'd1', now: '2026-07-17T08:00:00.000Z' });
    ({ plan } = addSubtask(plan, { taskId: task.id, title: 'push' }, { id: 's1', now: '2026-07-17T08:01:00.000Z' }));
    ({ plan } = addSubtask(plan, { taskId: task.id, title: 'pull' }, { id: 's2', now: '2026-07-17T08:02:00.000Z' }));
    ({ plan } = updateSubtask(plan, { taskId: task.id, subtaskId: 's1', status: 'done' }, { now: '2026-07-17T09:00:00.000Z' }));
    ({ plan } = updateAssigned(plan, { id: task.id, status: 'done' }, { now: '2026-07-17T09:05:00.000Z' }));

    const rolled = materializeRecurrence(plan, '2026-07-18T07:00:00.000Z');
    const t = rolled.plan.tasks[0];
    expect(t.status).toBe('open');
    expect(t.subtasks.map((s) => s.status)).toEqual(['open', 'open']);
  });

  it('subtasks on a dropped task are refused', () => {
    let { plan, task } = addAssigned(emptyPlan(), { title: 'x', cadence: 'once' }, stamp(1));
    ({ plan } = updateAssigned(plan, { id: task.id, status: 'dropped' }, stamp(2)));
    expect(() => addSubtask(plan, { taskId: task.id, title: 'y' }, stamp(3))).toThrow(/dropped/);
    expect(() => replaceSubtasks(plan, { taskId: task.id, titles: ['y'] }, { ...stamp(3), mintId: () => 'r0' })).toThrow(/dropped/);
  });

  it('replaceSubtasks: the titles given ARE the checklist; title-matched steps keep their check', () => {
    let { plan, task } = addAssigned(emptyPlan(), { title: 'body', cadence: 'daily' }, stamp(1));
    ({ plan } = addSubtask(plan, { taskId: task.id, title: 'push-ups' }, { id: 's1', now: stamp(2).now }));
    ({ plan } = addSubtask(plan, { taskId: task.id, title: 'pull-ups' }, { id: 's2', now: stamp(2).now }));
    ({ plan } = updateSubtask(plan, { taskId: task.id, subtaskId: 's1', status: 'done' }, stamp(3)));

    const out = replaceSubtasks(
      plan, { taskId: task.id, titles: ['push-ups', 'garden time'] },
      { now: '2026-07-17T15:00:00.000Z', mintId: () => 'new-1' },
    );
    const subs = out.task.subtasks;
    expect(subs.map((s) => s.title)).toEqual(['push-ups', 'garden time']);
    // The kept step kept its IDENTITY — the operator's check survives a swap.
    expect(subs[0]).toMatchObject({ id: 's1', status: 'done' });
    // A genuinely new step is minted open.
    expect(subs[1]).toMatchObject({ id: 'new-1', status: 'open' });
    // A step left out is retired — replace-all, never a silent merge.
    expect(subs.some((s) => s.id === 's2')).toBe(false);

    // An empty array clears the checklist (absence IS no checklist).
    const cleared = replaceSubtasks(out.plan, { taskId: task.id, titles: [] }, { ...stamp(4), mintId: () => 'x' });
    expect(cleared.task.subtasks).toBeUndefined();

    // The cap and the locator's corrections hold on the replace too.
    expect(() => replaceSubtasks(plan, { taskId: task.id, titles: Array(SUBTASK_MAX_PER_TASK + 1).fill('x') }, { ...stamp(5), mintId: () => 'y' })).toThrow(/at most/);
    expect(() => replaceSubtasks(plan, { taskId: 'nope', titles: ['x'] }, { ...stamp(6), mintId: () => 'z' })).toThrow(/no task with id/);
  });

  it('the OPERATOR LIST section prints ids and teaches the amend door', () => {
    const { plan } = addAssigned(emptyPlan(), { title: 'work out qamend', cadence: 'daily' }, stamp(1));
    const section = formatOperatorSection(plan);
    expect(section).toContain('[id-0001]'); // the prefix-8 the amend intent names
    expect(section).toContain('tasks/operator-update');
    expect(section).toContain('never settle, drop, or re-status');
  });

  it('deadlines: a due time rides a daily; a due date stays instance-only; clears follow the cadence', () => {
    let { plan, task } = addAssigned(emptyPlan(), { title: 'body qdue', cadence: 'daily', dueTime: '18:00' }, stamp(1));
    expect(task.dueTime).toBe('18:00');
    // A due DATE on recurring work is refused — every instance or just the first?
    expect(() => addAssigned(emptyPlan(), { title: 'x', cadence: 'daily', dueTime: '18:00', dueDate: '2026-10-01' }, stamp(2)))
      .toThrow(/milestone or a one-shot/);
    expect(() => addAssigned(emptyPlan(), { title: 'x', cadence: 'daily', dueTime: '25:00' }, stamp(3)))
      .toThrow(/HH:MM/);

    // The line renders the deadline with its state.
    const section = formatOperatorSection(plan);
    expect(section).toContain(' — DUE ');

    // Moving the cadence somewhere the field cannot follow clears it.
    ({ plan } = updateAssigned(plan, { id: task.id, cadence: 'once', dueDate: '2026-10-01' }, stamp(4)));
    let stored = plan.tasks[0];
    expect(stored.dueDate).toBe('2026-10-01');
    expect(stored.dueTime).toBe('18:00'); // once may carry both
    ({ plan } = updateAssigned(plan, { id: task.id, cadence: 'monthly' }, stamp(5)));
    stored = plan.tasks[0];
    expect(stored.dueDate).toBeUndefined();
    expect(stored.dueTime).toBeUndefined();
    // Explicit nulls clear either field on the same cadence.
    ({ plan } = updateAssigned(plan, { id: task.id, cadence: 'once', dueTime: '09:00' }, stamp(6)));
    ({ plan } = updateAssigned(plan, { id: task.id, dueDate: null, dueTime: null }, stamp(7)));
    stored = plan.tasks[0];
    expect(stored.dueDate).toBeUndefined();
    expect(stored.dueTime).toBeUndefined();
  });

  it('the prompt lines carry open steps indented; done steps stay quiet', () => {
    let { plan, task } = addAssigned(emptyPlan(), { title: 'work out', cadence: 'daily' }, stamp(1));
    ({ plan } = addSubtask(plan, { taskId: task.id, title: 'push-ups' }, { id: 's1', now: '2026-07-17T08:01:00.000Z' }));
    ({ plan } = addSubtask(plan, { taskId: task.id, title: 'stretch' }, { id: 's2', now: '2026-07-17T08:02:00.000Z' }));
    ({ plan } = updateSubtask(plan, { taskId: task.id, subtaskId: 's2', status: 'done' }, { now: '2026-07-17T08:03:00.000Z' }));
    const section = formatAssignedSection(plan);
    expect(section).toContain('– push-ups');
    expect(section).not.toContain('stretch');
    expect(formatOperatorSection(plan)).toContain('– push-ups');
  });
});

describe('assigned plan — period math and lazy recurrence', () => {
  it('dayKey counts whole LOCAL days; weekKey turns on the local Monday', () => {
    // Local-day law (core/time/day-key.js): the boundary clock is the
    // operator's own calendar, not UTC's. These fixtures pin that explicitly —
    // same-local-day shares a key even where UTC would split it.
    expect(dayKey(at(2026, 6, 17, 0, 1))).toBe(dayKey(at(2026, 6, 17, 23, 59)));
    expect(dayKey(at(2026, 6, 18, 0, 0))).toBe(dayKey(at(2026, 6, 17, 23, 59)) + 1);
    // 2026-07-13 is a Monday, the 19th its Sunday, the 20th the next Monday —
    // the week turns at LOCAL midnight into Monday, not at midnight UTC.
    expect(weekKey(at(2026, 6, 19, 23, 30))).toBe(weekKey(at(2026, 6, 13, 0, 1)));
    expect(weekKey(at(2026, 6, 20, 0, 1))).toBeGreaterThan(weekKey(at(2026, 6, 19, 23, 30)));
    expect(dayKey('not a date')).toBeNull();
  });

  it('a done daily reopens the next LOCAL day, never the same local day', () => {
    let { plan, task } = addAssigned(emptyPlan(), { title: 'train', cadence: 'daily' }, { id: 'd1', now: at(2026, 6, 17, 8, 0) });
    ({ plan } = updateAssigned(plan, { id: task.id, status: 'done' }, { now: at(2026, 6, 17, 9, 0) }));

    let rolled = materializeRecurrence(plan, at(2026, 6, 17, 23, 0)); // same local day, 23:00
    expect(rolled.changed).toBe(false);
    expect(rolled.plan.tasks[0].status).toBe('done');

    rolled = materializeRecurrence(plan, at(2026, 6, 18, 7, 0)); // the next local morning
    expect(rolled.changed).toBe(true);
    expect(rolled.plan.tasks[0].status).toBe('open');
    expect(rolled.plan.tasks[0].updatedAt).toBe(at(2026, 6, 18, 7, 0));
    // Rolling the already-rolled plan is a no-op.
    expect(materializeRecurrence(rolled.plan, at(2026, 6, 18, 8, 0)).changed).toBe(false);
  });

  it('a daily settled 23:30 local reopens just after LOCAL midnight — not at 07:00 local', () => {
    // The case the UTC clock got wrong on the operator's UTC+N: a late-evening
    // settle used to look done all morning, because the period only rolled at
    // midnight UTC (07:00 local). The local-day law reopens it at local
    // midnight — tomorrow's work is to-do from the first minute of tomorrow.
    let { plan, task } = addAssigned(emptyPlan(), { title: 'train', cadence: 'daily' }, { id: 'd1', now: at(2026, 6, 17, 8, 0) });
    ({ plan } = updateAssigned(plan, { id: task.id, status: 'done' }, { now: at(2026, 6, 17, 23, 30) }));
    expect(materializeRecurrence(plan, at(2026, 6, 17, 23, 45)).changed).toBe(false); // still the same local day
    const rolled = materializeRecurrence(plan, at(2026, 6, 18, 0, 5)); // five minutes past local midnight
    expect(rolled.changed).toBe(true);
    expect(rolled.plan.tasks[0].status).toBe('open');
  });

  it('a done weekly reopens only across a LOCAL Monday boundary', () => {
    let { plan, task } = addAssigned(emptyPlan(), { title: 'meal prep', cadence: 'weekly' }, { id: 'w1', now: at(2026, 6, 17, 8, 0) });
    ({ plan } = updateAssigned(plan, { id: task.id, status: 'done' }, { now: at(2026, 6, 17, 9, 0) }));

    expect(materializeRecurrence(plan, at(2026, 6, 19, 23, 0)).changed).toBe(false); // local Sunday, same week
    const rolled = materializeRecurrence(plan, at(2026, 6, 20, 8, 0)); // the next local Monday
    expect(rolled.changed).toBe(true);
    expect(rolled.plan.tasks[0].status).toBe('open');
  });

  it('a weekly turns on the local week boundary — Sunday 23:59 rests, Monday 00:01 reopens', () => {
    // The boundary clock is the operator's midnight, not UTC's: under the old
    // law on UTC+N the week rolled at Monday 07:00 local.
    let { plan, task } = addAssigned(emptyPlan(), { title: 'meal prep', cadence: 'weekly' }, { id: 'w1', now: at(2026, 6, 19, 8, 0) });
    ({ plan } = updateAssigned(plan, { id: task.id, status: 'done' }, { now: at(2026, 6, 19, 12, 0) })); // local Sunday noon
    expect(materializeRecurrence(plan, at(2026, 6, 19, 23, 59)).changed).toBe(false); // still local Sunday
    const rolled = materializeRecurrence(plan, at(2026, 6, 20, 0, 1)); // one minute into local Monday
    expect(rolled.changed).toBe(true);
    expect(rolled.plan.tasks[0].status).toBe('open');
  });

  it('a done once settles for good — one-time tasks never recur and prune like milestones', () => {
    let { plan, task } = addAssigned(emptyPlan(), { title: 'one-off errand', cadence: 'once', dueDate: '2026-08-01' }, { id: 'o1', now: '2026-07-10T08:00:00.000Z' });
    expect(task.cadence).toBe('once');
    // A one-shot MAY carry a due date now (2026-09-20): the instance deadline.
    expect(task.dueDate).toBe('2026-08-01');
    ({ plan } = updateAssigned(plan, { id: task.id, status: 'done' }, { now: '2026-07-10T09:00:00.000Z' }));
    const rolled = materializeRecurrence(plan, '2027-01-01T00:00:00.000Z');
    expect(rolled.changed).toBe(false);
    expect(rolled.plan.tasks[0].status).toBe('done');
  });

  it('done milestones and dropped tasks never reopen', () => {
    let { plan, task } = addAssigned(emptyPlan(), { title: '5k race', cadence: 'milestone' }, { id: 'm1', now: '2026-07-10T08:00:00.000Z' });
    ({ plan } = updateAssigned(plan, { id: task.id, status: 'done' }, { now: '2026-07-10T09:00:00.000Z' }));
    const rolled = materializeRecurrence(plan, '2027-01-01T00:00:00.000Z');
    expect(rolled.changed).toBe(false);
    expect(rolled.plan.tasks[0].status).toBe('done');
  });
});

describe('assigned plan — prune and prompt sections', () => {
  it('prune trims settled history but never the recurring schedule', () => {
    let plan = emptyPlan();
    let daily;
    ({ plan, task: daily } = addAssigned(plan, { title: 'standing daily', cadence: 'daily' }, stamp(1)));
    ({ plan } = updateAssigned(plan, { id: daily.id, status: 'done' }, stamp(2)));
    for (let i = 1; i <= ASSIGNED_MAX_SETTLED + 5; i++) {
      let t;
      ({ plan, task: t } = addAssigned(plan, { title: `one-shot ${i}`, cadence: 'milestone' }, stamp(10 + i)));
      ({ plan } = updateAssigned(plan, { id: t.id, status: 'done' }, stamp(60 + i)));
    }
    const prunable = plan.tasks.filter((t) => t.status === 'done' && t.cadence === 'milestone');
    expect(prunable.length).toBeLessThanOrEqual(ASSIGNED_MAX_SETTLED);
    expect(plan.tasks.some((t) => t.title === 'standing daily')).toBe(true);
    // prune() itself never touches open tasks
    const open = { tasks: [...plan.tasks, { id: 'x', title: 'open', cadence: 'daily', status: 'open', updatedAt: '2026-01-01' }] };
    expect(prune(open).tasks.some((t) => t.id === 'x')).toBe(true);
  });

  it('the STANDING WORK section carries open tasks (baseline first) and vanishes when empty', () => {
    expect(formatAssignedSection(emptyPlan())).toBe('');
    expect(formatAssignedSection(null)).toBe('');

    let plan = emptyPlan();
    ({ plan } = addAssigned(plan, { title: 'journal review', cadence: 'daily' }, stamp(1)));
    ({ plan } = addAssigned(plan, { title: 'hold the gate', cadence: 'baseline' }, stamp(2)));
    ({ plan } = addAssigned(plan, { title: 'first assessment', cadence: 'milestone', dueDate: '2026-08-01' }, stamp(3)));

    const section = formatAssignedSection(plan);
    expect(section).toContain('## Standing Work');
    expect(section).toContain('journal review (daily)');
    expect(section).toContain('first assessment (milestone) — DUE 2026-08-01');
    expect(section.indexOf('hold the gate')).toBeLessThan(section.indexOf('journal review'));
    // done work leaves the section
    const dailyId = plan.tasks.find((t) => t.cadence === 'daily').id;
    ({ plan } = updateAssigned(plan, { id: dailyId, status: 'done' }, stamp(4)));
    expect(formatAssignedSection(plan)).not.toContain('journal review');
  });

  it('the OPERATOR LIST section frames help without ownership, and vanishes when empty', () => {
    expect(formatOperatorSection(emptyPlan())).toBe('');
    let plan = emptyPlan();
    ({ plan } = addAssigned(plan, { title: 'morning stretch', cadence: 'daily' }, stamp(1)));
    const section = formatOperatorSection(plan);
    expect(section).toContain("## Your Operator's List");
    expect(section).toContain('morning stretch (daily)');
    // The routes are taught plainly: add and amend (tasks/operator-add,
    // tasks/operator-update) — but closing the list stays the operator's own.
    expect(section).toContain('tasks/operator-add');
    expect(section).toContain('tasks/operator-update');
    expect(section).toMatch(/never settle, drop, or re-status/i);
  });
});

// --- The wider rhythms: monthly, biweekly, and the witness-designed custom
// weekday set (Mon/Wed/Fri, weekends, any shape). Recurrence stays lazy —
// materializeRecurrence rolls a done task open once its own rhythm has
// truly passed, computed purely from `now`.
describe('assigned plan — monthly / biweekly / custom rhythms', () => {
  const doneTask = (args, n) => {
    let { plan, task } = addAssigned(emptyPlan(), args, stamp(n));
    ({ plan } = updateAssigned(plan, { id: task.id, status: 'done' }, { now: args.doneAt }));
    return plan;
  };

  it('a done monthly reopens when the local calendar month rolls, not a day sooner', () => {
    // Local-day law: the month turns at local midnight into the 1st. (The old
    // UTC fixtures here silently crossed the local month line on UTC+N —
    // 2026-06-30T18:00Z is already July 1st local — so they pinned the wrong
    // boundary. Local components pin the intended one.)
    const plan = doneTask({ title: 'pay rent', cadence: 'monthly', doneAt: at(2026, 5, 30, 18, 0) }, 1);
    expect(materializeRecurrence(plan, at(2026, 5, 30, 23, 0)).changed).toBe(false); // still local June 30
    const rolled = materializeRecurrence(plan, at(2026, 6, 1, 0, 30)); // 00:30 local, July 1
    expect(rolled.changed).toBe(true);
    expect(rolled.plan.tasks[0].status).toBe('open');
  });

  it('a done biweekly rests through its fortnight and reopens in the next', () => {
    const done = '2026-07-06T10:00:00.000Z'; // a Monday
    const plan = doneTask({ title: 'deep clean', cadence: 'biweekly', doneAt: done }, 1);
    // Same day: never reopens. Fourteen days on: always a new fortnight.
    expect(materializeRecurrence(plan, '2026-07-06T23:00:00.000Z').changed).toBe(false);
    expect(materializeRecurrence(plan, '2026-07-20T10:00:00.000Z').changed).toBe(true);
    // One week on it reopens only if the fortnight boundary truly fell
    // between — the period key decides, never a bare 7-day count.
    const oneWeek = materializeRecurrence(plan, '2026-07-13T10:00:00.000Z');
    expect(oneWeek.changed).toBe(biweekKey('2026-07-13T10:00:00.000Z') > biweekKey(done));
  });

  it('a custom Mon/Wed/Fri task rests on off-days and reopens on the next scheduled day', () => {
    // 2026-07-06 is a Monday; days [1,3,5] = Mon/Wed/Fri.
    const plan = doneTask({ title: 'lift', cadence: 'custom', days: [1, 3, 5], doneAt: '2026-07-06T12:00:00.000Z' }, 1);
    expect(materializeRecurrence(plan, '2026-07-07T12:00:00.000Z').changed).toBe(false); // Tuesday — off-day
    const wed = materializeRecurrence(plan, '2026-07-08T09:00:00.000Z'); // Wednesday — scheduled
    expect(wed.changed).toBe(true);
    expect(wed.plan.tasks[0].status).toBe('open');
  });

  it('a missed scheduled day carries over — Thursday still owes Wednesday\'s work', () => {
    const plan = doneTask({ title: 'lift', cadence: 'custom', days: [1, 3, 5], doneAt: '2026-07-06T12:00:00.000Z' }, 1);
    expect(materializeRecurrence(plan, '2026-07-09T12:00:00.000Z').changed).toBe(true); // Thursday, Wed passed
  });

  it('a weekend-done custom task waits through the weekend for Monday', () => {
    // Local components: done LOCAL Friday 18:00 (the old 2026-07-10T18:00Z
    // fixture was already Saturday 01:00 on the operator's UTC+N — it pinned
    // the UTC boundary, not the intended Friday-night settle).
    const plan = doneTask({ title: 'lift', cadence: 'custom', days: [1, 3, 5], doneAt: at(2026, 6, 10, 18, 0) }, 1); // local Friday
    expect(materializeRecurrence(plan, at(2026, 6, 12, 18, 0)).changed).toBe(false); // local Sunday
    expect(materializeRecurrence(plan, at(2026, 6, 13, 6, 0)).changed).toBe(true); // local Monday
  });

  it('custom demands its days; days refuse every other cadence; malformed sets are corrected', () => {
    const attempt = (fn) => { try { fn(); return null; } catch (e) { return e; } };
    let e = attempt(() => addAssigned(emptyPlan(), { title: 'x', cadence: 'custom' }, stamp(1)));
    expect(e.message).toMatch(/custom cadence needs its days/);
    expect(e.correction).toBe(true);
    e = attempt(() => addAssigned(emptyPlan(), { title: 'x', cadence: 'daily', days: [1] }, stamp(1)));
    expect(e.message).toMatch(/days only make sense on a custom cadence/);
    e = attempt(() => addAssigned(emptyPlan(), { title: 'x', cadence: 'custom', days: [7] }, stamp(1)));
    expect(e.message).toMatch(/unique integers 0–6/);
    e = attempt(() => addAssigned(emptyPlan(), { title: 'x', cadence: 'custom', days: [1, 1] }, stamp(1)));
    expect(e.message).toMatch(/unique integers 0–6/);
    // The stored set arrives sorted regardless of authoring order.
    const { task } = addAssigned(emptyPlan(), { title: 'x', cadence: 'custom', days: [5, 1, 3] }, stamp(1));
    expect(task.days).toEqual([1, 3, 5]);
  });

  it('leaving custom sheds the days; arriving needs them (patch or standing)', () => {
    let { plan, task } = addAssigned(emptyPlan(), { title: 'x', cadence: 'custom', days: [0, 6] }, stamp(1));
    ({ plan, task } = updateAssigned(plan, { id: task.id, cadence: 'weekly' }, stamp(2)));
    expect(task.days).toBeUndefined();
    const attempt = (fn) => { try { fn(); return null; } catch (e) { return e; } };
    const e = attempt(() => updateAssigned(plan, { id: task.id, cadence: 'custom' }, stamp(3)));
    expect(e.message).toMatch(/custom cadence needs its days/);
    ({ task } = updateAssigned(plan, { id: task.id, cadence: 'custom', days: [2, 4] }, stamp(4)));
    expect(task).toMatchObject({ cadence: 'custom', days: [2, 4] });
  });

  it('the prompt line speaks the designed rhythm — custom shows its weekdays', () => {
    let plan = emptyPlan();
    ({ plan } = addAssigned(plan, { title: 'lift', cadence: 'custom', days: [1, 3, 5] }, stamp(1)));
    ({ plan } = addAssigned(plan, { title: 'ledger sweep', cadence: 'monthly' }, stamp(2)));
    const section = formatAssignedSection(plan);
    expect(section).toContain('lift (custom — Mon/Wed/Fri)');
    expect(section).toContain('ledger sweep (monthly)');
  });
});
