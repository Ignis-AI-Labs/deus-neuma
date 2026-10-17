/**
 * TWO HOUSES ON ONE MACHINE — the shared ground for the house-office tests
 * (docs/work/house-isolation.md, slice B). Real tmp disk, no double anywhere.
 *
 * Two operators, two workspace roots, and the SAME lane ids in both (lane ids
 * are not unique across houses — keir is a lane of each). The persisted
 * workspace settings name house A's root: A is the machine's original single
 * operator, the way Founder's settings-pinned desk is. Every legacy machine-wide
 * office path and the realm are pinned to tmp, so no test ever reads or
 * writes the operator's data/settings or realm.
 *
 * `asHouse(A)` points the process at that house's own root (one backend
 * serves one root); a lane's house is its owner.json there.
 */
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from './temp-fs.js';
import { writeOwner } from './audit-auth.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

export const HOUSE_A = '0xaaaa00000000000000000000000000000000aaaa';
export const HOUSE_B = '0xbbbb00000000000000000000000000000000bbbb';

// Every machine-wide office path, by env door, and its file name.
export const LEGACY_ENV = Object.freeze({
  NEUMA_SECURITY_CSO_PATH: 'security-cso.json',
  NEUMA_LEGAL_CLO_PATH: 'legal-clo.json',
  NEUMA_CMO_PATH: 'marketing-cmo.json',
  NEUMA_SECURITY_THREATS_PATH: 'security-threats.json',
  NEUMA_SECURITY_WATCH_PATH: 'security-watch.json',
  NEUMA_SECURITY_SCAN_STATE_PATH: 'security-scan-state.json',
  NEUMA_SECURITY_HOST_PATH: 'security-host.json',
  NEUMA_LEGAL_MATTERS_PATH: 'legal-matters.json',
  NEUMA_LEGAL_WATCH_STATE_PATH: 'legal-watch-state.json',
  NEUMA_CAMPAIGNS_PATH: 'marketing-campaigns.json',
  NEUMA_WEEKLY_PLAN_PATH: 'marketing-weekly-plan.json',
  NEUMA_LEAD_LEDGER_PATH: 'lead-ledger.json',
});

/**
 * Stand up two houses. impure (tmp disk, process env, module roots).
 * @param {{lanesA?: string[], lanesB?: string[], label?: string}} [opts]
 * @returns {Promise<{tmp: string, settings: string, rootA: string, rootB: string,
 *   realm: string, legacy: (name: string) => string, writeLegacy: (name: string, value: *) => Promise<void>,
 *   readJson: (file: string) => Promise<*>, houseFile: (wallet: string, ...parts: string[]) => string,
 *   asHouse: (wallet: string) => void, restore: () => void}>}
 */
export const standTwoHouses = async ({ lanesA = ['keir', 'dovan'], lanesB = ['keir', 'brio'], label = 'two-houses' } = {}) => {
  const tmp = await createTempDir(label);
  const settings = path.join(tmp, 'settings');
  const rootA = path.join(tmp, 'house-a');
  const rootB = path.join(tmp, 'house-b');
  const realm = path.join(tmp, 'realm');
  const saved = { realm: getRealmRoot(), lanes: getWorkspacesRoot(), env: {} };
  const doors = [...Object.keys(LEGACY_ENV), 'NEUMA_WORKSPACE_SETTINGS_PATH'];
  for (const key of doors) saved.env[key] = process.env[key];

  for (const id of lanesA) await writeOwner(rootA, id, HOUSE_A);
  for (const id of lanesB) await writeOwner(rootB, id, HOUSE_B);
  await fs.mkdir(settings, { recursive: true });
  for (const [key, name] of Object.entries(LEGACY_ENV)) process.env[key] = path.join(settings, name);
  process.env.NEUMA_WORKSPACE_SETTINGS_PATH = path.join(settings, 'workspace.json');
  await fs.writeFile(process.env.NEUMA_WORKSPACE_SETTINGS_PATH, JSON.stringify({ root: rootA }));
  setRealmRoot(realm);
  setWorkspacesRoot(rootA);

  return {
    tmp, settings, rootA, rootB, realm,
    legacy: (name) => path.join(settings, name),
    writeLegacy: (name, value) => fs.writeFile(path.join(settings, name), JSON.stringify(value)),
    readJson: async (file) => JSON.parse(await fs.readFile(file, 'utf8')),
    houseFile: (wallet, ...parts) => path.join(realm, wallet.toLowerCase(), ...parts),
    asHouse: (wallet) => setWorkspacesRoot(wallet.toLowerCase() === HOUSE_B ? rootB : rootA),
    restore: () => {
      setRealmRoot(saved.realm);
      setWorkspacesRoot(saved.lanes);
      for (const key of doors) {
        if (saved.env[key] === undefined) delete process.env[key];
        else process.env[key] = saved.env[key];
      }
    },
  };
};
