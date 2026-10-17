/**
 * A SERVED HOUSE for scheduler tests (house-served.js, 2026-10-16): a temp
 * workspaces root and witnesses' ground holding lanes owned by one wallet,
 * pinned through the env doors the engine reads lazily (WORKSPACES_ROOT,
 * WITNESSES_ROOT) — so a scheduler tick sees this house as the one its
 * backend serves, whichever module graph the test imported (several suites
 * vi.resetModules before importing the scheduler).
 *
 * Real disk, real owner.json files: the same records a live house holds.
 * Without one, a tick acts on nothing — a record that names no house this
 * backend serves is never its to act on.
 */
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from './temp-fs.js';
import { isWitnessLane } from '../../core/workspace/neuma-workspace.js';

/** The operator wallet a served house is owned by (lower-cased, as houses are keyed). */
export const SERVED_WALLET = `0x${'5e'.repeat(20)}`;

const DOORS = ['WORKSPACES_ROOT', 'WITNESSES_ROOT'];

/**
 * Stand a served house: each lane gets a directory and an owner.json naming
 * the wallet; witness ids land on the witnesses' ground.
 * impure — temp disk, process.env.
 * @param {{wallet?: string, lanes?: string[]}} [opts]
 * @returns {Promise<{wallet: string, root: string, witnesses: string, restore: () => void}>}
 */
export const useServedHouse = async ({ wallet = SERVED_WALLET, lanes = [] } = {}) => {
  const base = await createTempDir('served-house');
  const root = path.join(base, 'house');
  const witnesses = path.join(base, 'witnesses');
  for (const laneId of lanes) {
    const dir = path.join(isWitnessLane(laneId) ? witnesses : root, laneId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'owner.json'), JSON.stringify({ wallet, claimedAt: Date.now() }));
  }
  await fs.mkdir(root, { recursive: true });
  const saved = Object.fromEntries(DOORS.map((k) => [k, process.env[k]]));
  process.env.WORKSPACES_ROOT = root;
  process.env.WITNESSES_ROOT = witnesses;
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  return { wallet, root, witnesses, restore };
};
