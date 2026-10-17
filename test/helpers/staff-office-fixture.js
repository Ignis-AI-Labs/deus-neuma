/**
 * Staff-office fixture — REAL disk, no mock: a founded house with two seated
 * neuma lanes (an Optio and a housemate), the operator's house ground, and
 * the house's Optio seated in its own temp realm (the legacy machine seat's
 * env door, NEUMA_STAFF_COS_PATH, pointed at temp too). Every seam the staff tests need,
 * seeded through the same writes production uses.
 *
 * By default the fixture owns the workspaces root. `{ manageRoot: false }`
 * seeds into WHATEVER root stands (the harness-turn-kit's, when a test needs
 * both) and restores nothing — the kit's own teardown keeps that law.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import neumaWorkspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { setHouseWorkspace } from '../../backend/services/house-workspace.js';
import { cosDesignation } from '../../backend/services/staff/cos-designation.js';

export const WALLET = `0x${'a'.repeat(40)}`;
export const OPTIO = 'staff-fixture-optio';
export const HOUSEMATE = 'staff-fixture-quae';
export const BYSTANDER = 'staff-fixture-cosi';

/** impure — stand the whole office up; returns the handles and a teardown. */
export const createStaffOfficeFixture = async ({ manageRoot = true } = {}) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'staff-office-'));
  const previousRoot = manageRoot ? getWorkspacesRoot() : null;
  if (manageRoot) setWorkspacesRoot(path.join(root, 'workspaces'));
  const savedEnv = {
    NEUMA_DATA_ROOT: process.env.NEUMA_DATA_ROOT,
    NEUMA_STAFF_COS_PATH: process.env.NEUMA_STAFF_COS_PATH,
    NEUMA_TEAM_RUN_PATH: process.env.NEUMA_TEAM_RUN_PATH,
    DNA_ENCRYPTION_KEY: process.env.DNA_ENCRYPTION_KEY,
  };
  process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
  process.env.NEUMA_TEAM_RUN_PATH = path.join(root, 'team-runs');
  // The sovereign files' master key — without it a DEK-less lane's encrypted
  // ledger writes a read no one can answer.
  process.env.DNA_ENCRYPTION_KEY = 'staff-office-fixture-key-material';
  // The designation rides the SHARED singleton's env door — the intents and
  // the tool read cosDesignation, so a factory instance would seat a fiction.
  process.env.NEUMA_STAFF_COS_PATH = path.join(root, 'settings', 'staff-cos.json');
  // The isolated-stack door: with the realm root ALSO under the temp root,
  // the durability law (user-realm.js assertDurableGround) admits a temp
  // house ground — the fixture's whole stack is disposable together.
  const previousRealm = getRealmRoot();
  setRealmRoot(path.join(root, 'realm'));

  const ground = path.join(root, 'house-ground');
  await fs.mkdir(ground, { recursive: true });
  await setHouseWorkspace(WALLET, ground);

  const seats = {};
  for (const laneId of [OPTIO, HOUSEMATE, BYSTANDER]) {
    // The harness kit may have created the officer lane already — an
    // existing lane is the fixture's friend, never an error.
    await neumaWorkspace.create(laneId).catch(() => {});
    await fs.writeFile(path.join(getWorkspacesRoot(), laneId, 'owner.json'), `${JSON.stringify({
      wallet: WALLET,
      claimedAt: new Date().toISOString(),
    }, null, 2)}\n`);
    const soulAddress = `0x${laneId.replace(/[^a-z0-9]/g, '').padEnd(40, '0').slice(0, 40)}`;
    await fs.mkdir(path.join(getWorkspacesRoot(), laneId, 'identity'), { recursive: true });
    await fs.writeFile(path.join(getWorkspacesRoot(), laneId, 'identity', 'onchain-seal.json'), `${JSON.stringify({
      soulAddress,
    }, null, 2)}\n`);
    seats[laneId] = soulAddress;
  }
  // The founding receipt: the Optio holds the Quaestor's office word, the
  // housemate a crew seat — the org chart the staff acts dispatch across.
  await fs.writeFile(path.join(getWorkspacesRoot(), 'house-founding.base.json'), `${JSON.stringify({
    houseName: 'Fixture House',
    houseId: 1,
    network: 'base-sepolia',
    members: [
      { kind: 0, title: 'Rector', address: WALLET },
      { kind: 1, title: 'Quaestor', address: seats[OPTIO] },
      { kind: 1, title: 'Scriba', address: seats[HOUSEMATE] },
      { kind: 1, title: 'Custos', address: seats[BYSTANDER] },
    ],
  }, null, 2)}\n`);
  await cosDesignation.designate(WALLET, OPTIO);

  const teardown = async () => {
    if (manageRoot) setWorkspacesRoot(previousRoot);
    setRealmRoot(previousRealm);
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  };
  return { root, ground, cosDesignation, teardown };
};
