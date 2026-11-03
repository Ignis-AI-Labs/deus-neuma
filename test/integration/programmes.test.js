/**
 * PROGRAMMES — chained team runs toward one goal, re-planned between runs
 * (the house economy's Stage 5) — through the real stack (RULE 0): the real
 * programme acts, the real team run start on a real temp house (the run
 * start's own deps seam, as house-wake-run-chain.test.js drives it), the real
 * clock's signal sink and queue, the real charter, the real wake words.
 *
 * Under proof: a lead opens a programme inside the charter's bound (never
 * past it, one open at a time); each run it dispatches joins the programme,
 * and the lead's run-ended wake says which run of how many and asks for the
 * next plan revised by what the run taught — or, with no runs left, to close
 * it; a plan past the programme's runs goes to the operator, not the Optio;
 * the lead closes it with what the runs came to.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { setTimeout } from 'node:timers';
import { createStaffOfficeFixture, WALLET, OPTIO, HOUSEMATE, BYSTANDER } from '../helpers/staff-office-fixture.js';
import { writeCharter, approveCharter, readCharter } from '../../backend/services/house-clock/charter-store.js';
import { setWakeSink } from '../../backend/services/house-clock/wake-signal.js';
import { setWakeRunner, configureWakeQueue, readWakeQueue, whenHouseIdle } from '../../backend/services/house-clock/wake-queue.js';
import { takeSignal } from '../../backend/services/house-clock/house-clock.js';
import { startTeamRun } from '../../backend/services/team-run-start.js';
import { planRouting } from '../../backend/services/house-clock/wake-plan.js';
import { wakeThought } from '../../backend/services/house-clock/wake-thought.js';
import { programmeOpenIntent, programmeCloseIntent } from '../../backend/services/intents/programme-acts.js';
import { readProgrammes, standingOf } from '../../backend/services/programmes/programme-store.js';

const until = async (check, ms = 8000) => {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe('programmes: runs chained toward one goal, re-planned between them', () => {
  let office;
  const lead = { companion: { neumaId: HOUSEMATE, name: 'Quae' }, walletAddress: WALLET };
  const act = async (intent, payload) => {
    const v = await intent.validate(payload, { connection: lead });
    return v.ok ? intent.execute(v.value, { connection: lead }) : v;
  };
  const run = (name) => startTeamRun({
    plan: Object.freeze({
      name, goal: 'A weekly harbour sheet three harbours pay for.',
      steps: Object.freeze([Object.freeze({ id: 'one', neumaId: BYSTANDER, task: 'draft the sheet', needs: Object.freeze([]) })]),
      memberNames: Object.freeze({ [BYSTANDER]: 'Cosi' }),
    }),
    lead: { neumaId: HOUSEMATE, name: 'Quae' },
    wallet: WALLET,
    deps: { checkSubstrate: async () => true, getCapacity: async () => ({ maxParallel: 2 }), ask: async () => 'the sheet, drafted\nSTATUS:\ndone' },
  });
  const ended = (runId) => until(async () => (await readWakeQueue(WALLET)).items.find((i) => i.reason === 'run-ended' && i.ref === runId));

  beforeAll(async () => {
    office = await createStaffOfficeFixture();
    configureWakeQueue({ settleMs: 0 });
    setWakeSink(takeSignal);
    setWakeRunner(null); // the wakes wait in view, read here
    const c = await writeCharter(WALLET, {
      goal: 'Sell a weekly harbour sheet.',
      seats: [{ laneId: OPTIO, dailyCap: 20 }, { laneId: HOUSEMATE, dailyCap: 20 }],
      delegation: { teamPlans: true, maxMembers: 2, maxSteps: 4, maxProgrammeRuns: 2 },
    }, { by: WALLET, ownedLanes: [OPTIO, HOUSEMATE, BYSTANDER] });
    await approveCharter(WALLET, { version: c.version, by: WALLET });
  });

  afterAll(async () => {
    await whenHouseIdle(WALLET);
    setWakeSink(null);
    configureWakeQueue({ settleMs: 3000, retryMs: 60_000 });
    await office.teardown();
  });

  test('a lead opens one, inside the charter\'s bound, one at a time', async () => {
    expect((await readCharter(WALLET)).delegation.maxProgrammeRuns).toBe(2);
    expect((await act(programmeOpenIntent, { name: 'Harbour sheet', goal: 'Three harbours pay for the weekly sheet.', maxRuns: 3 })).reason).toMatch(/from 2 to 2 runs — the charter allows no more/);
    const opened = await act(programmeOpenIntent, { name: 'Harbour sheet', goal: 'Three harbours pay for the weekly sheet.', maxRuns: 2 });
    expect(opened.ok, opened.reason).toBe(true);
    expect((await act(programmeOpenIntent, { name: 'Another', goal: 'Something else entirely, measured.', maxRuns: 2 })).reason).toMatch(/already lead the open programme "Harbour sheet"/);
    expect((await programmeOpenIntent.validate({}, { connection: { companion: { neumaId: 'witness-claude' }, walletAddress: WALLET } })).status).toBe('denied');
  });

  test('each run joins it; the lead\'s wake asks for the next plan from what the run taught, then for the close', async () => {
    const first = await run('FIRST PASS');
    const one = await ended(first.runId);
    expect(one.detail.programme).toMatchObject({ name: 'Harbour sheet', n: 1, of: 2, left: 1 });
    const charter = await readCharter(WALLET);
    const words = wakeThought({ items: [one], charter, now: Date.now() });
    expect(words).toContain('It was run 1 of the 2 your programme "Harbour sheet" may take');
    expect(words).toContain('submit the next run\'s plan (plan_submit), revised by what this run taught');

    const second = await run('SECOND PASS');
    const two = await ended(second.runId);
    expect(two.detail.programme).toMatchObject({ n: 2, of: 2, left: 0 });
    expect(wakeThought({ items: [two], charter, now: Date.now() })).toContain('It has no runs left: close the programme (programme/close)');
    const [programme] = await readProgrammes(WALLET);
    expect(programme.runs.map((r) => [r.id, r.status])).toEqual([[first.runId, 'done'], [second.runId, 'done']]);
  });

  test('a plan past the programme\'s runs is the operator\'s, never the Optio\'s; the lead closes it', async () => {
    const charter = await readCharter(WALLET);
    const steps = [{ id: 'one', neumaId: BYSTANDER, task: 'draft', needs: [] }];
    const [open] = await readProgrammes(WALLET);
    expect(planRouting({ charter, lead: HOUSEMATE, officer: OPTIO, steps, programme: standingOf(open) }))
      .toEqual({ to: 'operator', why: 'the programme "Harbour sheet" has run its 2 runs' });
    expect(planRouting({ charter, lead: HOUSEMATE, officer: OPTIO, steps, programme: { ...standingOf(open), n: 1, left: 1 } })).toEqual({ to: 'optio' });
    expect((await act(programmeCloseIntent, { why: 'short' })).reason).toMatch(/why: what the runs came to/);
    const closed = await act(programmeCloseIntent, { why: 'Two harbours pay; the third wants tide alarms first.', met: false });
    expect(closed.ok, closed.reason).toBe(true);
    expect((await readProgrammes(WALLET))[0]).toMatchObject({ status: 'closed', closed: { met: false, why: 'Two harbours pay; the third wants tide alarms first.' } });
    // with nothing open, a run joins nothing
    const after = await run('AFTER');
    expect((await ended(after.runId)).detail.programme).toBeUndefined();
  });
});
