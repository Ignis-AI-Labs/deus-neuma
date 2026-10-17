// THE STEPS ON A BEING'S OWN LEDGER (#531 follow-through, Design note, 2026-09-20:
// […]) — the pure laws, real inputs, no
// doubles anywhere: the ledger ops, the shared replace law beneath them, the
// render, the take-through, and the intent-layer refusals.

import { describe, it, expect } from 'vitest';
import {
  addTask, updateTask, emptyLedger, formatLedgerSection, formatLedgerForBeing,
} from '../../core/tasks/task-ledger.js';
import { replaceSubtasks } from '../../core/tasks/plan-subtasks.js';
import { takeAssigned } from '../../core/tasks/task-take.js';
import { materializeRecurrence } from '../../core/tasks/assigned-plan.js';
import { taskAddIntent, taskUpdateIntent } from '../../backend/services/intents/task-acts.js';

const mint = (() => {
  let n = 0;
  return () => `sub-${String(++n).padStart(3, '0')}`;
})();
const stamp = (n) => ({ id: `id-${String(n).padStart(4, '0')}`, now: `2026-09-20T1${n}:00:00.000Z`, mintId: mint });

describe('steps authored at add time', () => {
  it('titles become an open checklist; the task carries it', () => {
    const { ledger, task } = addTask(emptyLedger(), {
      title: 'Pre-desk daily', subtasks: ['bench press', 'garden work'],
    }, stamp(1));
    expect(task.subtasks).toHaveLength(2);
    expect(task.subtasks[0]).toMatchObject({ title: 'bench press', status: 'open' });
    expect(ledger.tasks[0].subtasks).toHaveLength(2);
  });

  it('{title, done} starts a step already ticked', () => {
    const { task } = addTask(emptyLedger(), {
      title: 'morning', subtasks: ['wake', { title: 'stretch', done: true }],
    }, stamp(1));
    expect(task.subtasks[0].status).toBe('open');
    expect(task.subtasks[1].status).toBe('done');
  });

  it('a done daily reopens with its checklist fresh (the shared roll)', () => {
    let { ledger, task } = addTask(emptyLedger(), {
      title: 'daily walk', cadence: 'daily', subtasks: [{ title: 'garden', done: true }],
    }, stamp(1));
    ({ ledger } = updateTask(ledger, { id: task.id, status: 'done' }, stamp(2)));
    // The roll the intent layer runs inside every mutation: past the period,
    // the daily reopens AND its steps start fresh (tomorrow's menu unchecked).
    ({ plan: ledger } = materializeRecurrence(ledger, '2026-09-21T10:00:00.000Z'));
    task = ledger.tasks.find((t) => t.id === task.id);
    expect(task.status).toBe('open');
    expect(task.subtasks[0].status).toBe('open');
  });
});

describe('the replace-all law on the own ledger', () => {
  it('a title-matched step keeps its tick; left-out steps retire; [] clears', () => {
    let { ledger, task } = addTask(emptyLedger(), {
      title: 'daily', subtasks: ['keep', 'retire me'],
    }, stamp(1));
    ({ ledger, task } = updateTask(ledger, { id: task.id, subtasks: [{ title: 'keep', done: true }, 'new step'] }, stamp(2)));
    expect(task.subtasks).toHaveLength(2);
    expect(task.subtasks[0]).toMatchObject({ title: 'keep', status: 'done' });
    expect(task.subtasks[1]).toMatchObject({ title: 'new step', status: 'open' });
    ({ task } = updateTask(ledger, { id: task.id, subtasks: [] }, stamp(3)));
    expect(task.subtasks).toBeUndefined();
  });

  it('the ledger keeps its SIBLING keys (the focus pointer) through a step replace', () => {
    const { ledger, task } = addTask(emptyLedger(), { title: 'stepped', subtasks: ['a'] }, stamp(1));
    const withFocus = { ...ledger, focus: { 'chat-1': task.id } };
    const { ledger: next } = updateTask(withFocus, { id: task.id, subtasks: ['a', 'b'] }, stamp(2));
    expect(next.focus).toEqual({ 'chat-1': task.id });
  });

  it('a dropped task refuses new steps; the correction names why', () => {
    let { ledger, task } = addTask(emptyLedger(), { title: 'gone', subtasks: ['a'] }, stamp(1));
    ({ ledger } = updateTask(ledger, { id: task.id, status: 'dropped' }, stamp(2)));
    expect(() => updateTask(ledger, { id: task.id, subtasks: ['again'] }, stamp(3)))
      .toThrow(/that task was dropped/);
  });

  it('the same laws hold through replaceSubtasks directly (the shared leaf)', () => {
    const { ledger, task } = addTask(emptyLedger(), { title: 'shared law', subtasks: ['one'] }, stamp(1));
    const { plan, task: replaced } = replaceSubtasks(ledger, { taskId: task.id, titles: ['one', 'two'] }, { now: stamp(2).now, mintId: mint });
    expect(replaced.subtasks).toHaveLength(2);
    expect(plan.tasks).toHaveLength(1);
  });
});

describe('steps render', () => {
  it('WORKING STATE and task_list show open steps indented under their task', () => {
    const { ledger } = addTask(emptyLedger(), {
      title: 'the daily', subtasks: ['bench press', 'garden work'],
    }, stamp(1));
    const section = formatLedgerSection(ledger, { chatId: 'chat-1' });
    expect(section).toContain('the daily');
    expect(section).toContain('– bench press');
    expect(section).toContain('– garden work');
    const list = formatLedgerForBeing(ledger, { chatId: 'chat-1' });
    expect(list).toContain('– bench press');
  });

  it('done steps stay quiet on the render until the checklist reopens', () => {
    const { ledger } = addTask(emptyLedger(), {
      title: 'quiet', subtasks: [{ title: 'already done', done: true }, 'still open'],
    }, stamp(1));
    const section = formatLedgerSection(ledger, { chatId: 'chat-1' });
    expect(section).not.toContain('– already done');
    expect(section).toContain('– still open');
  });

  it('steps travel with a TAKEN assignment, ticks included', () => {
    const assigned = {
      id: 'asg-1', title: 'the plan', status: 'open',
      subtasks: [{ id: 's1', title: 'done part', status: 'done' }, { id: 's2', title: 'open part', status: 'open' }],
    };
    const { task } = takeAssigned(emptyLedger(), assigned, { id: 'own-1', now: stamp(1).now, mintId: mint });
    expect(task.fromAssigned).toBe('asg-1');
    expect(task.subtasks).toHaveLength(2);
    expect(task.subtasks[0]).toMatchObject({ title: 'done part', status: 'done' });
    expect(task.subtasks[1]).toMatchObject({ title: 'open part', status: 'open' });
  });
});

describe('the intents refuse malformed steps before a card is filed', () => {
  it('tasks/add validates shape, tick type, and the cap', async () => {
    expect((await taskAddIntent.validate({ title: 'x', subtasks: 'one step' })).reason).toMatch(/must be an array/);
    expect((await taskAddIntent.validate({ title: 'x', subtasks: ['ok', ''] })).reason).toMatch(/needs a title/);
    expect((await taskAddIntent.validate({ title: 'x', subtasks: [{ title: 'a', done: 'yes' }] })).reason).toMatch(/done must be true or false/);
    expect((await taskAddIntent.validate({ title: 'x', subtasks: Array.from({ length: 21 }, () => 's') })).reason).toMatch(/at most 20 steps/);
    const ok = await taskAddIntent.validate({ title: 'x', subtasks: ['a', { title: 'b', done: false }] });
    expect(ok.ok).toBe(true);
  });

  it('tasks/update validates the same law and keeps subtasks a KNOWN field', async () => {
    expect((await taskUpdateIntent.validate({ id: 'abc', subtasks: [42] })).reason).toMatch(/needs a title/);
    expect((await taskUpdateIntent.validate({ id: 'abc', subtasks: [] })).ok).toBe(true);
    // The field that used to be refused with a hint pointing at the operator
    // list is first-class now: no unknown-field refusal anymore.
    const out = await taskUpdateIntent.validate({ id: 'abc', subtasks: ['step'] });
    expect(out.ok).toBe(true);
  });
});
