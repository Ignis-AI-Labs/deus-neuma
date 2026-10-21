/**
 * THE OPTIO'S OWN PLANS RIDE THE CHARTER (RULE 0: a real wake turn, the real
 * plan_submit, the real plan of record, the real dispatch gate, a real
 * loopback provider) — Design note, 2026-10-16: […].
 *
 * Under proof:
 *  - a plan the seated Optio leads, inside the charter's delegation, is
 *    approved by the charter itself: stamped approvedBy charter at its
 *    version, made her plan of record, and her team/run is accepted — no
 *    card, no ask, no second wake;
 *  - one that gives the Optio's own lane a step goes to the operator (her
 *    no-self-approval term), and nothing becomes her plan of record.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createWakeHouse, call, WALLET, OPTIO, HOUSEMATE } from '../helpers/house-wake-kit.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { readAsks } from '../../backend/services/house-clock/wake-ledger.js';
import { readWakePlan } from '../../backend/services/house-clock/wake-plan.js';
import { teamRunIntent } from '../../backend/services/intents/team-run.js';

describe('the Optio\'s own team plan, inside the charter', () => {
  let house;
  beforeEach(async () => { house = await createWakeHouse(); });
  afterEach(async () => { await house.teardown(); });

  test('inside the delegation, the charter approves it: her plan of record, stamped at the charter\'s version, and team/run accepts it', async () => {
    await house.serve([
      { reply: call('team/plan_submit', {
        name: 'DIGEST CREW', goal: 'Draft the first research digest.',
        steps: [{ id: 'draft', member: 'Cosi', task: 'Write the digest draft into digest.md.' }],
      }) },
      { reply: 'The charter approved the plan; Cosi drafts.' },
    ]);
    const charter = await house.charter();
    await house.post(OPTIO, 'Get the first digest drafted.', HOUSEMATE);
    const [row] = await house.ledgerRows(1);
    expect(row).toMatchObject({ seat: OPTIO, outcome: 'done', escalations: [] });

    const told = JSON.stringify(house.provider.turns[1].messages);
    expect(told).toContain(`the charter (version ${charter.version}) approved it`);
    const planId = /plan-[a-f0-9]{12}/.exec(told)[0];
    const plan = await readWakePlan(WALLET, planId);
    expect(plan).toMatchObject({ status: 'approved', lead: OPTIO, verdict: { verdict: 'approve', by: 'charter', version: charter.version } });
    const record = await neumaWorkspace.readPlanRecord(OPTIO);
    expect(record.goal).toBe('Draft the first research digest.');
    expect(record.approvedBy).toMatchObject({ kind: 'charter', version: charter.version, planId });
    expect(await readAsks(WALLET)).toEqual([]);
    // no plan-review wake: the charter ruled, not the Optio on her own plan
    expect(house.provider.turns).toHaveLength(2);

    const run = await teamRunIntent.validate({}, { connection: { companion: { neumaId: OPTIO, name: 'Optio' }, walletAddress: WALLET } });
    expect(run.ok).toBe(true);
  }, 60000);

  test('a plan that gives the Optio a step of her own goes to the operator', async () => {
    await house.serve([
      { reply: call('team/plan_submit', {
        name: 'SCAN AND DRAFT', goal: 'Scan the market, then draft the digest.',
        steps: [
          { id: 'scan', member: 'Optio', task: 'Scan the market for the gap.' },
          { id: 'draft', member: 'Cosi', task: 'Draft digest.md from the scan.', needs: ['scan'] },
        ],
      }) },
      { reply: 'The plan waits on my operator.' },
    ]);
    await house.charter();
    await house.post(OPTIO, 'Scan and draft the digest.', HOUSEMATE);
    const [row] = await house.ledgerRows(1);
    expect(row.outcome).toBe('escalated');
    expect(row.escalations).toEqual([expect.objectContaining({ kind: 'plan', why: expect.stringMatching(/steps of her own/) })]);
    expect(JSON.stringify(house.provider.turns[1].messages)).toContain('was NOT approved');
    expect(await neumaWorkspace.readPlanRecord(OPTIO)).toBeNull();
    expect((await readAsks(WALLET)).map((a) => a.kind)).toEqual(['plan']);
  }, 60000);
});
