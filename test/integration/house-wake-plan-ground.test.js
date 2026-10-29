/**
 * A WAKE'S PLAN AND ITS WORKSPACE (RULE 0) — the real wakePlanRoute on a real
 * temp house: its ground on disk, its seated Optio, its approved charter. An
 * approved plan's workspace becomes every member's write root, so a plan that
 * names one outside the house's ground (or the lead's own lane) is the
 * operator's to rule on — never the Optio's, never the charter's.
 */
import fs from 'fs/promises';
import path from 'path';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createStaffOfficeFixture, WALLET, OPTIO, HOUSEMATE, BYSTANDER } from '../helpers/staff-office-fixture.js';
import { writeCharter, approveCharter } from '../../backend/services/house-clock/charter-store.js';
import { wakePlanRoute } from '../../backend/services/house-clock/wake-plan.js';
import { readAsks } from '../../backend/services/house-clock/wake-ledger.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';

const until = async (check, ms = 5000) => {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe('a wake\'s team plan names its workspace', () => {
  let office, charter;

  beforeEach(async () => {
    office = await createStaffOfficeFixture();
    const c = await writeCharter(WALLET, {
      goal: 'Prove the house keeps its plans on its own ground.',
      seats: [{ laneId: OPTIO, dailyCap: 5 }, { laneId: HOUSEMATE, dailyCap: 5 }],
      delegation: { teamPlans: true },
    }, { by: WALLET, ownedLanes: [OPTIO, HOUSEMATE, BYSTANDER] });
    charter = await approveCharter(WALLET, { version: c.version, by: WALLET });
  });
  afterEach(async () => { await office.teardown(); });

  const route = (lead, root) => {
    const wake = { wallet: WALLET, seat: lead, name: lead, wakeId: `wake-${lead}`, sessionId: 's-1', charter, escalations: [] };
    const req = {
      goal: 'Draft the digest.', steps: [{ id: 'draft', neumaId: BYSTANDER, task: 'write digest.md', needs: [] }],
      ...(root ? { workspace: { root, budgetBytes: 1024 } } : {}),
    };
    return wakePlanRoute(wake)(null, req).then((result) => ({ result, wake }));
  };

  test('outside the ground: to the operator, under the Optio\'s road and the charter\'s alike', async () => {
    const elsewhere = path.join(office.root, 'not-the-house');
    await fs.mkdir(elsewhere, { recursive: true });
    for (const lead of [HOUSEMATE, OPTIO]) {
      const { result, wake } = await route(lead, elsewhere);
      expect(result.status).toBe('escalated');
      expect(wake.escalations[0].why).toContain(`the plan names a workspace outside the house's ground (${elsewhere})`);
    }
    await until(async () => (await readAsks(WALLET)).length === 2);
  });

  test('inside the house ground, inside the lead\'s own lane, or none named: the Optio rules', async () => {
    for (const root of [path.join(office.ground, 'repos', 'digest'), path.join(neumaWorkspace.pathFor(HOUSEMATE), 'digest'), null]) {
      const { result } = await route(HOUSEMATE, root);
      expect(result.status).toBe('routed');
    }
  });

  test('the charter is read at the plan, never the copy the wake started with', async () => {
    // Edited mid-wake and not approved again: the plan is the operator's.
    const edited = await writeCharter(WALLET, {
      goal: 'Prove the house keeps its plans on its own ground.',
      seats: [{ laneId: OPTIO, dailyCap: 5 }, { laneId: HOUSEMATE, dailyCap: 5 }],
      delegation: { teamPlans: false },
    }, { by: WALLET, ownedLanes: [OPTIO, HOUSEMATE, BYSTANDER] });
    let { result, wake } = await route(HOUSEMATE, null);
    expect(result.status).toBe('escalated');
    expect(wake.escalations[0].why).toContain('the house\'s charter was changed while this wake ran');
    // Approved again, without the delegation: still the operator's, under the charter as it now reads.
    await approveCharter(WALLET, { version: edited.version, by: WALLET });
    ({ result, wake } = await route(OPTIO, null));
    expect(result.status).toBe('escalated');
    expect(wake.escalations[0].why).toContain('the charter does not delegate team plans');
    await until(async () => (await readAsks(WALLET)).length === 2);
  });
});
