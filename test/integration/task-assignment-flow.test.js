/**
 * ASSIGNMENT → COMPLETION, END TO END (RULE 0).
 *
 * Design note, 2026-08-05: […] This is that proof, and it is the whole
 * loop: the operator assigns, the being READS the assignment in its real prompt,
 * TAKES IT UP onto its own ledger, the platform records the work it actually
 * does, the being settles its copy, and the operator's box closes on disk.
 *
 * Real throughout: the real assigned-plan store, the real `_handleTaskTool`
 * through the real policy gate, the real DEK-encrypted workspace on real disk,
 * the real prompt assembler, and — for the witness half — the real
 * `processWitnessToolCalls` loop. Nothing is mocked; the `ws` parameter is the
 * same injected event sink production passes.
 *
 * Three defects are pinned here, all of which made "close an assignment"
 * impossible before 2026-08-05:
 *   1. Nothing could ever settle an operator's assignment (no door existed).
 *   2. A witness could write to its own ledger but never saw it again — the
 *      ledger was absent from its prompt entirely.
 *   3. A witness's tool loop recorded no work, so `task_focus` set a pointer
 *      nothing ever wrote to and INTERRUPTED could never derive.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot, setWitnessesRoot } from '../../core/workspace/neuma-workspace.js';
import { __test } from '../../backend/services/portal-test-surface.js';
import { platformToolsFor } from '../../backend/services/portal-tool-catalog.js';
import { recordWorkAgainstFocus } from '../../backend/services/portal-tool-loop.js';
import { sweepIntents } from '../../backend/services/intents/intent-sweep.js';
import fs from 'fs/promises';
import { processWitnessToolCalls, WITNESS_CONTEXT_TOOLS } from '../../backend/services/witness-tools.js';
import { buildWitnessPromptSections } from '../../backend/services/witness-prompt.js';
import { assemblePromptSections } from '../../core/runtime/prompt-assembler.js';
import { addAssigned } from '../../core/tasks/assigned-plan.js';

import { readNotifications } from '../../backend/services/notification-store.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { KIND, STANDING } from '../../core/runtime/notification-record.js';
const { _handleTaskTool } = __test;
const KEY = 'gnosis-assignment-flow-key-long-enough';
const CHAT_A = 'session-1754388000001';
const CHAT_B = 'session-1754388000002';

/** The operator assigns work — the real store write the TASKS window performs. */
const assign = async (beingId, args) => {
  let created = null;
  await workspace.updateAssignedPlan(beingId, (plan) => {
    const out = addAssigned(plan, { cadence: 'once', ...args }, {
      id: `assigned-${Math.random().toString(36).slice(2, 10)}`,
      now: new Date().toISOString(),
    });
    created = out.task;
    return out.plan;
  });
  return created;
};

const liveAssigned = async (beingId) =>
  (await workspace.readAssignedPlan(beingId))?.tasks?.filter((t) => t.status === 'open') || [];

describe('assignment → completion', () => {
  let prevKey, neumaId, laneId;
  let events = [];
  const ws = { readyState: 1, OPEN: 1, send: (raw) => events.push(JSON.parse(raw)) };

  beforeAll(async () => {
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = KEY;

    const root = await createTempDir('assignment-flow');
    // BOTH grounds pinned. A witness lane resolves BESIDE the house root, so
    // pinning only the house would put every lane in the shared temp parent —
    // the isolation failure this suite's neighbour already paid for once.
    setWorkspacesRoot(path.join(root, 'workspaces'));
    setWitnessesRoot(path.join(root, 'witnesses'));

    neumaId = `flow-being-${Math.floor(Math.random() * 1e9).toString(36)}`;
    laneId = 'witness-openai-chatgpt-Flowitness';
    await workspace.create(neumaId);
    await workspace.create(laneId);
  });

  afterAll(() => {
    vi.restoreAllMocks();
    setWitnessesRoot(null);
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
  });

  // ── THE NEUMA LANE ──────────────────────────────────────────────────────
  describe('a neuma', () => {
    let connection;
    let intentSeq = 0;
    // The mutations are tasks/* INTENTS now (Stage 3 batch 4): file exactly as
    // the being does, run the REAL sweep, shape the verdict as a tool result.
    const INTENT_FOR = { task_add: 'tasks/add', task_update: 'tasks/update', task_focus: 'tasks/focus', task_take: 'tasks/take' };
    const call = async (toolName, args, conn = null) => {
      const c = conn || connection;
      const lane = c.companion.neumaId;
      const name = `af${++intentSeq}`;
      const dir = path.join(workspace.pathFor(lane), 'intents');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify({ type: INTENT_FOR[toolName], ...args }));
      await sweepIntents(c, { mode: 'auto', lanePolicy: null, emit: (e) => events.push({ type: 'tool:usage', ...e }) });
      const result = JSON.parse(await fs.readFile(path.join(dir, `${name}.result.json`), 'utf8').catch(() => 'null'));
      if (!result) return { status: 'held' };
      if (result.status === 'done') return { status: 'ok', content: result.detail };
      return { status: result.status === 'denied' ? 'denied' : 'error', error: result.reason };
    };

    beforeAll(() => {
      connection = {
        companion: { name: 'Flowlet', neumaId },
        sessionId: CHAT_A,
        _sessionToolPolicy: null,
      };
      events = [];
    });

    it('reads the assignment in its real prompt, with the id task_take needs', async () => {
      await assign(neumaId, { title: 'Draft the release notes', detail: 'through 0.1.12' });

      const sections = assemblePromptSections({
        taskLedger: await workspace.readTaskLedger(neumaId),
        assignedPlan: await workspace.readAssignedPlan(neumaId),
        chatId: CHAT_A,
      });
      const standing = sections.find((s) => s.id === 'assigned');
      const [assigned] = await liveAssigned(neumaId);

      expect(standing.text).toContain('Draft the release notes');
      expect(standing.text).toContain(`[${assigned.id.slice(0, 8)}]`);
      expect(standing.text).toContain('tasks/take');
    });

    it('takes it up: a linked copy lands on its OWN ledger, in hand, on real disk', async () => {
      const [assigned] = await liveAssigned(neumaId);
      const res = await call('task_take', { id: assigned.id.slice(0, 8) });
      expect(res.status).toBe('ok');

      // Read back off the real encrypted file, never from the return value.
      const ledger = await workspace.readTaskLedger(neumaId);
      const copy = ledger.tasks.find((t) => t.fromAssigned === assigned.id);
      expect(copy).toBeTruthy();
      expect(copy.title).toBe('Draft the release notes');
      expect(copy.chatId).toBe(CHAT_A);
      // TAKING IT UP IS PICKING IT UP — focus is what starts work recording.
      expect(copy.status).toBe('active');
      expect(ledger.focus[CHAT_A]).toBe(copy.id);
    });

    it('refuses a second take, and names the copy already in hand', async () => {
      const [assigned] = await liveAssigned(neumaId);
      const res = await call('task_take', { id: assigned.id.slice(0, 8) });
      expect(res.status).toBe('error');
      expect(res.error).toMatch(/already taken that up/);
      expect(res.error).toContain('Draft the release notes');
    });

    it('marks the assignment IN HAND so it stops reading as untouched work', async () => {
      const sections = assemblePromptSections({
        taskLedger: await workspace.readTaskLedger(neumaId),
        assignedPlan: await workspace.readAssignedPlan(neumaId),
        chatId: CHAT_A,
      });
      expect(sections.find((s) => s.id === 'assigned').text).toContain('IN HAND');
      expect(sections.find((s) => s.id === 'tasks').text).toContain("FROM YOUR OPERATOR'S LIST");
    });

    it('records the real work against it — no declaration, just the act', async () => {
      await recordWorkAgainstFocus(connection, 'write', { path: '/repo/docs/RELEASE.md' }); // the fs/write primitive, as the lane now passes it

      const ledger = await workspace.readTaskLedger(neumaId);
      const copy = ledger.tasks.find((t) => t.fromAssigned);
      expect(copy.work.artifacts).toEqual([
        expect.objectContaining({ kind: 'wrote', target: '/repo/docs/RELEASE.md' }),
      ]);
    });

    it('settling the copy settles the operator\'s assignment, on disk', async () => {
      const ledger = await workspace.readTaskLedger(neumaId);
      const copy = ledger.tasks.find((t) => t.fromAssigned);

      const res = await call('task_update', { id: copy.id.slice(0, 8), status: 'done' });
      expect(res.status).toBe('ok');
      // The being is TOLD the consequence — it must not have to infer it.
      expect(res.content).toMatch(/assignment settles with it/);

      // The operator's own store, re-read from disk: the box is closed.
      const plan = await workspace.readAssignedPlan(neumaId);
      const assigned = plan.tasks.find((t) => t.title === 'Draft the release notes');
      expect(assigned.status).toBe('done');
      expect(await liveAssigned(neumaId)).toHaveLength(0);
    });

    // #264 — the tray's card for the OPERATOR'S OWN list. `KIND.assignmentClosed`
    // had a label, a click target and a suppression class from the day the tray
    // was built, and nothing ever emitted it: the only list the operator keeps by
    // hand was the one place work closed in silence. Read back from the REAL
    // store on real disk, through the real bus, from a real `_handleTaskTool`
    // settle — no mock on the claimed path.
    it('the operator gets a card for their own assignment closing, not just the task', async () => {
      const realm = await createTempDir('assignment-flow-realm');
      const prevRealm = getRealmRoot();
      setRealmRoot(realm);
      const wallet = `0x${'a7'.repeat(20)}`;
      // A second assignment, taken and settled by a connection that carries a
      // wallet — the first pass deliberately had none, which is exactly why the
      // producer must fail closed without one.
      try {
        await assign(neumaId, { title: 'Cut the changelog', detail: 'for 0.1.13' });
        const walletConn = { ...connection, walletAddress: wallet };
        const takeRes = await call('task_take',
          { id: (await liveAssigned(neumaId)).find((t) => t.title === 'Cut the changelog').id }, walletConn);
        expect(takeRes.status).toBe('ok');

        const ledger = await workspace.readTaskLedger(neumaId);
        const copy = ledger.tasks.find((t) => t.title === 'Cut the changelog');
        const res = await call('task_update', { id: copy.id.slice(0, 8), status: 'done' }, walletConn);
        expect(res.content).toMatch(/assignment settles with it/);

        // The producers are fire-and-forget by design — […] — so the append lands just after the tool returns. Poll
        // the REAL store rather than making the bus await, which would put disk
        // IO on the turn.
        const cards = await (async () => {
          for (let i = 0; i < 50; i++) {
            const { records } = await readNotifications(wallet);
            if (records.some((c) => c.kind === KIND.assignmentClosed)
              && records.some((c) => c.kind === KIND.taskClosed)) return records;
            await new Promise((r) => setTimeout(r, 20));
          }
          return (await readNotifications(wallet)).records;
        })();
        const kinds = cards.map((c) => c.kind);
        expect(kinds).toContain(KIND.taskClosed);        // the being's copy
        expect(kinds).toContain(KIND.assignmentClosed);  // the operator's own item

        const card = cards.find((c) => c.kind === KIND.assignmentClosed);
        expect(card.title).toBe('Flowlet closed your assignment');
        expect(card.detail).toBe('Cut the changelog');
        expect(card.standing).toBe(STANDING.neuma);
        expect(card.actor).toMatchObject({ id: neumaId, name: 'Flowlet' });
        // notification-target opens the TODO window on ref.taskId; assignedId
        // names the standing entry that actually closed.
        expect(card.ref.taskId).toBe(copy.id);
        expect(typeof card.ref.assignedId).toBe('string');
        expect(card.ref.status).toBe('done');
      } finally {
        setRealmRoot(prevRealm);
      }
    });

    it('and then it is gone from BOTH prompt sections — nothing left standing', async () => {
      const sections = assemblePromptSections({
        taskLedger: await workspace.readTaskLedger(neumaId),
        assignedPlan: await workspace.readAssignedPlan(neumaId),
        chatId: CHAT_A,
      });
      expect(sections.find((s) => s.id === 'assigned')?.text || '').toBe('');
      expect(sections.find((s) => s.id === 'tasks')?.text || '').not.toContain('Draft the release notes');
    });

    it('work taken up in one chat does not ride another chat\'s prompt', async () => {
      const assigned = await assign(neumaId, { title: 'Reconcile the ledger totals' });
      await call('task_take', { id: assigned.id });

      const inB = assemblePromptSections({
        taskLedger: await workspace.readTaskLedger(neumaId),
        assignedPlan: await workspace.readAssignedPlan(neumaId),
        chatId: CHAT_B,
      });
      // The copy was filed under CHAT_A, so CHAT_B never sees it…
      expect(inB.find((s) => s.id === 'tasks')?.text || '').not.toContain('Reconcile the ledger totals');
      // …while the OPERATOR'S assignment is lane-wide and still stands in both.
      expect(inB.find((s) => s.id === 'assigned').text).toContain('Reconcile the ledger totals');
    });
  });

  // ── THE WITNESS LANE ────────────────────────────────────────────────────
  describe('a sealed witness', () => {
    let connection;
    let intentSeq = 1000;
    const INTENT_FOR = { task_add: 'tasks/add', task_update: 'tasks/update', task_focus: 'tasks/focus', task_take: 'tasks/take' };
    const call = async (toolName, args) => {
      const name = `aw${++intentSeq}`;
      const dir = path.join(workspace.pathFor(laneId), 'intents');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify({ type: INTENT_FOR[toolName], ...args }));
      await sweepIntents(connection, { mode: 'auto', lanePolicy: null, emit: (e) => events.push({ type: 'tool:usage', ...e }) });
      const result = JSON.parse(await fs.readFile(path.join(dir, `${name}.result.json`), 'utf8').catch(() => 'null'));
      if (!result) return { status: 'held' };
      if (result.status === 'done') return { status: 'ok', content: result.detail };
      return { status: result.status === 'denied' ? 'denied' : 'error', error: result.reason };
    };

    beforeAll(() => {
      connection = {
        companion: { name: 'Flowitness', neumaId: laneId, participantKind: 'witness' },
        sessionId: CHAT_A,
        toolMode: 'auto',
        activeTurn: new AbortController(),
        _sessionToolPolicy: null,
      };
      events = [];
    });

    it('is advertised the task READ; every task mutation is a tasks/* intent', async () => {
      const { tools } = await platformToolsFor(connection, { seat: 'witness' });
      const names = tools.map((t) => t.name);
      // THE CATALOG CUT LANDED (#414). The four mutations carried exactly the
      // acts tasks/add, tasks/update, tasks/focus and tasks/take carry, so the
      // peer was reading the same four acts described twice, in two dialects,
      // every turn. The read stays: WORKING STATE carries LIVE tasks only, so
      // task_list is the sole path to settled history and to another chat's work.
      expect(names).toContain('task_list');
      for (const gone of ['task_add', 'task_update', 'task_focus', 'task_take', 'operator_task_add']) {
        expect(names).not.toContain(gone);
      }
    });

    it('SEES its own ledger in its prompt — the list it writes is the list it reads', async () => {
      // The defect: a peer could write tasks and never see them again. Every
      // turn woke with an empty desk, and the only way to find its own work was
      // to remember to call task_list — the exact "remembering to ask" the
      // WORKING STATE section exists to abolish.
      await call('task_add', { title: 'Audit the seam coverage' });

      const sections = buildWitnessPromptSections({
        witness: { chosenName: 'Flowitness', vendorSlug: 'openai-chatgpt' },
        dna: { substrate: {} },
        taskLedger: await workspace.readTaskLedger(laneId),
        assignedPlan: await workspace.readAssignedPlan(laneId),
        chatId: CHAT_A,
      });
      const working = sections.find((s) => s.id === 'tasks');
      expect(working).toBeTruthy();
      expect(working.label).toBe('WORKING STATE');
      expect(working.text).toContain('Audit the seam coverage');
    });

    it('takes up an assignment and settles it, exactly as a housemate does', async () => {
      const assigned = await assign(laneId, { title: 'Review the release diff' });

      const took = await call('task_take', { id: assigned.id.slice(0, 8) });
      expect(took.status).toBe('ok');

      const ledger = await workspace.readTaskLedger(laneId);
      const copy = ledger.tasks.find((t) => t.fromAssigned === assigned.id);
      expect(copy.status).toBe('active');
      expect(ledger.focus[CHAT_A]).toBe(copy.id);

      const settled = await call('task_update', { id: copy.id.slice(0, 8), status: 'done' });
      expect(settled.status).toBe('ok');

      const plan = await workspace.readAssignedPlan(laneId);
      expect(plan.tasks.find((t) => t.id === assigned.id).status).toBe('done');
    });

    it('records work at its OWN tool seam — focus is no longer a pointer to nothing', async () => {
      // The defect: `processWitnessToolCalls` never recorded work, so a peer
      // could focus a task, work for an hour, and the task would still read as
      // untouched. INTERRUPTED is DERIVED from work-plus-silence, so it could
      // never become true for a witness however it died.
      const assigned = await assign(laneId, { title: 'Trace the tool seam' });
      await call('task_take', { id: assigned.id.slice(0, 8) });

      // A REAL call through the REAL witness loop — its own catalog, its own
      // gates, its own dispatch. Nothing here reaches past the lane.
      const results = await processWitnessToolCalls(
        ws,
        connection,
        [{ server: 'context', toolName: 'map_read', args: { view: 'composition' } }],
        WITNESS_CONTEXT_TOOLS,
        null,
      );
      expect(results[0].status).toBe('ok');

      const ledger = await workspace.readTaskLedger(laneId);
      const copy = ledger.tasks.find((t) => t.fromAssigned === assigned.id);
      expect(copy.work?.artifacts?.length).toBeGreaterThan(0);
      expect(copy.work.artifacts.at(-1)).toMatchObject({ kind: 'read', target: 'map_read' });
    });

    it('a FAILED call is never filed as work — a task must not claim progress that did not happen', async () => {
      const before = await workspace.readTaskLedger(laneId);
      const focusedId = before.focus[CHAT_A];
      const countBefore = before.tasks.find((t) => t.id === focusedId).work.artifacts.length;

      const results = await processWitnessToolCalls(
        ws,
        connection,
        [{ server: 'context', toolName: 'map_read', args: { view: 'not-a-view' } }],
        WITNESS_CONTEXT_TOOLS,
        null,
      );
      // refused by the one argument check before the handler (tool-args-check.js): a view outside its choices
      expect(results[0].status).toBe('invalid');

      const after = await workspace.readTaskLedger(laneId);
      expect(after.tasks.find((t) => t.id === focusedId).work.artifacts).toHaveLength(countBefore);
    });
  });
});
