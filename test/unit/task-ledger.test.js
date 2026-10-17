// Task ledger — pure ops. No IO anywhere in the module under test.

import { describe, it, expect } from 'vitest';
import {
  addTask, updateTask, prune, formatLedgerSection, formatLedgerForBeing,
  emptyLedger, TASK_MAX_LIVE, TASK_MAX_SETTLED, TASK_TITLE_MAX_CHARS,
} from '../../core/tasks/task-ledger.js';
import { materializeRecurrence } from '../../core/tasks/assigned-plan.js';

const stamp = (n) => ({ id: `id-${String(n).padStart(4, '0')}`, now: `2026-07-06T12:${String(n % 60).padStart(2, '0')}:00.000Z` });

describe('task ledger — pure ops', () => {
  it('add → update → done: the full working cycle', () => {
    let { ledger, task } = addTask(emptyLedger(), { title: 'Prove the ledger', detail: 'unit + integration green' }, stamp(1));
    expect(task.status).toBe('open');
    expect(ledger.tasks).toHaveLength(1);

    ({ ledger, task } = updateTask(ledger, { id: task.id, status: 'active' }, { now: '2026-07-06T13:00:00.000Z' }));
    expect(task.status).toBe('active');

    ({ ledger, task } = updateTask(ledger, { id: task.id, status: 'done' }, { now: '2026-07-06T14:00:00.000Z' }));
    expect(task.status).toBe('done');
    expect(task.updatedAt).toBe('2026-07-06T14:00:00.000Z');
    expect(task.createdAt).toBe(stamp(1).now);
  });

  it('validation names the correction: no title, long title, bad status, unknown id, empty patch', () => {
    expect(() => addTask(emptyLedger(), {}, stamp(1))).toThrow(/needs a title/);
    expect(() => addTask(emptyLedger(), { title: 'x'.repeat(TASK_TITLE_MAX_CHARS + 1) }, stamp(1))).toThrow(/under 200/);
    const { ledger, task } = addTask(emptyLedger(), { title: 'ok' }, stamp(1));
    expect(() => updateTask(ledger, { id: task.id, status: 'paused' }, stamp(2))).toThrow(/one of: open, active, done, dropped/);
    expect(() => updateTask(ledger, { id: 'nope', status: 'done' }, stamp(2))).toThrow(/no task with id/);
    expect(() => updateTask(ledger, { id: task.id }, stamp(2))).toThrow(/changed nothing/);
  });

  it('the live cap holds on add AND on reopen', () => {
    let ledger = emptyLedger();
    for (let i = 0; i < TASK_MAX_LIVE; i++) ({ ledger } = addTask(ledger, { title: `t${i}` }, stamp(i)));
    expect(() => addTask(ledger, { title: 'one too many' }, stamp(99))).toThrow(/finish or drop/);

    // settle one, drop-slot frees, reopen refused once full again
    const first = ledger.tasks[0];
    ({ ledger } = updateTask(ledger, { id: first.id, status: 'done' }, stamp(31)));
    ({ ledger } = addTask(ledger, { title: 'fills the slot' }, stamp(32)));
    expect(() => updateTask(ledger, { id: first.id, status: 'open' }, stamp(33))).toThrow(/before reopening/);
  });

  it('prune trims settled history to the cap, never live tasks', () => {
    let ledger = emptyLedger();
    for (let i = 0; i < TASK_MAX_SETTLED + 5; i++) {
      let task;
      ({ ledger, task } = addTask(ledger, { title: `settled-${i}` }, stamp(i)));
      ({ ledger } = updateTask(ledger, { id: task.id, status: 'dropped' }, stamp(i)));
    }
    ({ ledger } = addTask(ledger, { title: 'still live' }, stamp(50)));
    const pruned = prune(ledger);
    expect(pruned.tasks.filter((t) => t.status === 'dropped')).toHaveLength(TASK_MAX_SETTLED);
    expect(pruned.tasks.some((t) => t.title === 'still live')).toBe(true);
  });

  it('the WORKING STATE section carries live tasks (active first); with nothing live it teaches the cold start', () => {
    // COLD START SPEAKS (2026-08-16): a real ledger with nothing live emits
    // the doctrine — the being about to take on fresh work is the one that
    // most needs it. NO ledger at all (null — probe contexts, failed readers)
    // still emits nothing: absence of a store is not an empty list, and the
    // frozen prompt fixtures pass no ledger.
    const cold = formatLedgerSection(emptyLedger());
    expect(cold).toContain('## Working State');
    expect(cold).toContain('Nothing is live on your ledger');
    expect(cold).toContain('tasks/add'); // the doctrine teaches the intent route (S3b4)
    expect(formatLedgerSection(null)).toBe('');

    let { ledger } = addTask(emptyLedger(), { title: 'open thing' }, stamp(1));
    let active;
    ({ ledger, task: active } = addTask(ledger, { title: 'active thing' }, stamp(2)));
    ({ ledger } = updateTask(ledger, { id: active.id, status: 'active' }, stamp(3)));

    const section = formatLedgerSection(ledger);
    expect(section).toContain('## Working State');
    expect(section.indexOf('active thing')).toBeLessThan(section.indexOf('open thing'));

    // A settled-only ledger reads as the cold start too — never as silence.
    ({ ledger } = updateTask(ledger, { id: ledger.tasks[0].id, status: 'done' }, stamp(4)));
    ({ ledger } = updateTask(ledger, { id: active.id, status: 'dropped' }, stamp(5)));
    expect(formatLedgerSection(ledger)).toContain('Nothing is live on your ledger');
  });

  it('formatLedgerForBeing shows live then settled, and speaks when empty', () => {
    expect(formatLedgerForBeing(emptyLedger())).toContain('tasks/add');
    let { ledger, task } = addTask(emptyLedger(), { title: 'alive' }, stamp(1));
    ({ ledger } = addTask(ledger, { title: 'finished' }, stamp(2)));
    ({ ledger } = updateTask(ledger, { id: ledger.tasks[1].id, status: 'done' }, stamp(3)));
    const text = formatLedgerForBeing(ledger);
    expect(text).toContain('Live:');
    expect(text).toContain('Settled:');
    expect(text).toContain(task.id.slice(0, 8));
  });

  it('an explicit empty detail clears it; a new detail replaces it', () => {
    let { ledger, task } = addTask(emptyLedger(), { title: 't', detail: 'first detail' }, stamp(1));
    ({ ledger, task } = updateTask(ledger, { id: task.id, detail: 'second detail' }, stamp(2)));
    expect(task.detail).toBe('second detail');
    ({ ledger, task } = updateTask(ledger, { id: task.id, detail: '' }, stamp(3)));
    expect(task.detail).toBeUndefined();
  });

  it('cadence: stored only when daily/weekly, validated, cleared by once', () => {
    let { ledger, task } = addTask(emptyLedger(), { title: 'rhythm', cadence: 'daily' }, stamp(1));
    expect(task.cadence).toBe('daily');
    ({ ledger, task } = addTask(ledger, { title: 'plain', cadence: 'once' }, stamp(2)));
    expect(task.cadence).toBeUndefined(); // once IS the absence of rhythm
    expect(() => addTask(ledger, { title: 'x', cadence: 'hourly' }, stamp(3))).toThrow(/cadence must be one of/);
    ({ ledger, task } = updateTask(ledger, { id: task.id, cadence: 'weekly' }, stamp(4)));
    expect(task.cadence).toBe('weekly');
    ({ ledger, task } = updateTask(ledger, { id: task.id, cadence: 'once' }, stamp(5)));
    expect(task.cadence).toBeUndefined();
    ({ ledger, task } = updateTask(ledger, { id: ledger.tasks[0].id, status: 'done' }, stamp(6)));
    expect(task.completedAt).toBe(stamp(6).now);
  });

  it('prune never trims a done recurring task — it is the schedule', () => {
    let ledger = emptyLedger();
    let rhythm;
    ({ ledger, task: rhythm } = addTask(ledger, { title: 'daily standup', cadence: 'daily' }, stamp(1)));
    ({ ledger } = updateTask(ledger, { id: rhythm.id, status: 'done' }, stamp(2)));
    for (let i = 0; i < TASK_MAX_SETTLED + 5; i++) {
      let task;
      ({ ledger, task } = addTask(ledger, { title: `settled-${i}` }, stamp(10 + i)));
      ({ ledger } = updateTask(ledger, { id: task.id, status: 'dropped' }, stamp(10 + i)));
    }
    expect(ledger.tasks.some((t) => t.title === 'daily standup')).toBe(true);
    expect(ledger.tasks.filter((t) => t.status === 'dropped')).toHaveLength(TASK_MAX_SETTLED);
  });

  it('the prompt line names the rhythm; done recurring stamps the reopen clock', () => {
    let { ledger, task } = addTask(emptyLedger(), { title: 'morning pages', cadence: 'daily' }, stamp(1));
    const section = formatLedgerSection(ledger);
    expect(section).toContain('morning pages');
    expect(section).toContain('(open · daily)');
    ({ ledger, task } = updateTask(ledger, { id: task.id, status: 'done' }, stamp(2)));
    expect(task.completedAt).toBe(stamp(2).now);
  });

  it('the shared lazy recurrence reopens a done daily ledger task on schedule', () => {
    // The same materializeRecurrence the witness's plan uses rolls the
    // being's rhythms — portal-stream applies it on read and on tool writes.
    // Local-day law (core/time/day-key.js): the reopen clock turns at LOCAL
    // midnight, so the fixtures are built from explicit local components and
    // hold on any host offset.
    const at = (y, m, d, h, min) => new Date(y, m - 1, d, h, min).toISOString();
    let { ledger, task } = addTask(emptyLedger(), { title: 'train', cadence: 'daily' }, { id: 'd1', now: at(2026, 7, 17, 8, 0) });
    ({ ledger } = updateTask(ledger, { id: task.id, status: 'done' }, { now: at(2026, 7, 17, 9, 0) }));
    expect(materializeRecurrence(ledger, at(2026, 7, 17, 23, 0)).changed).toBe(false);
    const rolled = materializeRecurrence(ledger, at(2026, 7, 18, 7, 0));
    expect(rolled.changed).toBe(true);
    expect(rolled.plan.tasks[0].status).toBe('open');
  });
});
