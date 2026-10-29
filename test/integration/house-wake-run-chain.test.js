/**
 * A TEAM RUN LEAVES ITS FILING WAKE'S CHAIN (RULE 0) — the real queue on a
 * real temp house, the clock's own signal sink, the real run start and the
 * real watch. A run filed (or a watch re-armed) inside a wake used to carry
 * that wake's chain depth through every await: a run started six wakes deep
 * signalled its end seven deep, past the chain's limit, and the lead's wake
 * was dropped without a word. Work that ends hours later is new work.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createStaffOfficeFixture, WALLET, OPTIO, HOUSEMATE, BYSTANDER } from '../helpers/staff-office-fixture.js';
import { writeCharter, approveCharter } from '../../backend/services/house-clock/charter-store.js';
import { setWakeSink, runInWake } from '../../backend/services/house-clock/wake-signal.js';
import { setWakeRunner, configureWakeQueue, readWakeQueue, whenHouseIdle } from '../../backend/services/house-clock/wake-queue.js';
import { WAKE_CHAIN_MAX } from '../../backend/services/house-clock/wake-gate.js';
import { takeSignal } from '../../backend/services/house-clock/house-clock.js';
import { startTeamRun } from '../../backend/services/team-run-start.js';
import { startWatch } from '../../backend/services/team-watch.js';

const until = async (check, ms = 5000) => {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe('a team run started inside a wake starts its own chain', () => {
  let office;
  const deep = { depth: WAKE_CHAIN_MAX, wakeId: 'wake-deep' };

  beforeEach(async () => {
    office = await createStaffOfficeFixture();
    configureWakeQueue({ settleMs: 0 });
    setWakeSink(takeSignal);
    setWakeRunner(null);
    const c = await writeCharter(WALLET, {
      goal: 'Prove a run outlives the wake that filed it.',
      seats: [{ laneId: OPTIO, dailyCap: 5 }, { laneId: HOUSEMATE, dailyCap: 5 }],
    }, { by: WALLET, ownedLanes: [OPTIO, HOUSEMATE, BYSTANDER] });
    await approveCharter(WALLET, { version: c.version, by: WALLET });
  });
  afterEach(async () => {
    await whenHouseIdle(WALLET);
    setWakeSink(null);
    configureWakeQueue({ settleMs: 3000, retryMs: 60_000 });
    await office.teardown();
  });

  test('a run filed at the chain\'s limit still wakes its lead when it ends', async () => {
    const started = await runInWake(deep, () => startTeamRun({
      plan: Object.freeze({
        name: 'DEEP CREW', goal: 'Prove the end is heard.',
        steps: Object.freeze([Object.freeze({ id: 'one', neumaId: BYSTANDER, task: 'say one thing', needs: Object.freeze([]) })]),
        memberNames: Object.freeze({ [BYSTANDER]: 'Cosi' }),
      }),
      lead: { neumaId: HOUSEMATE, name: 'Quae' },
      wallet: WALLET,
      deps: { checkSubstrate: async () => true, getCapacity: async () => ({ maxParallel: 2 }), ask: async () => 'one thing said\nSTATUS:\ndone' },
    }));
    expect(started.ok).toBe(true);
    const ended = await until(async () => (await readWakeQueue(WALLET)).items.find((i) => i.reason === 'run-ended'));
    expect(ended).toMatchObject({ seat: HOUSEMATE, ref: started.runId, depth: 0, cause: null });
  });

  test('a watch armed inside a wake checks in to the Optio on a chain of its own', async () => {
    // A notable check-in (a failed part): only those wake the Optio (ruled 2026-10-19).
    const entry = { id: 'run-deep', name: 'WATCHED', lead: 'Quae', startedAt: new Date().toISOString(), checkIn: 0.002, board: [{ id: 'p', member: 'Cosi', state: 'failed' }] };
    runInWake(deep, () => startWatch(entry, { wallet: WALLET, lead: { neumaId: HOUSEMATE, name: 'Quae' } }));
    const checkIn = await until(async () => (await readWakeQueue(WALLET)).items.find((i) => i.reason === 'run-check-in'));
    entry.stopWatch();
    expect(checkIn).toMatchObject({ seat: OPTIO, depth: 0, cause: null });
  });
});
