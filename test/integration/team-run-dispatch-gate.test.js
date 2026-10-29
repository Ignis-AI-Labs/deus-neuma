/**
 * THE OPTIO DISPATCH GATE, house by house (RULE 0) — the real team/run intent
 * through the real sweep on the team-intent kit (real WS pair, real harness,
 * the member conduit scripted through the intent module's declared seams).
 * Each house seats its own Optio (Design note, 2026-10-16: […]): a
 * seated Optio gates every other lane of ITS house, never another house's,
 * and a house with no Optio of its own runs ungated.
 *
 * Lifted out of team-run-tool.test.js, whose live suite rides the serial
 * substrate lane — the gate needs no substrate, so its proof stands in the
 * hermetic suite.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import { neumaWorkspace } from '../../core/index.js';
import { cosDesignation } from '../../backend/services/staff/cos-designation.js';
import { liveRunsFor } from '../../backend/services/team-run-live.js';
import { createTeamIntentKit } from '../helpers/team-intent-kit.js';
import { handlePlanSubmit } from '../../backend/services/plan-mode.js';
import { resolvePlanApproval } from '../../backend/services/team-plan.js';

describe('the Optio dispatch gate — one seat per house (real WS + real harness, gnosis)', () => {
  const kit = createTeamIntentKit('team-run-gate');
  const { freshConnection, fileRun, runIntent, report, untilClient, log: clientLog } = kit;
  beforeAll(() => kit.open(), 60000);
  afterAll(() => kit.close());

  // Each house seats its own Optio (ruling, 2026-10-16): this house is the kit's
  // operator wallet; ELSEWHERE is a second operator's house on the same machine.
  const ELSEWHERE = '0x2222222222222222222222222222222222222222';
  const ownLane = async (laneId, wallet) => {
    const { writeOwner } = await import('../helpers/audit-auth.js');
    await writeOwner(path.dirname(neumaWorkspace.pathFor(laneId)), laneId, wallet);
  };

  test('the Optio dispatch gate: with a CoS seated, another lane is denied and pointed at house/post', async () => {
    const house = freshConnection().walletAddress;
    await ownLane('optiolane', house);
    await cosDesignation.designate(house, 'optiolane');
    try {
      const connection = freshConnection(); // lane 'aethon' — not the seated office
      clientLog.length = 0;
      await fileRun(connection, 'gated-run');
      const receipt = await runIntent(connection);
      expect(receipt.status).toBe('denied');
      expect(receipt.error).toContain('The Optio holds dispatch');
      expect(receipt.error).toContain('house/post');
      // The denial lands BEFORE anything starts: no frames, no run state.
      expect(clientLog.some((m) => m.type === 'operator:team_start')).toBe(false);
      expect(liveRunsFor(connection.walletAddress)).toEqual([]);
    } finally {
      await cosDesignation.clear(house);
    }
  }, 30000);

  test('two houses, two Optios: each gates only its own house, and clearing one leaves the other', async () => {
    const house = freshConnection().walletAddress;
    await ownLane('optiolane', house);
    await ownLane('elsewhere-optio', ELSEWHERE);
    await ownLane('elsewhere-lead', ELSEWHERE);
    await cosDesignation.designate(house, 'optiolane');
    await cosDesignation.designate(ELSEWHERE, 'elsewhere-optio');
    const elsewhereLead = () => ({ ...freshConnection(), companion: { name: 'Elsewhere', neumaId: 'elsewhere-lead' }, walletAddress: ELSEWHERE });
    try {
      await fileRun(freshConnection(), 'house-one-run');
      const mine = await runIntent(freshConnection());
      expect(mine.status).toBe('denied');
      await fileRun(elsewhereLead(), 'house-two-run');
      const theirs = await runIntent(elsewhereLead());
      expect(theirs.status).toBe('denied');
      expect(theirs.error).toContain('The Optio holds dispatch');

      // Unseat this house's office: the other house's gate still stands.
      await cosDesignation.clear(house);
      await fileRun(elsewhereLead(), 'house-two-again');
      expect((await runIntent(elsewhereLead())).status).toBe('denied');
    } finally {
      await cosDesignation.clear(house);
      await cosDesignation.clear(ELSEWHERE);
    }
  }, 30000);

  test('an Optio of ANOTHER operator\'s house on this machine never gates this house\'s lead', async () => {
    // This house seats no Optio of its own — it never sees the other house's.
    await ownLane('elsewhere-optio', ELSEWHERE);
    await cosDesignation.designate(ELSEWHERE, 'elsewhere-optio');
    try {
      expect(await cosDesignation.getOfficer(freshConnection().walletAddress)).toBeNull();
      const connection = freshConnection();
      await fileRun(connection, 'other-house-run');
      const receipt = await runIntent(connection);
      expect(receipt.status).toBe('ok');
      expect((await report()).status).toBe('done');
    } finally {
      await cosDesignation.clear(ELSEWHERE);
    }
  }, 30000);

  // Ruled 2026-10-19: […] The operator's APPROVE
  // on the chat card is their own yes — it passes the gate as their yes in the house clock does.
  test('with an Optio seated, a plan the operator APPROVED on the chat card is recorded as theirs and runs', async () => {
    const house = freshConnection().walletAddress;
    for (const lane of ['optiolane', 'aethon', 'boreas']) await ownLane(lane, house);
    await cosDesignation.designate(house, 'optiolane');
    try {
      const { _approvedPlan, ...connection } = freshConnection(); // no plan yet: the lead submits one
      clientLog.length = 0;
      const submitted = handlePlanSubmit(connection, {
        name: 'CHAT CREW', goal: 'Ship a week of posts.',
        steps: [{ id: 'research', member: 'aethon', task: 'find themes' }, { id: 'draft', member: 'boreas', task: 'write posts', needs: ['research'] }],
      });
      // The operator's desk answers the card — the route's own call (portal-message-handlers.js).
      const card = await untilClient((m) => m.type === 'operator:plan' && m.name === 'CHAT CREW');
      expect(resolvePlanApproval(connection, card.id, 'approve')).toBe(true);
      expect((await submitted).content).toContain('Your operator APPROVED the plan "CHAT CREW"');
      expect((await neumaWorkspace.readPlanRecord('aethon')).approvedBy).toEqual({ kind: 'operator', via: 'chat' });
      await fileRun(connection, 'chat-approved-run');
      const receipt = await runIntent(connection);
      expect(receipt.status).toBe('ok');
      expect((await report()).text).toContain('all 2 steps');
    } finally {
      await cosDesignation.clear(house);
      await neumaWorkspace.retirePlanRecord('aethon');
    }
  }, 30000);

  test('the seated Optio\'s own filing passes the gate and runs the plan', async () => {
    const house = freshConnection().walletAddress;
    await ownLane('aethon', house);
    await cosDesignation.designate(house, 'aethon');
    try {
      const connection = freshConnection();
      clientLog.length = 0;
      await fileRun(connection, 'optio-run');
      const receipt = await runIntent(connection);
      expect(receipt.status).toBe('ok');
      expect((await report()).text).toContain('all 2 steps');
      const start = await untilClient((m) => m.type === 'operator:team_start');
      expect(start.name).toBe('HERALD CREW');
    } finally {
      await cosDesignation.clear(house);
    }
  }, 30000);
});
