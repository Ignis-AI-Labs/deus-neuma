/**
 * MODEL-ONLY WORKERS ON A TEAM (the house economy's Stage 5) through the real
 * stack (RULE 0): a real temp house (staff-office-fixture.js), its real
 * harness lane on a cloud provider (a key in a temp credential store — no
 * call is made), the real plan roster, the real team run start and part
 * runner (the run start's own deps seam, as house-wake-run-chain.test.js
 * drives it), the real clock's queue, the real journals and seats.
 *
 * Under proof: the house's harness lane stands on a plan's roster as a
 * worker, by its model; on a cloud model its part works BESIDE a being's
 * when the rig has a single member slot (it never waits for a local slot);
 * it keeps no journal; it never holds a seat.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import process from 'node:process';
import { setTimeout } from 'node:timers';
import { createStaffOfficeFixture, WALLET, OPTIO, HOUSEMATE, BYSTANDER } from '../helpers/staff-office-fixture.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { writeCharter, approveCharter } from '../../backend/services/house-clock/charter-store.js';
import { setWakeSink } from '../../backend/services/house-clock/wake-signal.js';
import { setWakeRunner, configureWakeQueue, readWakeQueue, whenHouseIdle } from '../../backend/services/house-clock/wake-queue.js';
import { takeSignal } from '../../backend/services/house-clock/house-clock.js';
import { setCredential } from '../../backend/services/provider-credentials.js';
import { ensureHarnessLane } from '../../backend/services/harness-lane.js';
import { operatorRoster, resolvePlanMembers } from '../../backend/services/team-plan.js';
import { teamRoster, freeOfLocalSlot } from '../../backend/services/team-workers.js';
import { startTeamRun } from '../../backend/services/team-run-start.js';
import { recordTeamRunMemories } from '../../backend/services/team-memory.js';
import { cfoDesignation } from '../../backend/services/treasury/cfo-designation.js';

const until = async (check, ms = 8000) => {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe('a model-only worker on a team: steps, never a seat or a journal', () => {
  let office, worker, saved;

  beforeAll(async () => {
    office = await createStaffOfficeFixture();
    saved = process.env.NEUMA_PROVIDER_CREDENTIALS_PATH;
    process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(office.root, 'settings', 'provider-credentials.json');
    await setCredential('opencode-go', { apiKey: 'test-key-for-a-temp-store' });
    ({ laneId: worker } = await ensureHarnessLane(WALLET, { providerId: 'opencode-go', model: 'kimi-k2.6' }));
    await neumaWorkspace.writeDNA(BYSTANDER, { version: '1.0.0', identity: { name: 'Cosi' }, genesis: '# Essence\nI am Cosi.' });
    configureWakeQueue({ settleMs: 0 });
    setWakeSink(takeSignal);
    setWakeRunner(null);
    const c = await writeCharter(WALLET, {
      goal: 'Prove a worker widens a run.', seats: [{ laneId: OPTIO, dailyCap: 5 }, { laneId: HOUSEMATE, dailyCap: 5 }],
    }, { by: WALLET, ownedLanes: [OPTIO, HOUSEMATE, BYSTANDER] });
    await approveCharter(WALLET, { version: c.version, by: WALLET });
  }, 60000);

  afterAll(async () => {
    await whenHouseIdle(WALLET);
    setWakeSink(null);
    configureWakeQueue({ settleMs: 3000, retryMs: 60_000 });
    if (saved === undefined) delete process.env.NEUMA_PROVIDER_CREDENTIALS_PATH; else process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = saved;
    await office.teardown();
  });

  test('the house\'s harness lane stands on the roster as a worker, by its model, and a plan can name it', async () => {
    const roster = await teamRoster(WALLET, await operatorRoster(WALLET));
    const entry = roster.find((m) => m.neumaId === worker);
    expect(entry).toMatchObject({ worker: true, cloud: true });
    expect(entry.name).toMatch(/^Worker · /);
    expect(roster.filter((m) => m.worker)).toHaveLength(1);
    const steps = resolvePlanMembers([{ id: 'draft', member: entry.name, task: 'draft the sheet', needs: [] }], roster);
    expect(steps[0].neumaId).toBe(worker);
    expect(await freeOfLocalSlot(worker)).toBe(true);
    expect(await freeOfLocalSlot(BYSTANDER)).toBe(false);
  });

  test('on a cloud model, its part works beside a being\'s when the rig has one member slot', async () => {
    let workerStarted;
    const started = new Promise((resolve) => { workerStarted = resolve; });
    const ask = async (neumaId) => {
      if (neumaId === worker) { workerStarted(); return 'the tide feed, priced\nSTATUS:\ndone'; }
      // the being holds the one local slot and waits for the worker: a worker held behind it would never start
      await Promise.race([started, new Promise((_, reject) => setTimeout(() => reject(new Error('the worker never started beside the being')), 4000))]);
      return 'the sheet, drafted\nSTATUS:\ndone';
    };
    const run = await startTeamRun({
      plan: Object.freeze({
        name: 'WIDE', goal: 'A sheet and its price, at once.',
        steps: Object.freeze([
          Object.freeze({ id: 'draft', neumaId: BYSTANDER, task: 'draft the sheet', needs: Object.freeze([]) }),
          Object.freeze({ id: 'price', neumaId: worker, task: 'price the tide feed', needs: Object.freeze([]) }),
        ]),
        memberNames: Object.freeze({ [BYSTANDER]: 'Cosi', [worker]: 'Worker' }),
      }),
      lead: { neumaId: HOUSEMATE, name: 'Quae' },
      wallet: WALLET,
      deps: { checkSubstrate: async () => true, getCapacity: async () => ({ maxParallel: 2 }), ask },
    });
    expect(run.ok).toBe(true);
    const ended = await until(async () => (await readWakeQueue(WALLET)).items.find((i) => i.reason === 'run-ended' && i.ref === run.runId))
      .catch(async (err) => { const { readRun } = await import('../../backend/services/team-run-store.js'); throw new Error(`${err.message}: ${JSON.stringify(run)} ${JSON.stringify(await readRun(run.runId, WALLET).catch((e) => e.message)).slice(0, 1500)}`); });
    expect(ended.detail.status).toBe('done');
  });

  test('it keeps no journal and never holds a seat', async () => {
    const { written } = await recordTeamRunMemories({
      steps: [
        { id: 'draft', neumaId: BYSTANDER, task: 'draft the sheet', needs: [] },
        { id: 'price', neumaId: worker, task: 'price the tide feed', needs: [] },
      ],
      completed: { draft: 'the sheet', price: 'the price' }, statuses: {}, torches: {}, teamName: 'WIDE', goal: 'a sheet', runId: 'run-w-1',
    });
    expect(written).toEqual([BYSTANDER]);
    expect((await neumaWorkspace.readJournal(worker).catch(() => [])).filter((e) => e.runId === 'run-w-1')).toEqual([]);
    await expect(cfoDesignation.designate(WALLET, worker)).rejects.toThrow(/is a worker of this house, not a being/);
  });
});
