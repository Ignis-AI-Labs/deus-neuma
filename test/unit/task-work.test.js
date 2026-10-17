/**
 * TASK FLOW — focus, work, and the derived INTERRUPTED state. All pure
 * functions over real inputs; no mock anywhere (RULE 0).
 *
 * The headline assertion is the crash case: a task worked and then abandoned
 * mid-flight must read as INTERRUPTED with its artifacts intact, WITHOUT any
 * cleanup handler having run — because the process that would have run it is
 * the one that died.
 */
import { describe, test, expect } from 'vitest';
import {
  focusedTaskId, setFocus, recordWork, taskState, isChecked, workSummary, findSimilarTasks, WORK_ARTIFACT_CAP, artifactFor,
} from '../../core/tasks/task-work.js';
import { addTask, updateTask, prune } from '../../core/tasks/task-ledger.js';

const NOW = '2026-08-02T05:00:00.000Z';
const LATER = '2026-08-02T05:30:00.000Z';
const CHAT = 'chat-1';

const ledgerOf = (...tasks) => ({ tasks });
const task = (over = {}) => ({ id: 't1', title: 'a task', status: 'open', ...over });

describe('focus — a pointer, not a status', () => {
  test('nothing is focused by default', () => {
    expect(focusedTaskId(ledgerOf(task()), CHAT)).toBeNull();
    expect(focusedTaskId(null, CHAT)).toBeNull();
    expect(focusedTaskId({ focus: { [CHAT]: 't1' } }, null)).toBeNull();
  });

  test('focusing a task points this chat at it AND makes it active', () => {
    // Focusing IS starting — the operator should not have to say it twice.
    const r = setFocus(ledgerOf(task()), { chatId: CHAT, taskId: 't1' }, { now: NOW });
    expect(r.ok).toBe(true);
    expect(focusedTaskId(r.ledger, CHAT)).toBe('t1');
    expect(r.ledger.tasks[0].status).toBe('active');
  });

  test('two chats hold two different focuses without touching each other', () => {
    const a = setFocus(ledgerOf(task({ id: 't1' }), task({ id: 't2' })), { chatId: 'c1', taskId: 't1' }, { now: NOW });
    const b = setFocus(a.ledger, { chatId: 'c2', taskId: 't2' }, { now: NOW });
    expect(focusedTaskId(b.ledger, 'c1')).toBe('t1');
    expect(focusedTaskId(b.ledger, 'c2')).toBe('t2');
  });

  test('focus can be cleared', () => {
    const a = setFocus(ledgerOf(task()), { chatId: CHAT, taskId: 't1' }, { now: NOW });
    const b = setFocus(a.ledger, { chatId: CHAT, taskId: null }, { now: NOW });
    expect(focusedTaskId(b.ledger, CHAT)).toBeNull();
  });

  test('a finished task cannot be focused — "what am I working on" must not answer with it', () => {
    for (const status of ['done', 'dropped']) {
      const r = setFocus(ledgerOf(task({ status })), { chatId: CHAT, taskId: 't1' }, { now: NOW });
      expect(r.ok).toBe(false);
      expect(r.error).toContain(status);
    }
  });

  test('an unknown task and a missing chat are refused, not silently stored', () => {
    expect(setFocus(ledgerOf(task()), { chatId: CHAT, taskId: 'ghost' }, { now: NOW }).ok).toBe(false);
    expect(setFocus(ledgerOf(task()), { chatId: '', taskId: 't1' }, { now: NOW }).ok).toBe(false);
  });

  test('does not mutate the ledger it was given', () => {
    const before = ledgerOf(task());
    setFocus(before, { chatId: CHAT, taskId: 't1' }, { now: NOW });
    expect(before.tasks[0].status).toBe('open');
    expect(before.focus).toBeUndefined();
  });
});

describe('recordWork — what actually happened', () => {
  const focused = () => setFocus(ledgerOf(task()), { chatId: CHAT, taskId: 't1' }, { now: NOW }).ledger;

  test('an act against the focused task is recorded with its kind and target', () => {
    const r = recordWork(focused(), { chatId: CHAT, kind: 'wrote', target: 'src/a.js' }, { now: NOW });
    expect(r.recorded).toBe(true);
    expect(r.ledger.tasks[0].work.artifacts).toEqual([{ kind: 'wrote', target: 'src/a.js', at: NOW }]);
    expect(r.ledger.tasks[0].work.firstAt).toBe(NOW);
  });

  test('NOTHING is recorded when no task is in focus', () => {
    // Guessing an owner would file a being's work under whatever happened to be
    // open, which is worse than recording nothing.
    const r = recordWork(ledgerOf(task()), { chatId: CHAT, kind: 'wrote', target: 'src/a.js' }, { now: NOW });
    expect(r.recorded).toBe(false);
    expect(r.ledger.tasks[0].work).toBeUndefined();
  });

  test('firstAt is kept and lastAt moves — the span of the work', () => {
    const a = recordWork(focused(), { chatId: CHAT, kind: 'wrote', target: 'a.js' }, { now: NOW });
    const b = recordWork(a.ledger, { chatId: CHAT, kind: 'ran', target: 'npm test' }, { now: LATER });
    expect(b.ledger.tasks[0].work).toMatchObject({ firstAt: NOW, lastAt: LATER });
    expect(b.ledger.tasks[0].work.artifacts).toHaveLength(2);
  });

  test('a repeated identical act collapses with a count instead of flooding', () => {
    let l = focused();
    for (let i = 0; i < 5; i += 1) {
      l = recordWork(l, { chatId: CHAT, kind: 'wrote', target: 'a.js' }, { now: NOW }).ledger;
    }
    expect(l.tasks[0].work.artifacts).toHaveLength(1);
    expect(l.tasks[0].work.artifacts[0].count).toBe(5);
  });

  test('artifacts are capped, keeping the NEWEST', () => {
    let l = focused();
    for (let i = 0; i < WORK_ARTIFACT_CAP + 10; i += 1) {
      l = recordWork(l, { chatId: CHAT, kind: 'wrote', target: `f${i}.js` }, { now: NOW }).ledger;
    }
    const arts = l.tasks[0].work.artifacts;
    expect(arts).toHaveLength(WORK_ARTIFACT_CAP);
    expect(arts[arts.length - 1].target).toBe(`f${WORK_ARTIFACT_CAP + 9}.js`);
  });

  test('an empty target records nothing; an unknown kind degrades to "ran"', () => {
    expect(recordWork(focused(), { chatId: CHAT, kind: 'wrote', target: '  ' }, { now: NOW }).recorded).toBe(false);
    const r = recordWork(focused(), { chatId: CHAT, kind: 'nonsense', target: 'x' }, { now: NOW });
    expect(r.ledger.tasks[0].work.artifacts[0].kind).toBe('ran');
  });
});

describe('taskState — the display law', () => {
  test('done and dropped read as themselves', () => {
    expect(taskState(task({ status: 'done' }))).toBe('done');
    expect(taskState(task({ status: 'dropped' }))).toBe('dropped');
  });

  test('an untouched task is open', () => {
    expect(taskState(task())).toBe('open');
  });

  test('the focused task during a live turn is IN PROGRESS', () => {
    expect(taskState(task({ status: 'active' }), { focusedId: 't1', streaming: true })).toBe('in-progress');
  });

  test('⭐ THE CRASH CASE: worked, still active, nothing writing ⇒ INTERRUPTED', () => {
    // No cleanup handler ran — the process that would have run it is the one
    // that died. The absence of further writes IS the signal.
    const crashed = task({ status: 'active', work: { firstAt: NOW, lastAt: LATER, artifacts: [{ kind: 'wrote', target: 'a.js', at: NOW }] } });
    expect(taskState(crashed, { focusedId: null, streaming: false })).toBe('interrupted');
    // Still interrupted even if it is nominally the focus, as long as no turn
    // is live — reopening the desk after a crash must not read as in-progress.
    expect(taskState(crashed, { focusedId: 't1', streaming: false })).toBe('interrupted');
  });

  test('active with NO work yet is just active, not interrupted', () => {
    expect(taskState(task({ status: 'active' }), { streaming: false })).toBe('active');
  });

  test('a task with work that was FINISHED reads done, never interrupted', () => {
    const finished = task({ status: 'done', work: { firstAt: NOW, lastAt: LATER, artifacts: [{ kind: 'wrote', target: 'a.js' }] } });
    expect(taskState(finished, { streaming: false })).toBe('done');
  });
});

describe('isChecked / workSummary', () => {
  test('only a done task shows a ticked box', () => {
    expect(isChecked(task({ status: 'done' }))).toBe(true);
    for (const s of ['open', 'active', 'dropped']) expect(isChecked(task({ status: s }))).toBe(false);
  });

  test('summary counts repeats, lists kinds, and keeps last-touch paths', () => {
    const t = task({ work: { firstAt: NOW, lastAt: LATER, artifacts: [
      { kind: 'wrote', target: 'a.js', count: 3 }, { kind: 'ran', target: 'npm test' },
    ] } });
    expect(workSummary(t)).toMatchObject({
      count: 4, kinds: ['wrote', 'ran'], firstAt: NOW, lastAt: LATER, targets: ['npm test', 'a.js'],
    });
  });


  test('no work ⇒ no summary, rather than a zeroed one', () => {
    expect(workSummary(task())).toBeNull();
    expect(workSummary(task({ work: { artifacts: [] } }))).toBeNull();
  });
});

describe('findSimilarTasks — the anti-duplication check', () => {
  const tasks = [
    task({ id: 'a', title: 'Build the first Umbrae reply-GIF library tranche' }),
    task({ id: 'b', title: 'Investigate why the last scheduled X post did not publish' }),
    task({ id: 'c', title: 'Verify Umbrae rewards and payout architecture' }),
    task({ id: 'd', title: 'an old dropped thing about GIF library work', status: 'dropped' }),
  ];

  test('finds an existing task aligned to the same intent', () => {
    const hits = findSimilarTasks(tasks, 'Build the Umbrae reply GIF library');
    expect(hits[0].id).toBe('a');
  });

  test('an unrelated intent matches nothing', () => {
    expect(findSimilarTasks(tasks, 'Repaint the kitchen ceiling')).toEqual([]);
  });

  test('stopwords alone never manufacture a match', () => {
    expect(findSimilarTasks(tasks, 'the and of for this that')).toEqual([]);
    expect(findSimilarTasks(tasks, '')).toEqual([]);
  });

  test('dropped tasks are not offered as duplicates', () => {
    expect(findSimilarTasks(tasks, 'GIF library work').some((h) => h.id === 'd')).toBe(false);
  });

  test('returns CANDIDATES, best first — never a refusal', () => {
    // An automatic […] would be wrong often enough to
    // be infuriating; the being is the one who can actually tell.
    const hits = findSimilarTasks(tasks, 'Umbrae rewards payout');
    expect(Array.isArray(hits)).toBe(true);
    expect(hits[0].id).toBe('c');
    expect(hits.every((h) => typeof h.score === 'number')).toBe(true);
  });
});

describe('the ledger keeps FOCUS across task mutations', () => {
  // Raised as a research question by GLM in echo r1 and then reproduced: prune,
  // addTask and updateTask each rebuilt the ledger as a bare `{ tasks }`, so
  // the focus pointer died on the next mutation — and with it work recording,
  // because an artifact with nothing in focus is attributable to nothing. The
  // crash record this whole module exists for would have been silently empty.
  const focused = () => {
    const added = addTask({ tasks: [] }, { title: 'first' }, { now: NOW, id: 'a' });
    return setFocus(added.ledger, { chatId: CHAT, taskId: 'a' }, { now: NOW }).ledger;
  };

  test('addTask preserves focus', () => {
    const after = addTask(focused(), { title: 'second' }, { now: NOW, id: 'b' }).ledger;
    expect(focusedTaskId(after, CHAT)).toBe('a');
  });

  test('updateTask preserves focus', () => {
    const after = updateTask(focused(), { id: 'a', title: 'renamed' }, { now: NOW }).ledger;
    expect(focusedTaskId(after, CHAT)).toBe('a');
  });

  test('prune preserves focus on both its exits', () => {
    // The short exit (nothing to prune) and the pruning exit both rebuilt the
    // ledger, so both had to be fixed.
    expect(focusedTaskId(prune(focused()), CHAT)).toBe('a');
    let l = focused();
    for (let i = 0; i < 60; i += 1) {
      l = addTask(l, { title: `t${i}` }, { now: NOW, id: `x${i}` }).ledger;
      l = updateTask(l, { id: `x${i}`, status: 'done' }, { now: NOW }).ledger;
    }
    expect(focusedTaskId(l, CHAT)).toBe('a');
  });

  test('work still records after a mutation — the real consequence', () => {
    const after = addTask(focused(), { title: 'second' }, { now: NOW, id: 'b' }).ledger;
    const r = recordWork(after, { chatId: CHAT, kind: 'wrote', target: 'x.js' }, { now: NOW });
    expect(r.recorded).toBe(true);
    expect(r.ledger.tasks.find((t) => t.id === 'a').work.artifacts).toHaveLength(1);
  });
});

describe('what a real tool call leaves on a task', () => {
  it('reads the ACT from the verb and the TARGET from the arguments', () => {
    expect(artifactFor('write_file', { path: '/repo/a.js' })).toEqual({ kind: 'wrote', target: '/repo/a.js' });
    expect(artifactFor('edit_file', { file_path: '/repo/b.js' })).toEqual({ kind: 'wrote', target: '/repo/b.js' });
    expect(artifactFor('create_directory', { path: '/repo/new' })).toEqual({ kind: 'made', target: '/repo/new' });
    expect(artifactFor('read_file', { path: '/repo/c.js' })).toEqual({ kind: 'read', target: '/repo/c.js' });
    expect(artifactFor('post_to_x', { target: 'the launch thread' })).toEqual({ kind: 'posted', target: 'the launch thread' });
  });

  it('a tool nobody taught it about still leaves a trace', () => {
    // The evidence that SOMETHING happened is the point. Dropping the unknown
    // would let a whole turn's work vanish because a new tool shipped.
    expect(artifactFor('summon_the_kraken', {})).toEqual({ kind: 'ran', target: 'summon_the_kraken' });
    expect(artifactFor('summon_the_kraken', { path: '/deep/sea' })).toEqual({ kind: 'ran', target: '/deep/sea' });
  });

  it('task bookkeeping is NOT work on a task', () => {
    // Otherwise a being that merely READ its own list would leave evidence of
    // progress, and every task would look worked the moment it was listed.
    for (const t of ['task_add', 'task_update', 'task_list', 'task_focus', 'operator_task_add', 'witness_task_add']) {
      expect(artifactFor(t, { path: '/x' })).toBeNull();
    }
  });

  it('refuses to invent an act out of nothing', () => {
    expect(artifactFor('', {})).toBeNull();
    expect(artifactFor(null)).toBeNull();
    expect(artifactFor(undefined)).toBeNull();
  });

  it('is defensive about the arguments it is handed', () => {
    for (const junk of [null, undefined, 'a string', 42, []]) {
      expect(() => artifactFor('write_file', junk)).not.toThrow();
      expect(artifactFor('write_file', junk)).toEqual({ kind: 'wrote', target: 'write_file' });
    }
  });

  it('bounds the target — a pathological argument cannot bloat the record', () => {
    const long = `/${'x'.repeat(500)}`;
    expect(artifactFor('write_file', { path: long }).target).toHaveLength(300);
  });

  it('feeds recordWork directly — the two halves speak the same shape', () => {
    // The real path: a tool fires, artifactFor names it, recordWork files it
    // under whatever this chat has in focus.
    let led = { tasks: [{ id: 't1', title: 'Wire the seam', status: 'open' }] };
    ({ ledger: led } = setFocus(led, { chatId: 'session-1', taskId: 't1' }, { now: NOW }));
    const act = artifactFor('write_file', { path: '/repo/seam.js' });
    const { ledger: after, recorded } = recordWork(led, { chatId: 'session-1', ...act }, { now: NOW });
    expect(recorded).toBe(true);
    expect(workSummary(after.tasks[0])).toMatchObject({ count: 1, kinds: ['wrote'] });
  });
});
