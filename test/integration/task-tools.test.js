// The being's own working list — REAL handlers and the REAL intent sweep
// through the REAL policy gate, REAL encrypted workspace, REAL disk (RULE 0).
// The ws param is the same injected event sink production passes. Also proves
// the load-bearing half: the ledger read back from disk rides the WORKING
// STATE prompt section, and leaves it when the work settles.
//
// THE CATALOG CUT (#414): add / update / focus / take / operator-add are
// `tasks/*` intents now, so every act below is FILED and settled by the real
// sweep. `task_list` stays a tool — WORKING STATE carries the LIVE tasks only,
// so it is the sole path to settled history and to work held in another chat.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { __test } from '../../backend/services/portal-test-surface.js';
import { assemblePromptSections } from '../../core/runtime/prompt-assembler.js';
import { viaIntent } from '../helpers/intent-path.js';
import { retiredToolHint } from '../../backend/services/intents/retired-tools.js';

const { _handleTaskTool, _isTaskTool, TASK_TOOLS, _handleVesselLogTool } = __test;

const KEY = 'gnosis-task-tools-key-long-enough-ok';

describe('task tools — the being\'s own working list through the real gate', () => {
  let prevKey, neumaId, connection, events;
  const ws = { send: (raw) => events.push(JSON.parse(raw)) };

  beforeAll(async () => {
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = KEY;

    const root = await createTempDir('task-tools');
    setWorkspacesRoot(path.join(root, 'workspaces'));
    neumaId = 'test-being-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(neumaId);
    connection = { companion: { name: 'Prooflet', neumaId }, _sessionToolPolicy: null };
    events = [];
  });

  afterAll(() => {
    vi.restoreAllMocks();
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
  });

  const call = (toolName, args, { policy = null, mode = 'auto' } = {}) =>
    _handleTaskTool(ws, connection, policy, mode, { toolName }, args);

  /** File one task intent and settle it — one receipt, the being's own path. */
  const act = async (type, payload, { mode = 'auto', policy = null } = {}) => {
    const receipts = await viaIntent(connection, `tasks/${type}`, payload, mode, policy,
      (event) => events.push({ type: 'tool:usage', neumaId, ...event }));
    return receipts[0];
  };

  it('advertises READS alone — the four acts left with the catalog cut', () => {
    // the two reads: the being's own ledger, and the house calendar
    expect(TASK_TOOLS.map((t) => t.name)).toEqual(['task_list', 'calendar_read']);
    expect(_isTaskTool({ tool: 'tasks/calendar_read' })).toBe(true);
    expect(_isTaskTool({ tool: 'tasks/task_list' })).toBe(true);
    expect(_isTaskTool({ toolName: 'write_file' })).toBe(false);

    // THE CUT: none of the four acts dispatch, so none can fail
    // `checkToolAccess` closed into a card nobody asked for — and a stale call
    // from an old plan or skills pack is handed the intent to file instead.
    for (const retired of ['task_add', 'task_update', 'task_focus', 'task_take', 'operator_task_add', 'witness_task_add']) {
      expect(_isTaskTool({ toolName: retired }), `${retired} still dispatches`).toBe(false);
      expect(_isTaskTool({ tool: `tasks/${retired}` }), `${retired} still dispatches`).toBe(false);
      expect(retiredToolHint(retired)).toContain('tasks/');
    }
  });

  it('add → list → update by prefix id: the full cycle, encrypted at rest', async () => {
    const added = await act('add', { title: 'Prove the ledger qqvwzx', detail: 'both tests green' });
    expect(added.status).toBe('ok');
    const shortId = added.content.match(/\[([0-9a-f]{8})\]/)[1];

    const listed = await call('task_list', {});
    expect(listed.status).toBe('ok');
    expect(listed.content).toContain('qqvwzx');

    // The being answers with the prefix-8 id its ledger lines show.
    const updated = await act('update', { id: shortId, status: 'active' });
    expect(updated.status).toBe('ok');
    expect(updated.content).toContain('now active');

    const raw = await fs.readFile(
      path.join(workspace._path(neumaId), 'tasks', 'ledger.json'), 'utf8',
    );
    expect(raw).not.toContain('qqvwzx'); // encrypted at rest
  });

  it('LOAD-BEARING: the persisted ledger rides the WORKING STATE prompt section, and settling turns it to the cold start', async () => {
    const ledger = await workspace.readTaskLedger(neumaId);
    const withTasks = assemblePromptSections({ taskLedger: ledger });
    const section = withTasks.find((s) => s.id === 'tasks');
    expect(section).toBeDefined();
    expect(section.label).toBe('WORKING STATE');
    expect(section.text).toContain('qqvwzx');

    // COLD START SPEAKS (2026-08-16): a settled-out ledger no longer vanishes
    // from the prompt — it teaches the doctrine instead, because the being
    // with nothing live is the one about to take on fresh work. A missing
    // ledger (null — probe contexts) still rides nothing.
    const live = ledger.tasks.find((t) => t.status === 'active');
    await act('update', { id: live.id, status: 'done' });
    const settled = await workspace.readTaskLedger(neumaId);
    const cold = assemblePromptSections({ taskLedger: settled }).find((s) => s.id === 'tasks');
    expect(cold.text).toContain('Nothing is live on your ledger');
    expect(cold.text).not.toContain('qqvwzx');
    expect(assemblePromptSections({}).find((s) => s.id === 'tasks')).toBeUndefined();
  });

  it('a witness deny survives everything — and observe mode holds honestly', async () => {
    const denied = await act('add', { title: 'x' }, {
      policy: { intents: { denied: ['tasks.add'] } },
    });
    expect(denied.status).toBe('denied');

    const held = await call('task_list', {}, { mode: 'observe' });
    expect(held.status).toBe('denied');
    expect(held.error).toContain('observe');
  });

  it('errors speak plainly: no title, unknown id, ambiguous prefix, no workspace', async () => {
    expect((await act('add', { title: '   ' })).status).toBe('error');
    expect((await act('update', { id: 'zzzzzzzz', status: 'done' })).error).toMatch(/no task with id/);
    // two tasks whose ids share a prefix is practically impossible with
    // UUIDs; force ambiguity with the empty prefix instead
    await act('add', { title: 'another' });
    expect((await act('update', { id: '', status: 'done' })).error).toMatch(/needs the task id|matches several/);
    const orphan = await _handleTaskTool(ws, { companion: null }, null, 'auto', { toolName: 'task_list' }, {});
    expect(orphan.status).toBe('error');
    expect(orphan.error).toContain('workspace');
  });

  it('cadence through the gate: a rhythm stores its cadence; a bad one errors plainly', async () => {
    const added = await act('add', { title: 'Daily review qcad', cadence: 'daily' });
    expect(added.status).toBe('ok');
    const ledger = await workspace.readTaskLedger(neumaId);
    expect(ledger.tasks.find((t) => t.title.includes('qcad')).cadence).toBe('daily');
    expect((await act('add', { title: 'x', cadence: 'hourly' })).status).toBe('error');
  });

  it('the settle frame carries the being\'s neumaId — the desk\'s live-refetch seam', async () => {
    // The TASKS window refetches a lane on { type:'tool:usage', status:'ok',
    // neumaId } — the act moved to the sweep, so the frame it emits is the
    // INTENT's, and the window's seam has to be fed by that or a settled task
    // never reaches the desk until something else refetches.
    events.length = 0;
    await act('add', { title: 'Frame shape qframe' });
    const frame = events.find((e) => e.type === 'tool:usage' && e.status === 'ok' && e.tool === 'intents/tasks.add');
    expect(frame).toBeDefined();
    expect(frame.neumaId).toBe(neumaId);
  });

  it('settled work lands on the append-only history, encrypted at rest', async () => {
    const added = await act('add', { title: 'Settle me qhist' });
    const shortId = added.content.match(/\[([0-9a-f]{8})\]/)[1];
    await act('update', { id: shortId, status: 'done' });

    const history = await workspace.readTaskHistory(neumaId);
    expect(history.some((h) => h.title === 'Settle me qhist' && h.status === 'done' && h.settledAt)).toBe(true);

    const raw = await fs.readFile(
      path.join(workspace._path(neumaId), 'tasks', 'history.jsonl'), 'utf8',
    );
    expect(raw).not.toContain('qhist'); // encrypted at rest
  });

  it('a done daily whose period elapsed reopens — persisted on the next write pass', async () => {
    const current = await workspace.readTaskLedger(neumaId);
    await workspace.writeTaskLedger(neumaId, {
      tasks: [...current.tasks, {
        id: 'old-rhythm', title: 'Old rhythm qroll', cadence: 'daily', status: 'done',
        completedAt: '2000-01-01T00:00:00.000Z', createdAt: '2000-01-01T00:00:00.000Z', updatedAt: '2000-01-01T00:00:00.000Z',
      }],
    });

    // The being's own read already sees it live again (rolled in memory)...
    const listed = await call('task_list', {});
    expect(listed.status).toBe('ok');
    expect(listed.content).toContain('Old rhythm qroll');

    // ...and the roll persists with the next write op.
    await act('add', { title: 'trigger the write pass' });
    const stored = await workspace.readTaskLedger(neumaId);
    expect(stored.tasks.find((t) => t.id === 'old-rhythm').status).toBe('open');
  });
});

// tasks/operator-add — the being's one-way route to the OPERATOR'S own list.
// REAL sweep, REAL policy gate, REAL realm disk (RULE 0). The tool that used
// to carry this act left with the catalog cut (#414); the act did not.
describe('tasks/operator-add — the one-way route to the operator\'s own list', () => {
  const WALLET = '0x1111111111111111111111111111111111111111';
  let realmRoot, wconnection, wevents, neumaId;
  const wws = { send: (raw) => wevents.push(JSON.parse(raw)) };

  beforeAll(async () => {
    const prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = KEY;

    const realm = await import('../../backend/services/user-realm.js');
    realmRoot = await createTempDir('witness-tasks-realm');
    realm.setRealmRoot(realmRoot);

    const root = await createTempDir('witness-tasks-ws');
    setWorkspacesRoot(path.join(root, 'workspaces'));
    neumaId = 'test-being-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(neumaId);
    wconnection = { companion: { name: 'Prooflet', neumaId }, walletAddress: WALLET, _sessionToolPolicy: null };
    wevents = [];
    return () => {
      if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
      else process.env.DNA_ENCRYPTION_KEY = prevKey;
    };
  });

  const wcall = async (args, { policy = null, mode = 'auto' } = {}) => {
    const receipts = await viaIntent(wconnection, 'tasks/operator-add', args, mode, policy,
      (event) => wevents.push({ type: 'tool:usage', neumaId, ...event }));
    return receipts[0];
  };

  it('a being records on its witness\'s list — real realm disk, riding the WITNESS LIST section', async () => {
    const res = await wcall({ title: 'Physical Evolution qwtl', cadence: 'daily', detail: 'one hour for the vessel', subtasks: ['warm-up', 'push', 'pull'] });
    expect(res.status).toBe('ok');
    expect(res.content).toContain('operator');

    // Real realm disk holds the bundle, plaintext for the witness to read.
    const raw = await fs.readFile(path.join(realmRoot, WALLET, 'tasks.json'), 'utf8');
    expect(raw).toContain('qwtl');
    const { readUserTasks } = await import('../../backend/services/user-tasks.js');
    const plan = await readUserTasks(WALLET);
    const t = plan.tasks.find((x) => x.title.includes('qwtl'));
    expect(t).toMatchObject({ cadence: 'daily', status: 'open' });
    expect(t.subtasks.map((s) => s.title)).toEqual(['warm-up', 'push', 'pull']);

    // LOAD-BEARING: it rides the WITNESS LIST prompt section next turn, and
    // the section teaches the route back (add-only, never settle).
    const section = assemblePromptSections({ witnessPlan: plan }).find((s) => s.id === 'operator');
    expect(section).toBeDefined();
    expect(section.text).toContain('qwtl');
    expect(section.text).toContain('tasks/operator-add'); // the section teaches the intent route (S3b4)

    // The settle frame carries the acting being's neumaId — the desk's seam.
    const frame = wevents.find((e) => e.type === 'tool:usage' && e.status === 'ok' && e.tool === 'intents/tasks.operator-add');
    expect(frame).toBeDefined();
    expect(frame.neumaId).toBe(neumaId);
  });

  it('corrections and the gate speak plainly', async () => {
    expect((await wcall({ title: 'x', cadence: 'hourly' })).status).toBe('error');
    expect((await wcall({ title: 'x', cadence: 'daily', dueDate: '2026-08-01' })).status).toBe('error');
    expect((await wcall({ title: '  ' })).status).toBe('error');
    const denied = await wcall({ title: 'x' }, { policy: { intents: { denied: ['tasks.operator-add'] } } });
    expect(denied.status).toBe('denied');
    // With no operator on the connection the act refuses at execute — the
    // being is told plainly rather than the addition landing nowhere.
    const orphanConn = { companion: { name: 'ghost', neumaId }, _sessionToolPolicy: null };
    const [orphan] = await viaIntent(orphanConn, 'tasks/operator-add', { title: 'x' }, 'auto');
    expect(orphan.status).toBe('error');
    expect(orphan.error).toContain('operator');
  });
});

// tasks/operator-update — the AMEND door to the operator's own list (Founder,
// 2026-09-20). Text and steps are amendable at the being's hand; settling,
// dropping, and re-statusing stay the operator's own acts. REAL sweep, REAL
// policy gate, REAL realm disk (RULE 0) — and the receipt is the store read
// back, which is the whole point: the seat that hit the silent no-op could
// not verify in-loop, so this door's receipt must show what actually landed.
describe('tasks/operator-update — amending the operator\'s list', () => {
  const WALLET = '0x2222222222222222222222222222222222222222';
  let realmRoot, aconnection, aevents, neumaId;
  const aws = { send: (raw) => aevents.push(JSON.parse(raw)) };

  beforeAll(async () => {
    const prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = KEY;

    const realm = await import('../../backend/services/user-realm.js');
    realmRoot = await createTempDir('operator-amend-realm');
    realm.setRealmRoot(realmRoot);

    const root = await createTempDir('operator-amend-ws');
    setWorkspacesRoot(path.join(root, 'workspaces'));
    neumaId = 'test-being-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(neumaId);
    aconnection = { companion: { name: 'Prooflet', neumaId }, walletAddress: WALLET, _sessionToolPolicy: null };
    aevents = [];
    return () => {
      if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
      else process.env.DNA_ENCRYPTION_KEY = prevKey;
    };
  });

  const acall = async (args, { policy = null, mode = 'auto' } = {}) => {
    const receipts = await viaIntent(aconnection, 'tasks/operator-update', args, mode, policy,
      (event) => aevents.push({ type: 'tool:usage', neumaId, ...event }));
    return receipts[0];
  };

  it('amends steps on the operator\'s daily — persisted, check-mark preserved, receipt read back', async () => {
    // Seed through the REAL add door, then mark one step done the way the
    // operator's own desk does (the REST-path service, real disk).
    const seeded = await viaIntent(aconnection, 'tasks/operator-add',
      { title: 'Physical Evolution qamend', cadence: 'daily', subtasks: ['warm-up', 'db floor press', 'walk'] },
      'auto', null, (event) => aevents.push({ type: 'tool:usage', neumaId, ...event }));
    expect(seeded[0].status).toBe('ok');

    const { readUserTasks, updateSubtaskInTask } = await import('../../backend/services/user-tasks.js');
    const plan = await readUserTasks(WALLET);
    const task = plan.tasks.find((t) => t.title.includes('qamend'));
    const walk = task.subtasks.find((s) => s.title === 'walk');
    await updateSubtaskInTask(WALLET, task.id, walk.id, { status: 'done' });

    // THE AMEND: swap an exercise, keep the rest — the exact flow the seat
    // was forced to destroy/rebuild for.
    const res = await acall({ id: task.id.slice(0, 8), subtasks: ['warm-up', 'garden time', 'walk', 'stretch'] });
    expect(res.status).toBe('ok');
    expect(res.content).toMatch(/as stored now/i);

    const stored = (await readUserTasks(WALLET)).tasks.find((t) => t.title.includes('qamend'));
    expect(stored.subtasks.map((s) => s.title)).toEqual(['warm-up', 'garden time', 'walk', 'stretch']);
    // The kept step kept its check through the swap; the new one is open.
    expect(stored.subtasks.find((s) => s.title === 'walk').status).toBe('done');
    expect(stored.subtasks.find((s) => s.title === 'garden time').status).toBe('open');
    // The receipt printed the store, not the intent: the done walk wears its mark.
    expect(res.content).toMatch(/✓ walk/);
    expect(res.content).toMatch(/○ garden time/);

    // The text half amends through the same door, and the old title is gone.
    const retitled = await acall({ id: task.id.slice(0, 8), title: '15 min body + garden time' });
    expect(retitled.status).toBe('ok');
    expect((await readUserTasks(WALLET)).tasks.some((t) => t.title === '15 min body + garden time'))
      .toBe(true);
  });

  it('the one-way law holds at the door: no status, no drop, unknown fields refused loudly', async () => {
    // Settling through the amend door is refused as an UNKNOWN FIELD — the
    // door never carries the operator's verbs.
    const statusAttempt = await acall({ id: 'zzzzzzzz', status: 'done' });
    expect(statusAttempt.status).toBe('error');
    expect(statusAttempt.error).toMatch(/unknown field\(s\) "status"/);

    // The loud-fields law, re-proven after own-ledger subtasks landed (#531):
    // subtasks are LEGAL on tasks/update now — a field nobody advertises
    // still refuses loudly instead of vanishing into a receipt.
    const ownAttempt = await viaIntent(aconnection, 'tasks/update',
      { id: 'whatever', quantum: 'nope' }, 'auto', null,
      (event) => aevents.push({ type: 'tool:usage', neumaId, ...event }));
    expect(ownAttempt[0].status).toBe('error');
    expect(ownAttempt[0].error).toMatch(/unknown field\(s\) "quantum"/);

    expect((await acall({ id: 'zzzzzzzz', title: 'x' })).error).toMatch(/no task with id/);
    expect((await acall({ id: '' })).error).toMatch(/needs the task id/);

    const denied = await acall({ id: 'x', title: 'x' }, { policy: { intents: { denied: ['tasks.operator-update'] } } });
    expect(denied.status).toBe('denied');
  });
});

// vessel_log — the being's add-only route to the human vessel's record.
// REAL handler, REAL policy gate, REAL realm disk (RULE 0).
describe('vessel_log — the being logging operator-reported measurements', () => {
  const WALLET = '0x1111111111111111111111111111111111111111';
  let realmRoot, vconnection, vevents, neumaId;
  const vws = { send: (raw) => vevents.push(JSON.parse(raw)) };

  beforeAll(async () => {
    const prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = KEY;

    const realm = await import('../../backend/services/user-realm.js');
    realmRoot = await createTempDir('vessel-log-realm');
    realm.setRealmRoot(realmRoot);

    const root = await createTempDir('vessel-log-ws');
    setWorkspacesRoot(path.join(root, 'workspaces'));
    neumaId = 'test-being-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(neumaId);
    vconnection = { companion: { name: 'Prooflet', neumaId }, walletAddress: WALLET, _sessionToolPolicy: null };
    vevents = [];
    return () => {
      if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
      else process.env.DNA_ENCRYPTION_KEY = prevKey;
    };
  });

  const vcall = (args, { policy = null, mode = 'auto' } = {}) =>
    _handleVesselLogTool(vws, vconnection, policy, mode, { toolName: 'vessel_log' }, args);

  it('a being logs a reported PR — real realm disk, riding the OPERATOR VESSEL section', async () => {
    const res = await vcall({ kind: 'pr', lift: 'Bench Press', weight: 80, reps: 8, unit: 'kg' });
    expect(res.status).toBe('ok');
    expect(res.content).toContain('bench press 80 kg × 8');

    const raw = await fs.readFile(path.join(realmRoot, WALLET, 'vitals.jsonl'), 'utf8');
    expect(raw).toContain('bench press');
    const { readVitals } = await import('../../backend/services/user-vitals.js');
    const entries = await readVitals(WALLET);
    expect(entries[0]).toMatchObject({ kind: 'pr', lift: 'bench press', weight: 80, reps: 8, unit: 'kg' });

    // LOAD-BEARING: the record rides the WITNESS VESSEL prompt section next
    // turn — and vanishes when the log is empty.
    const section = assemblePromptSections({ vitals: entries }).find((s) => s.id === 'vitals');
    expect(section).toBeDefined();
    expect(section.label).toBe('OPERATOR VESSEL');
    expect(section.text).toContain('bench press 80 kg × 8');
    expect(assemblePromptSections({ vitals: null }).find((s) => s.id === 'vitals')).toBeUndefined();

    // The tool frame carries the acting being's neumaId — the desk's seam.
    const frame = vevents.find((e) => e.type === 'tool:usage' && e.status === 'ok' && e.tool === 'tasks/vessel_log');
    expect(frame).toBeDefined();
    expect(frame.neumaId).toBe(neumaId);
  });

  it('sessions, bodyweight, and markers log too; corrections and the gate hold', async () => {
    expect((await vcall({ kind: 'session', title: 'Push day', durationMin: 60 })).status).toBe('ok');
    expect((await vcall({ kind: 'bodyweight', weight: 82.5, unit: 'kg' })).status).toBe('ok');
    expect((await vcall({ kind: 'life', marker: 'sunlight' })).status).toBe('ok');

    expect((await vcall({ kind: 'vibe' })).status).toBe('error');
    expect((await vcall({ kind: 'pr', lift: 'squat', weight: 100, unit: 'stone' })).status).toBe('error');
    const denied = await vcall({ kind: 'session', title: 'x' }, { policy: { tasks: { denied: ['vessel_log'] } } });
    expect(denied.status).toBe('denied');
    const orphan = await _handleVesselLogTool(vws, { companion: null }, null, 'auto', { toolName: 'vessel_log' }, { kind: 'session', title: 'x' });
    expect(orphan.status).toBe('error');
    expect(orphan.error).toContain('operator');
  });
});
