// todo-view — TASKS' presentation decisions, proven with real inputs and
// outputs. Pure throughout: no mocks, no stubs. The through-lines: cadence
// order is fixed and empty groups vanish; a settled recurring task announces
// when it reopens; an overdue milestone is measured against the local day,
// never a clock fabrication.
import { describe, it, expect } from 'vitest';
import {
  CADENCE_ORDER, cadenceLabel, groupLiveTasks, settledTasks, isOverdue, resetHint, todayKey, orderedScopes, scopeRows,
  ledgerRows, ledgerKind, shortDate, subtaskProgress, customDaysLabel, WEEKDAYS,
} from '../../frontend/app/RelinkShell/todo-view.js';

const task = (overrides = {}) => ({
  id: 't1',
  title: 'Read',
  cadence: 'daily',
  status: 'open',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  ...overrides,
});

describe('cadenceLabel', () => {
  it('maps the five cadences to their data-register labels', () => {
    expect(cadenceLabel('baseline')).toBe('BASELINE');
    expect(cadenceLabel('daily')).toBe('DAILY');
    expect(cadenceLabel('weekly')).toBe('WEEKLY');
    expect(cadenceLabel('once')).toBe('ONCE');
    expect(cadenceLabel('milestone')).toBe('MILESTONE');
  });

  it('prints an unrecognized cadence as itself, uppercased — never a fabricated one', () => {
    expect(cadenceLabel('hourly')).toBe('HOURLY');
    expect(cadenceLabel(undefined)).toBe('—');
  });
});

describe('groupLiveTasks', () => {
  it('groups open tasks by cadence in CADENCE_ORDER, omitting empty groups', () => {
    const groups = groupLiveTasks([
      task({ id: 'a', cadence: 'milestone' }),
      task({ id: 'b', cadence: 'daily' }),
      task({ id: 'c', cadence: 'baseline' }),
      task({ id: 'd', cadence: 'daily', status: 'done' }), // settled — not live
    ]);
    expect(groups.map((g) => g.cadence)).toEqual(['baseline', 'daily', 'milestone']);
    expect(groups.map((g) => g.tasks.map((t) => t.id))).toEqual([['c'], ['b'], ['a']]);
    expect(groups.some((g) => g.cadence === 'weekly')).toBe(false);
  });

  it('returns no groups when nothing is open', () => {
    expect(groupLiveTasks([task({ status: 'done' })])).toEqual([]);
    expect(groupLiveTasks([])).toEqual([]);
    expect(groupLiveTasks(undefined)).toEqual([]);
  });

  it('exports the fixed cadence order the groups follow', () => {
    expect([...CADENCE_ORDER]).toEqual(['baseline', 'daily', 'custom', 'weekly', 'biweekly', 'monthly', 'once', 'milestone']);
  });
});

describe('settledTasks', () => {
  it('collects done and dropped, most recently touched first', () => {
    const settled = settledTasks([
      task({ id: 'open', status: 'open', updatedAt: '2026-07-04T00:00:00.000Z' }),
      task({ id: 'old-done', status: 'done', updatedAt: '2026-07-01T00:00:00.000Z' }),
      task({ id: 'dropped', status: 'dropped', updatedAt: '2026-07-03T00:00:00.000Z' }),
      task({ id: 'new-done', status: 'done', updatedAt: '2026-07-05T00:00:00.000Z' }),
    ]);
    expect(settled.map((t) => t.id)).toEqual(['new-done', 'dropped', 'old-done']);
  });

  it('tolerates a missing list and missing timestamps', () => {
    expect(settledTasks(undefined)).toEqual([]);
    expect(settledTasks([task({ status: 'done', updatedAt: undefined })])).toHaveLength(1);
  });
});

describe('isOverdue', () => {
  it('is true only for an open milestone whose dueDate is before today', () => {
    const due = { cadence: 'milestone', status: 'open', dueDate: '2026-07-17' };
    expect(isOverdue(due, '2026-07-18')).toBe(true);
  });

  it('a milestone due today is not yet late', () => {
    expect(isOverdue({ cadence: 'milestone', status: 'open', dueDate: '2026-07-18' }, '2026-07-18')).toBe(false);
  });

  it('is false for done milestones, undated milestones, and other cadences', () => {
    expect(isOverdue({ cadence: 'milestone', status: 'done', dueDate: '2026-07-01' }, '2026-07-18')).toBe(false);
    expect(isOverdue({ cadence: 'milestone', status: 'open' }, '2026-07-18')).toBe(false);
    expect(isOverdue({ cadence: 'daily', status: 'open', dueDate: '2026-07-01' }, '2026-07-18')).toBe(false);
  });
});

describe('resetHint', () => {
  it('says when a done recurring task comes back', () => {
    expect(resetHint(task({ status: 'done', cadence: 'daily' }))).toBe('reopens tomorrow');
    expect(resetHint(task({ status: 'done', cadence: 'weekly' }))).toBe('reopens next week');
  });

  it('stays silent for open tasks, one-shots, baselines, and drops', () => {
    expect(resetHint(task({ status: 'open', cadence: 'daily' }))).toBeNull();
    expect(resetHint(task({ status: 'done', cadence: 'milestone' }))).toBeNull();
    expect(resetHint(task({ status: 'done', cadence: 'baseline' }))).toBeNull();
    expect(resetHint(task({ status: 'dropped', cadence: 'daily' }))).toBeNull();
  });
});

describe('ledgerRows', () => {
  // The being's own ledger carries open/active/done/dropped, cadence optional.
  const self = (id, status, updatedAt = '2026-07-01T00:00:00.000Z') => ({ id, title: id, status, updatedAt });

  it('live: active first then open, input order preserved within each status', () => {
    const { live } = ledgerRows([
      self('open-1', 'open'),
      self('done-1', 'done'),
      self('active-1', 'active'),
      self('dropped-1', 'dropped'),
      self('open-2', 'open'),
      self('active-2', 'active'),
    ]);
    expect(live.map((t) => t.id)).toEqual(['active-1', 'active-2', 'open-1', 'open-2']);
  });

  it('settled: done and dropped, most recently touched first', () => {
    const { settled } = ledgerRows([
      self('open-1', 'open'),
      self('old-done', 'done', '2026-07-01T00:00:00.000Z'),
      self('dropped', 'dropped', '2026-07-03T00:00:00.000Z'),
      self('new-done', 'done', '2026-07-05T00:00:00.000Z'),
    ]);
    expect(settled.map((t) => t.id)).toEqual(['new-done', 'dropped', 'old-done']);
  });

  it('caps the settled rows at settledMax (default 10)', () => {
    const many = Array.from({ length: 14 }, (_, i) => self(`done-${i}`, 'done', `2026-07-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`));
    expect(ledgerRows(many).settled).toHaveLength(10);
    expect(ledgerRows(many, 3).settled.map((t) => t.id)).toEqual(['done-13', 'done-12', 'done-11']);
    expect(ledgerRows(many, 0).settled).toEqual([]);
  });

  it('tolerates an empty or missing ledger', () => {
    expect(ledgerRows([])).toEqual({ live: [], settled: [] });
    expect(ledgerRows(undefined)).toEqual({ live: [], settled: [] });
  });

  // PARITY WITH THE STREAM RAIL (Design note, 2026-08-03. The window used to render
  // bare status while the rail read derived state, so the same task described
  // itself two different ways depending on where you looked.
  it('reads the SAME derived state the rail does — worked, unfinished, ticked', () => {
    const worked = { firstAt: '2026-08-03T01:00:00.000Z', lastAt: '2026-08-03T02:00:00.000Z', artifacts: [{ kind: 'wrote', target: '/a.js', at: '2026-08-03T02:00:00.000Z', count: 3 }] };
    const tasks = [
      { id: 'stalled', title: 'half done', status: 'active', work: worked },
      { id: 'fresh', title: 'untouched', status: 'open' },
      { id: 'closed', title: 'finished', status: 'done', updatedAt: '2026-08-02T00:00:00.000Z' },
    ];
    const { live, settled } = ledgerRows(tasks, 10, { ledger: { tasks } });
    expect(live.find((t) => t.id === 'stalled')).toMatchObject({ state: 'interrupted', checked: false });
    expect(live.find((t) => t.id === 'stalled').work.count).toBe(3);
    expect(live.find((t) => t.id === 'fresh')).toMatchObject({ state: 'open', work: null });
    expect(settled[0]).toMatchObject({ id: 'closed', state: 'done', checked: true });
  });

  it('asks about focus WITHOUT a chat — the window looks at all of them at once', () => {
    // A task under way in a parallel conversation is still under way, and this
    // window is showing every chat. Naming one chat here would report work in
    // hand elsewhere as merely taken on.
    const tasks = [{ id: 'elsewhere', title: 'in hand, other chat', status: 'active' }];
    const ledger = { tasks, focus: { 'session-1755000000000': 'elsewhere' } };
    expect(ledgerRows(tasks, 10, { ledger }).live[0].state).toBe('in-progress');
    // With no focus map at all it is merely active — never invented.
    expect(ledgerRows(tasks, 10, { ledger: { tasks } }).live[0].state).toBe('active');
  });

  it('sinks blocked work, names the blocker, and unblocks when it settles', () => {
    const open = [
      { id: 'waits', title: 'waits', status: 'active', blockedBy: ['gate'] },
      { id: 'gate', title: 'the gate', status: 'open' },
    ];
    const rows = ledgerRows(open, 10, { ledger: { tasks: open } }).live;
    expect(rows.map((t) => t.id)).toEqual(['gate', 'waits']);
    expect(rows.find((t) => t.id === 'waits').blockers).toEqual([{ id: 'gate', title: 'the gate' }]);

    const settledGate = open.map((t) => (t.id === 'gate' ? { ...t, status: 'done' } : t));
    const after = ledgerRows(settledGate, 10, { ledger: { tasks: settledGate } }).live;
    expect(after.find((t) => t.id === 'waits').blockers).toEqual([]);
  });

  it('takes the hardship first when the operator asks for it', () => {
    const tasks = [
      { id: 'light', title: 'light', status: 'open', size: 'quick' },
      { id: 'heavy', title: 'heavy', status: 'open', size: 'epic' },
      { id: 'unsized', title: 'unsized', status: 'open' },
    ];
    const ctx = { ledger: { tasks } };
    expect(ledgerRows(tasks, 10, { ...ctx, order: 'heaviest' }).live.map((t) => t.id))
      .toEqual(['heavy', 'light', 'unsized']);
    expect(ledgerRows(tasks, 10, { ...ctx, order: 'lightest' }).live.map((t) => t.id))
      .toEqual(['light', 'heavy', 'unsized']);
    expect(ledgerRows(tasks, 10, ctx).live.map((t) => t.id))
      .toEqual(['light', 'heavy', 'unsized']);
    expect(ledgerRows(tasks, 10, ctx).live[1].size).toBe('EPIC');
  });

  it('keeps the task itself intact — the row ADDS, it never replaces', () => {
    const tasks = [{ id: 'a', title: 'keep me', status: 'open', detail: 'the detail', cadence: 'daily' }];
    const row = ledgerRows(tasks, 10, { ledger: { tasks } }).live[0];
    expect(row).toMatchObject({ id: 'a', title: 'keep me', detail: 'the detail', cadence: 'daily' });
  });
});

describe('groupLiveTasks honours the operator\'s order', () => {
  const t = (id, size) => ({ id, title: id, status: 'open', cadence: 'daily', ...(size ? { size } : {}) });

  it('sorts by size INSIDE a cadence group, never across them', () => {
    const tasks = [t('light', 'quick'), t('heavy', 'epic'), { ...t('milestone-x', 'epic'), cadence: 'milestone' }];
    const groups = groupLiveTasks(tasks, 'heaviest');
    expect(groups.map((g) => g.cadence)).toEqual(['daily', 'milestone']);
    expect(groups[0].tasks.map((x) => x.id)).toEqual(['heavy', 'light']);
    // A rhythm is not a weight: an epic milestone does not climb above a daily.
    expect(groupLiveTasks(tasks, 'mine')[0].tasks.map((x) => x.id)).toEqual(['light', 'heavy']);
  });
});

describe('ledgerKind', () => {
  it('passes the recurring cadences through', () => {
    expect(ledgerKind({ cadence: 'daily' })).toBe('daily');
    expect(ledgerKind({ cadence: 'weekly' })).toBe('weekly');
  });

  it('reads anything else as a one-off — absent, unrecognized, or missing task', () => {
    expect(ledgerKind({})).toBe('once');
    expect(ledgerKind({ cadence: 'monthly' })).toBe('once');
    expect(ledgerKind({ cadence: 'baseline' })).toBe('once');
    expect(ledgerKind(undefined)).toBe('once');
  });
});

describe('shortDate', () => {
  it('stamps a valid timestamp as zero-padded MM-DD (local, like todayKey)', () => {
    expect(shortDate('2026-07-05T12:00:00')).toBe('07-05');
    expect(shortDate('2026-01-03T00:00:00')).toBe('01-03');
  });

  it('returns an empty string for garbage — never a fabricated date', () => {
    expect(shortDate('not-a-date')).toBe('');
    expect(shortDate('')).toBe('');
    expect(shortDate(undefined)).toBe('');
    expect(shortDate(null)).toBe('');
  });
});

describe('todayKey', () => {
  it('formats the LOCAL calendar day, zero-padded', () => {
    expect(todayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(todayKey(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});

describe('subtaskProgress', () => {
  it('counts open steps out of the total', () => {
    const t = task({
      subtasks: [
        { id: 's1', title: 'Warm up', status: 'done' },
        { id: 's2', title: 'Read', status: 'open' },
        { id: 's3', title: 'Summarize', status: 'open' },
      ],
    });
    expect(subtaskProgress(t)).toEqual({ open: 2, total: 3 });
  });

  it('a fully worked checklist reads 0 open of its total', () => {
    const t = task({ subtasks: [{ id: 's1', status: 'done' }, { id: 's2', status: 'done' }] });
    expect(subtaskProgress(t)).toEqual({ open: 0, total: 2 });
  });

  it('a task with no steps reports 0/0 — the row shows no badge', () => {
    expect(subtaskProgress(task())).toEqual({ open: 0, total: 0 });
    expect(subtaskProgress(task({ subtasks: [] }))).toEqual({ open: 0, total: 0 });
    expect(subtaskProgress(task({ subtasks: null }))).toEqual({ open: 0, total: 0 });
    expect(subtaskProgress(undefined)).toEqual({ open: 0, total: 0 });
  });
});

describe('orderedScopes', () => {
  const roster = [
    { neumaId: 'n2', name: 'Zephyr' },
    { neumaId: 'n1', name: 'Aster' },
    { neumaId: 'n3', name: 'Meridian' },
  ];

  it('puts the linked being first, the rest alphabetical by name', () => {
    expect(orderedScopes(roster, { neumaId: 'n3' }).map((m) => m.neumaId)).toEqual(['n3', 'n1', 'n2']);
  });

  it('is plain alphabetical when nothing is linked', () => {
    expect(orderedScopes(roster, null).map((m) => m.neumaId)).toEqual(['n1', 'n3', 'n2']);
    expect(orderedScopes(undefined, null)).toEqual([]);
  });
});

describe('scopeRows', () => {
  const roster = [
    { neumaId: 'n2', name: 'Zephyr' },
    { neumaId: 'n1', name: 'Aster' },
  ];
  const witnesses = [
    { neumaId: 'witness-zai-coding-plan-Bizulen', name: 'Bizulen' },
    { neumaId: 'witness-kimi-code-Basunor', name: 'Basunor' },
  ];

  it('puts the HOUSE first, then the witness lanes — the two standings stay apart', () => {
    expect(scopeRows(roster, witnesses, null).map((m) => m.name))
      .toEqual(['Aster', 'Zephyr', 'Basunor', 'Bizulen']);
  });

  it('marks each row with its kind so a tab can say which it is', () => {
    expect(scopeRows(roster, witnesses, null).map((m) => m.kind))
      .toEqual(['neuma', 'neuma', 'witness', 'witness']);
  });

  it('the linked being leads its own group — a linked witness does not jump the house', () => {
    expect(scopeRows(roster, witnesses, { neumaId: 'witness-zai-coding-plan-Bizulen' }).map((m) => m.name))
      .toEqual(['Aster', 'Zephyr', 'Bizulen', 'Basunor']);
    expect(scopeRows(roster, witnesses, { neumaId: 'n2' }).map((m) => m.name))
      .toEqual(['Zephyr', 'Aster', 'Basunor', 'Bizulen']);
  });

  it('a house with no witnesses (or neither) still shapes cleanly', () => {
    expect(scopeRows(roster, [], null).map((m) => m.name)).toEqual(['Aster', 'Zephyr']);
    expect(scopeRows(undefined, undefined, null)).toEqual([]);
  });
});

// The wider rhythms in the view register: labels, grouping order, reset
// hints, and the custom weekday chip — every claim from real inputs.
describe('todo-view — monthly / biweekly / custom rhythms', () => {
  it('labels and orders the new cadences without fabricating any', () => {
    expect(cadenceLabel('biweekly')).toBe('BIWEEKLY');
    expect(cadenceLabel('monthly')).toBe('MONTHLY');
    expect(cadenceLabel('custom')).toBe('CUSTOM');
    expect(CADENCE_ORDER).toEqual(['baseline', 'daily', 'custom', 'weekly', 'biweekly', 'monthly', 'once', 'milestone']);
    const groups = groupLiveTasks([
      task({ id: 'a', cadence: 'monthly' }),
      task({ id: 'b', cadence: 'custom' }),
      task({ id: 'c', cadence: 'biweekly' }),
    ]);
    expect(groups.map((g) => g.cadence)).toEqual(['custom', 'biweekly', 'monthly']);
  });

  it('a settled recurring task announces its own return — custom by its days', () => {
    expect(resetHint(task({ status: 'done', cadence: 'biweekly' }))).toBe('reopens next fortnight');
    expect(resetHint(task({ status: 'done', cadence: 'monthly' }))).toBe('reopens next month');
    expect(resetHint(task({ status: 'done', cadence: 'custom', days: [1, 3, 5] }))).toBe('reopens MON/WED/FRI');
    // A custom task with no days claims nothing (never a fabricated schedule).
    expect(resetHint(task({ status: 'done', cadence: 'custom' }))).toBeNull();
  });

  it('customDaysLabel speaks the designed set and stays quiet on garbage', () => {
    expect(customDaysLabel({ days: [0, 6] })).toBe('SUN/SAT');
    expect(customDaysLabel({ days: [1, 3, 5] })).toBe('MON/WED/FRI');
    expect(customDaysLabel({})).toBe('');
    expect(customDaysLabel({ days: [9] })).toBe('');
    expect(WEEKDAYS).toHaveLength(7);
  });
});
