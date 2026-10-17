/**
 * PLAN OF RECORD, at rest and back — the durable half proven on the REAL
 * stack (RULE 0): real temp workspace root, real DEK-encrypted files on real
 * disk, the real persist/rehydrate brokers, and the real prompt assembler
 * reading the record back. No mock anywhere on the claimed path.
 *
 * The contract under proof: an approval becomes a fact that survives the
 * connection — plan.json persists encrypted, the LEAD's own steps land on
 * its real ledger, a fresh connection rehydrates the plan of record, and
 * the assembled prompt states the approval so the being never re-asks.
 */
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { persistApprovedPlan, rehydrateApprovedPlan } from '../../backend/services/team-plan.js';
import { assemblePromptSections } from '../../core/runtime/prompt-assembler.js';

const WALLET = '0x3333333333333333333333333333333333333333';

// The engine-shaped plan submitPlan resolves with (members already neumaIds).
const ENGINE_PLAN = Object.freeze({
  name: 'INTEGRITY BOUNDARY',
  goal: 'Silo the benchmarks repository and prove the floor test.',
  steps: [
    { id: 'audit', neumaId: 'cael', task: 'Map every file in the repository.', done: 'A directory tree with every file accounted for.', needs: [] },
    { id: 'silo', neumaId: 'cael', task: 'Move the files into isolated silos.', needs: ['audit'] },
  ],
});
const ROSTER = [{ neumaId: 'cael', name: 'Cael' }];

describe('plan record flow (real encrypted disk + real prompt assembly, gnosis)', () => {
  let house, origRoot;

  beforeAll(async () => {
    house = await createTempDir('plan-record-house');
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    await workspace.create('cael');
    await workspace.writeDNA('cael', { identity: { name: 'Cael' } });
    await fs.writeFile(path.join(house, 'cael', 'owner.json'), JSON.stringify({ wallet: WALLET }));
  }, 60000);

  afterAll(async () => {
    vi.restoreAllMocks();
    setWorkspacesRoot(origRoot);
    await fs.rm(house, { recursive: true, force: true });
  });

  test('no record stands for a fresh being — and rehydrate honestly answers null', async () => {
    expect(await workspace.readPlanRecord('cael')).toBeNull();
    const connection = { companion: { neumaId: 'cael' } };
    expect(await rehydrateApprovedPlan(connection)).toBeNull();
    expect(connection._approvedPlan).toBeUndefined();
  });

  test('persistApprovedPlan: the approval lands on real disk — record, ledger tasks, and the note', async () => {
    const connection = { companion: { neumaId: 'cael' }, sessionId: 'session-777' };
    const { record, note } = await persistApprovedPlan(connection, ENGINE_PLAN, ROSTER);

    expect(note).toContain('2 steps');
    expect(record.chatId).toBe('session-777');
    expect(Object.keys(record.taskIds)).toEqual(['audit', 'silo']);

    // The record, read back through the encrypted store.
    const stored = await workspace.readPlanRecord('cael');
    expect(stored.goal).toBe(ENGINE_PLAN.goal);
    expect(stored.approvedAt).toBe(record.approvedAt);
    expect(stored.memberNames).toEqual({ cael: 'Cael' });

    // The tasks were FORMED at approval: both steps on the real ledger, the
    // dependency mapped into a real blocker.
    const ledger = await workspace.readTaskLedger('cael');
    const audit = ledger.tasks.find((t) => t.id === record.taskIds.audit);
    const silo = ledger.tasks.find((t) => t.id === record.taskIds.silo);
    expect(audit.title).toBe('Map every file in the repository.');
    expect(audit.chatId).toBe('session-777');
    expect(silo.blockedBy).toEqual([record.taskIds.audit]);

    // Sovereign at rest: the raw bytes on disk never carry the plan in the
    // clear (the same law every tasks/ file obeys).
    const raw = await fs.readFile(path.join(house, 'cael', 'tasks', 'plan.json'), 'utf8');
    expect(raw).not.toContain('Silo the benchmarks');
    expect(raw).not.toContain('INTEGRITY BOUNDARY');
  }, 30000);

  test('a fresh connection rehydrates the standing plan of record', async () => {
    const connection = { companion: { neumaId: 'cael' } };
    const plan = await rehydrateApprovedPlan(connection);
    expect(plan).toBe(connection._approvedPlan);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(plan.goal).toBe(ENGINE_PLAN.goal);
    expect(plan.steps.map((s) => s.id)).toEqual(['audit', 'silo']);
    expect(plan.memberNames.cael).toBe('Cael');
    expect(plan.approvedAt).toBeTruthy();
  });

  test('the assembled prompt states the approval — in the plan\'s chat, never in another', async () => {
    const record = await workspace.readPlanRecord('cael');
    const inChat = assemblePromptSections({
      dna: { identity: { name: 'Cael' } },
      planRecord: record,
      chatId: 'session-777',
      now: new Date('2026-08-16T00:00:00+07:00'),
    });
    const section = inChat.find((s) => s.id === 'plan');
    expect(section.label).toBe('PLAN OF RECORD');
    expect(section.text).toContain('APPROVED');
    expect(section.text).toContain('never re-propose');
    expect(section.text).toContain('YOURS, on your ledger as');

    const otherChat = assemblePromptSections({
      dna: { identity: { name: 'Cael' } },
      planRecord: record,
      chatId: 'session-001',
      now: new Date('2026-08-16T00:00:00+07:00'),
    });
    expect(otherChat.find((s) => s.id === 'plan')).toBeUndefined();
  });

  // #413 — the approval used to read the ledger, materialize its steps, and
  // write the result back with no lock held. Any ledger write that committed
  // inside that window was overwritten by the approval's stale snapshot, and
  // nothing anywhere said so: the being simply found a task it had just filed
  // was gone.
  //
  // The interleaving here is deterministic, not hopeful. The competing write
  // takes the ledger lock FIRST and holds it across an await, so an
  // unsynchronized approval is guaranteed to read the ledger as it stood
  // before that task existed. Under the lock both survive; without it, one of
  // them always loses.
  test('a ledger write mid-approval is not swallowed — both survive the lock (#413)', async () => {
    await workspace.create('galen');
    await workspace.writeDNA('galen', { identity: { name: 'Galen' } });
    await fs.writeFile(path.join(house, 'galen', 'owner.json'), JSON.stringify({ wallet: WALLET }));
    const { addTask } = await import('../../core/tasks/task-ledger.js');

    const competing = workspace.updateTaskLedger('galen', async (ledger) => {
      // held across the await — the approval cannot slip a read in unlocked
      await new Promise((resolve) => setTimeout(resolve, 120));
      return addTask(ledger, { title: 'filed while the plan was landing' }, {
        id: 'rival-1', now: new Date().toISOString(),
      }).ledger;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    // the steps must be GALEN's own, or nothing materializes onto its ledger
    // and the race would have nothing to lose
    const galenPlan = {
      ...ENGINE_PLAN,
      steps: ENGINE_PLAN.steps.map((s) => ({ ...s, neumaId: 'galen' })),
    };
    const approval = persistApprovedPlan(
      { companion: { neumaId: 'galen' }, sessionId: 'session-race' },
      galenPlan,
      [{ neumaId: 'galen', name: 'Galen' }],
    );
    const [, { record }] = await Promise.all([competing, approval]);

    const ledger = await workspace.readTaskLedger('galen');
    const titles = ledger.tasks.map((t) => t.title);
    expect(titles).toContain('filed while the plan was landing');
    expect(titles).toContain('Map every file in the repository.');
    expect(Object.keys(record.taskIds)).toEqual(['audit', 'silo']);
  }, 30000);

  test('a full ledger cannot sink the approval — the record still lands, the note says why', async () => {
    // Fill the ledger to the cap through the real store.
    const { addTask, TASK_MAX_LIVE } = await import('../../core/tasks/task-ledger.js');
    let ledger = await workspace.readTaskLedger('cael');
    let n = 0;
    while (ledger.tasks.filter((t) => ['open', 'active'].includes(t.status)).length < TASK_MAX_LIVE) {
      ({ ledger } = addTask(ledger, { title: `filler ${n += 1}` }, { id: `filler-${n}`, now: new Date().toISOString() }));
    }
    await workspace.writeTaskLedger('cael', ledger);

    const connection = { companion: { neumaId: 'cael' }, sessionId: 'session-888' };
    const { record, note } = await persistApprovedPlan(connection, ENGINE_PLAN, ROSTER);
    expect(note).toContain('could not be copied');
    expect(record.taskIds).toEqual({});
    // The durable record still superseded the old one.
    const stored = await workspace.readPlanRecord('cael');
    expect(stored.chatId).toBe('session-888');
  }, 30000);
});
