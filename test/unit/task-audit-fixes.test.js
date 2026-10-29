// task-audit-fixes — the task-system audit (docs/work/house-calendar.md),
// each finding proven against the real pure modules: a being's due-date
// update on its own ledger, focus released when work settles, work never
// recorded against a settled task, the post queue and the meditation picture
// seen by one house only. Real modules, real data; no mocks.
import { describe, test, expect } from 'vitest';
import { addTask, updateTask } from '../../core/tasks/task-ledger.js';
import { setFocus, focusedTaskId, recordWork } from '../../core/tasks/task-work.js';
import { queueEntryHouse, ofHouse } from '../../backend/services/social/queue-house.js';
import { meditationViewFor } from '../../backend/services/meditation/meditation-house-view.js';

const NOW = '2026-10-17T05:00:00.000Z';
const LATER = '2026-10-17T06:00:00.000Z';
const one = (args) => addTask({ tasks: [] }, { title: 'ship the calendar', ...args }, { id: 't1', now: NOW });

describe("a being's due dates on its own ledger", () => {
  test('a one-shot (which stores no cadence) takes, changes and clears a due date and time', () => {
    let { ledger } = one({});
    expect(ledger.tasks[0].cadence).toBeUndefined();
    ({ ledger } = updateTask(ledger, { id: 't1', dueDate: '2026-10-20', dueTime: '09:30' }, { now: LATER }));
    expect(ledger.tasks[0]).toMatchObject({ dueDate: '2026-10-20', dueTime: '09:30' });
    ({ ledger } = updateTask(ledger, { id: 't1', dueDate: null }, { now: LATER }));
    expect(ledger.tasks[0].dueDate).toBeUndefined();
  });

  test('recurring work still refuses a date, keeps a time, and a switch to once in the same update takes one', () => {
    const { ledger } = one({ cadence: 'daily' });
    expect(() => updateTask(ledger, { id: 't1', dueDate: '2026-10-20' }, { now: LATER })).toThrow(/one-shot/);
    expect(updateTask(ledger, { id: 't1', dueTime: '18:00' }, { now: LATER }).task.dueTime).toBe('18:00');
    expect(updateTask(ledger, { id: 't1', cadence: 'once', dueDate: '2026-10-20' }, { now: LATER }).task.dueDate).toBe('2026-10-20');
  });
});

describe('settled work is out of hand', () => {
  test('done or dropped releases the focus on it', () => {
    for (const status of ['done', 'dropped']) {
      const focused = setFocus(one({}).ledger, { chatId: 'c1', taskId: 't1' }, { now: NOW }).ledger;
      expect(focusedTaskId(focused, 'c1')).toBe('t1');
      expect(focusedTaskId(updateTask(focused, { id: 't1', status }, { now: LATER }).ledger, 'c1')).toBeNull();
    }
  });

  test('a focus left on a settled task (an older ledger) records nothing', () => {
    const stale = { tasks: [{ id: 't1', title: 'x', status: 'done' }], focus: { c1: 't1' } };
    expect(recordWork(stale, { chatId: 'c1', kind: 'wrote', target: 'a.js' }, { now: LATER }).recorded).toBe(false);
    const live = { tasks: [{ id: 't1', title: 'x', status: 'active' }], focus: { c1: 't1' } };
    expect(recordWork(live, { chatId: 'c1', kind: 'wrote', target: 'a.js' }, { now: LATER }).recorded).toBe(true);
  });
});

describe('the post queue, one house at a time', () => {
  const A = '0x' + 'a'.repeat(40);
  const B = '0x' + 'b'.repeat(40);
  const served = { houses: [A, B], lanes: [{ laneId: 'lane-a', wallet: A }, { laneId: 'lane-b', wallet: B }] };
  const entries = [
    { id: '1', queuedBy: A, text: 'a staged it' },
    { id: '2', authorNeumaId: 'lane-a', text: 'a being of house a' },
    { id: '3', authorNeumaId: 'lane-b', decidedBy: B, text: 'house b' },
    { id: '4', authorNeumaId: 'lane-b', decidedBy: A, text: 'a cannot approve b\'s being' },
  ];
  test('each entry belongs to the house its approver, stager and author lane agree on', () => {
    expect(entries.map((e) => queueEntryHouse(served, e))).toEqual([A, A, B, null]);
  });
  test('an operator with no beings here owns what they staged; only the scheduler asks that the house be served', () => {
    const C = '0x' + 'c'.repeat(40);
    const staged = { id: '5', queuedBy: C, text: 'no beings yet' };
    expect(queueEntryHouse(served, staged)).toBeNull();
    expect(queueEntryHouse(served, staged, { served: false })).toBe(C);
    expect(ofHouse(served, [...entries, staged], C).map((e) => e.id)).toEqual(['5']);
  });
  test('a house sees only its own entries; a wallet that is no house sees none', () => {
    expect(ofHouse(served, entries, A.toUpperCase().replace('0X', '0x')).map((e) => e.id)).toEqual(['1', '2']);
    expect(ofHouse(served, entries, B).map((e) => e.id)).toEqual(['3']);
    expect(ofHouse(served, entries, 'not-a-wallet')).toEqual([]);
  });
});

describe('the meditation picture, one house at a time', () => {
  const picture = {
    settings: { envLocked: false, defaults: { cadenceHours: 24 }, beings: { mine: { enabled: true }, theirs: { enabled: true } } },
    state: { lanes: { mine: { lastRunAt: NOW, runs: [] }, theirs: { lastRunAt: NOW, runs: [] } } },
    scheduler: {
      scheduled: true, running: true, currentLane: 'theirs', startedAt: NOW,
      lastTick: { at: NOW, runnable: 'theirs', blocked: [{ laneId: 'mine', reason: 'busy' }, { laneId: 'theirs', reason: 'busy' }] },
    },
  };
  test("another house's lanes, runs and deferrals are gone; that the machine is busy stays", () => {
    const view = meditationViewFor(new Set(['mine']), picture);
    expect(Object.keys(view.settings.beings)).toEqual(['mine']);
    expect(Object.keys(view.state.lanes)).toEqual(['mine']);
    expect(view.scheduler).toMatchObject({ running: true, currentLane: null, startedAt: null });
    expect(view.scheduler.lastTick.runnable).toBeNull();
    expect(view.scheduler.lastTick.blocked).toEqual([{ laneId: 'mine', reason: 'busy' }]);
    expect(meditationViewFor(new Set(['theirs']), picture).scheduler.currentLane).toBe('theirs');
  });
});
