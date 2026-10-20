/**
 * THE DESK HOUSE IS WATCHED BEFORE ITS FIRST BIRTH (release must-fix,
 * 2026-10-20). The watch walked only houses that own a being's lane, so a
 * fresh install — and a platform-only or harness-only user who never
 * summons — never had a dependency, secret or self-check scan run at all.
 *
 * Proven on a temp install with NO lanes, through the real scheduler: the
 * real owner record (written by the same call a local sign-in makes), the
 * real served-house read, the real tick and the real scan — self-check, the
 * running app's own inventory against OSV (or its outage, said plainly), the
 * secret sweeps, the house probe. A wallet that never signed in is never
 * walked and never gets a house on disk; a house is never walked twice; a
 * house backend pinned to another ground never takes the owner's house.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { standTwoHouses } from '../helpers/house-office-kit.js';
import { writeOwner } from '../helpers/audit-auth.js';
import { recordFirstLocalOwner } from '../../backend/services/install-owner.js';
import { securityHouses, tickSecurityHouses, readScanState } from '../../backend/services/security/security-scheduler.js';
import { APP_ROOT } from '../../backend/services/security/app-inventory.js';

const OWNER = '0x0d0d00000000000000000000000000000000d0d0';
const STRANGER = '0x5e5e00000000000000000000000000000000e5e5';

describe('the install\'s desk house is watched with zero lanes (real scheduler, temp install)', () => {
  let houses;
  let savedDataRoot;
  const exists = (p) => fs.access(p).then(() => true, () => false);

  beforeEach(async () => {
    houses = await standTwoHouses({ lanesA: [], lanesB: [], label: 'desk-house-watch' });
    await fs.mkdir(houses.rootA, { recursive: true });
    await fs.mkdir(houses.rootB, { recursive: true });
    // A fresh install's own data root: its settings name the desk's ground.
    savedDataRoot = process.env.NEUMA_DATA_ROOT;
    process.env.NEUMA_DATA_ROOT = path.join(houses.tmp, 'data');
    await fs.mkdir(path.join(process.env.NEUMA_DATA_ROOT, 'settings'), { recursive: true });
    await fs.writeFile(path.join(process.env.NEUMA_DATA_ROOT, 'settings', 'workspace.json'), JSON.stringify({ root: houses.rootA }));
  });
  afterEach(() => {
    process.env.NEUMA_DATA_ROOT = savedDataRoot;
    houses.restore();
  });

  test('before anyone signs in, no house is invented', async () => {
    expect(await securityHouses()).toEqual([]);
    expect(await exists(path.join(process.env.NEUMA_DATA_ROOT, 'settings', 'install-owner.json'))).toBe(false);
  });

  test('after the first local sign-in, a tick scans the owner\'s house — and never a stranger\'s', async () => {
    await recordFirstLocalOwner(OWNER); // what auth.js does at a local sign-in
    expect(await securityHouses()).toEqual([OWNER]);

    await tickSecurityHouses();

    const state = await readScanState(OWNER);
    expect(state.runs).toHaveLength(1);
    const [run] = state.runs;
    expect(run.trigger).toBe('scheduled');
    expect(run.finishedAt).toBeTruthy();
    // the platform's own walls were re-proven
    expect(Array.isArray(run.selfCheck?.findings)).toBe(true);
    expect(Array.isArray(run.selfCheck?.errors)).toBe(true);
    // the running app's inventory was read and put to OSV — or OSV's outage said plainly
    const appLeg = run.repos.find((r) => r.repo === path.basename(APP_ROOT));
    expect(appLeg, JSON.stringify(run.repos)).toBeTruthy();
    expect(appLeg.error || '').not.toMatch(/package-lock|watched path/);
    const osvAnswered = appLeg.checked > 0 && !/OSV|fetch|abort|network|ENOTFOUND|EAI_AGAIN/i.test(appLeg.error || '');
    const osvOffline = /OSV|fetch|abort|network|ENOTFOUND|EAI_AGAIN/i.test(appLeg.error || '');
    expect(osvAnswered || osvOffline, JSON.stringify(appLeg)).toBe(true);
    // the house probe ran for this house
    expect(Array.isArray(run.house?.errors)).toBe(true);

    // a wallet with no lanes that never signed in: never walked, no house on disk
    expect(await exists(houses.houseFile(STRANGER))).toBe(false);
    expect((await readScanState(STRANGER)).runs).toEqual([]);
  }, 6 * 60 * 1000);

  test('an owner who also holds a lane is walked once, and a stranger with no sign-in still is not', async () => {
    await recordFirstLocalOwner(OWNER);
    await writeOwner(houses.rootA, 'hazel', OWNER);
    expect(await securityHouses()).toEqual([OWNER]);
    // a later wallet at the desk is a guest, never the install's desk house
    await recordFirstLocalOwner(STRANGER);
    expect(await securityHouses()).toEqual([OWNER]);
  });

  test('a house backend pinned to another ground never takes the owner\'s house', async () => {
    await recordFirstLocalOwner(OWNER);
    houses.asHouse('0xbbbb00000000000000000000000000000000bbbb'); // serves rootB, which holds no lanes
    expect(await securityHouses()).toEqual([]);
  });
});
