// TASK FLOW — focus, work, and a task that survives being interrupted.
//
// Split out of task-chat-scope.test.js by the catalog cut (#414): that file is
// a baselined size-law offender and shrink-only, and this describe was always
// a separate subject — what FOCUS does and what a crash leaves behind, rather
// than how two chats keep their lists apart.
//
// RULE 0 throughout: the acts ride the REAL intent sweep, the list rides the
// REAL handler, and every reading below is taken off real encrypted disk.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { __test } from '../../backend/services/portal-test-surface.js';
import { taskCaller } from '../helpers/task-path.js';
import { intentType } from '../../backend/services/intents/registry.js';
import { focusedTaskId, taskState } from '../../core/tasks/task-work.js';
import { assemblePromptSections } from '../../core/runtime/prompt-assembler.js';

const { _handleTaskTool, TASK_TOOLS, _recordWorkAgainstFocus } = __test;

const KEY = 'gnosis-task-flow-key-long-enough-ok';

describe('TASK FLOW — focus, work, and a task that survives being interrupted', () => {
  let prevKey, prevRealm, neumaId, connection, events;
  const ws = { send: (raw) => events.push(JSON.parse(raw)) };
  const CHAT = 'session-1754000000777';

  beforeAll(async () => {
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    prevRealm = process.env.NEUMA_REALM_ROOT;
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const root = await createTempDir('task-flow');
    setWorkspacesRoot(path.join(root, 'workspaces'));
    process.env.NEUMA_REALM_ROOT = path.join(root, 'realm');
    neumaId = 'flow-being-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(neumaId);
    connection = { companion: { name: 'Flowlet', neumaId }, _sessionToolPolicy: null, sessionId: CHAT };
    events = [];
  });

  afterAll(() => {
    vi.restoreAllMocks();
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
    if (prevRealm === undefined) delete process.env.NEUMA_REALM_ROOT;
    else process.env.NEUMA_REALM_ROOT = prevRealm;
  });

  const call = taskCaller({ ws, handler: _handleTaskTool, connection: () => connection });
  const idOf = (res) => res.content.match(/\[([0-9a-f]{8})\]/)[1];

  it('offers tasks/focus — a being must be able to SAY what it is working', () => {
    expect(intentType('tasks/focus')?.policyTool).toBe('tasks.focus');
    expect(TASK_TOOLS.map((t) => t.name)).not.toContain('task_focus');
  });

  it('focusing IS starting: an open task becomes active, on real disk', async () => {
    const added = await call('task_add', { title: 'Wire the seam' });
    const short = idOf(added);
    const focused = await call('task_focus', { id: short });
    expect(focused.status).toBe('ok');

    const ledger = await workspace.readTaskLedger(neumaId);
    const task = ledger.tasks.find((t) => t.title === 'Wire the seam');
    expect(task.status).toBe('active');
    expect(focusedTaskId(ledger, CHAT)).toBe(task.id);
  });

  it('THE CRASH CASE: work lands on the focused task, and it reads INTERRUPTED', async () => {
    const ledger0 = await workspace.readTaskLedger(neumaId);
    const task0 = ledger0.tasks.find((t) => t.title === 'Wire the seam');
    expect(task0.work).toBeUndefined(); // nothing recorded yet

    // THE REAL RECORDER, driven — not simulated. This is the exact function the
    // MCP tool loop calls after every successful tool call; the test hands it a
    // tool name and args the way the seam does and touches neither artifactFor
    // nor recordWork itself. Everything past this line is read back off disk.
    await _recordWorkAgainstFocus(connection, 'write_file', { path: '/repo/seam.js' });

    const back = await workspace.readTaskLedger(neumaId);
    const task = back.tasks.find((t) => t.id === task0.id);
    // Mid-turn it is being worked…
    expect(taskState(task, { focusedId: task.id, streaming: true })).toBe('in-progress');
    // …and after the crash — no live turn — the task itself says it is unfinished.
    expect(taskState(task, { focusedId: null, streaming: false })).toBe('interrupted');
    expect(task.work.artifacts).toHaveLength(1);
    expect(task.work.artifacts[0]).toMatchObject({ kind: 'wrote', target: '/repo/seam.js' });
  });

  it('work with NOTHING in focus is recorded against nothing — never guessed at', async () => {
    await call('task_focus', { id: null });
    const before = await workspace.readTaskLedger(neumaId);
    await _recordWorkAgainstFocus(connection, 'write_file', { path: '/repo/unattributed.js' });
    const after = await workspace.readTaskLedger(neumaId);
    // Filing a being's file write under whatever task happened to be open is
    // worse than recording nothing, so nothing is what happens.
    expect(after.tasks.map((t) => t.work?.artifacts?.length ?? 0))
      .toEqual(before.tasks.map((t) => t.work?.artifacts?.length ?? 0));
  });

  it('a being READING its own list is not work done ON a task', async () => {
    const target = (await workspace.readTaskLedger(neumaId)).tasks.find((t) => t.title === 'Wire the seam');
    await call('task_focus', { id: target.id });
    const before = (await workspace.readTaskLedger(neumaId)).tasks.find((t) => t.id === target.id);
    await _recordWorkAgainstFocus(connection, 'task_list', {});
    const after = (await workspace.readTaskLedger(neumaId)).tasks.find((t) => t.id === target.id);
    // Otherwise every task would look worked the moment it was listed.
    expect(after.work.artifacts).toHaveLength(before.work.artifacts.length);
  });

  it('the being READS that state in its own prompt, not just the desk', async () => {
    const ledger = await workspace.readTaskLedger(neumaId);
    const section = assemblePromptSections({ taskLedger: ledger, chatId: CHAT }).find((s) => s.id === 'tasks');
    expect(section.text).toContain('WORKING THIS NOW');
    expect(section.text).toContain('already done here');
    expect(section.text).toContain('last files: /repo/seam.js');
    expect(section.text).toContain('TREAT EVERY TASK AS A GOAL THAT MUST BE CLOSED');
  });

  it('names the near-duplicates when a second task says the same thing', async () => {
    const again = await call('task_add', { title: 'Wire the seam properly' });
    expect(again.content).toContain('ALREADY ON YOUR LIST');
    expect(again.content).toContain('Wire the seam');
  });

  it('refuses to focus a settled task — "what am I working" must never answer with a finished thing', async () => {
    const added = await call('task_add', { title: 'Something finished' });
    const short = idOf(added);
    await call('task_update', { id: short, status: 'done' });
    const refused = await call('task_focus', { id: short });
    expect(refused.status).toBe('error');
    expect(refused.error).toMatch(/already done/);
  });

  it('putting the work down clears the focus without settling anything', async () => {
    const cleared = await call('task_focus', { id: null });
    expect(cleared.status).toBe('ok');
    const ledger = await workspace.readTaskLedger(neumaId);
    expect(focusedTaskId(ledger, CHAT)).toBeNull();
    // The task is still live — putting something down is not finishing it.
    expect(ledger.tasks.find((t) => t.title === 'Wire the seam').status).toBe('active');
  });
});
