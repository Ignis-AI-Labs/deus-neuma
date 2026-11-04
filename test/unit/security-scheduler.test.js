/**
 * Security scheduler — the DUE LOGIC and the per-house walk, proven on real
 * tmp state files: the 24-hour law (overdue runs, fresh holds), the never-ran
 * boot case, the corrupt-state law (hold the watch, loudly), and the walk
 * visiting only the houses this process serves. The runFn is a REAL async
 * function writing a REAL marker file — the claim proven here is […]; the scan itself is proven against
 * the live OSV API in test/integration/security-advisory-live.test.js and
 * by the routes test's real manual run. One real scan with an empty watch
 * list proves each house keeps its own state while the host inventory is
 * the machine's.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { standTwoHouses, HOUSE_A, HOUSE_B } from '../helpers/house-office-kit.js';
import { csoDesignation } from '../../backend/services/security/cso-designation.js';
import { createWatchStore } from '../../backend/services/security/watch-store.js';
import {
  securityTick, tickSecurityHouses, runSecurityScan, readScanState,
} from '../../backend/services/security/security-scheduler.js';

describe('security scheduler, per house (real tmp state)', () => {
  let houses, markerPath;
  const stateOf = (wallet) => houses.houseFile(wallet, 'offices', 'security', 'security-scan-state.json');
  const writeState = async (wallet, value) => {
    await fs.mkdir(path.dirname(stateOf(wallet)), { recursive: true });
    await fs.writeFile(stateOf(wallet), JSON.stringify(value));
  };

  // A real run stand-in: writes a marker on disk so the test watches an
  // actual side effect, never a spy count.
  const realRun = (wallet = HOUSE_A) => async () => {
    await fs.appendFile(markerPath, `${wallet}\n`);
    return { ok: true };
  };
  const ran = () => fs.readFile(markerPath, 'utf8').then((t) => t.trim().split('\n'), () => []);

  beforeEach(async () => {
    houses = await standTwoHouses({ label: 'security-scheduler' });
    markerPath = path.join(houses.tmp, 'ran.txt');
  });
  afterEach(() => houses.restore());

  test('no state file = never run = the watch fires (boot after downtime)', async () => {
    expect(await securityTick(HOUSE_A, Date.now(), realRun())).toEqual({ ok: true });
    expect(await ran()).toEqual([HOUSE_A]);
  });

  test('a run 25 hours old fires; a run 1 hour old holds — per house', async () => {
    const now = Date.now();
    await writeState(HOUSE_A, { lastRunAt: new Date(now - 25 * 3600 * 1000).toISOString(), runs: [] });
    await writeState(HOUSE_B, { lastRunAt: new Date(now - 1 * 3600 * 1000).toISOString(), runs: [] });
    expect(await securityTick(HOUSE_A, now, realRun(HOUSE_A))).toEqual({ ok: true });
    expect(await securityTick(HOUSE_B, now, realRun(HOUSE_B))).toBeNull();
    expect(await ran()).toEqual([HOUSE_A]);
  });

  test('a corrupt state file holds that house\'s watch rather than assume freshness', async () => {
    await writeState(HOUSE_A, {});
    await fs.writeFile(stateOf(HOUSE_A), '{corrupt');
    expect(await securityTick(HOUSE_A, Date.now(), realRun())).toBeNull();
    expect(await ran()).toEqual([]);
  });

  test('the walk ticks only the houses this process serves', async () => {
    houses.asHouse(HOUSE_B);
    await csoDesignation.designate(HOUSE_B, 'brio');
    houses.asHouse(HOUSE_A);
    await csoDesignation.designate(HOUSE_A, 'dovan');
    // Served from house A's ground: B's office stands, but B is not served here.
    await tickSecurityHouses({ runFor: (wallet) => realRun(wallet)() });
    expect(await ran()).toEqual([HOUSE_A]);
  });

  // a real scan: its self-checks import the whole route tree (self-check.js, machine-owner-gate),
  // ~4 s cold in a worker alone and past the 15 s default under the full parallel lane
  test('a real run lands in its own house; the host inventory is the machine\'s, read by both', async () => {
    const emptyWatch = createWatchStore({ path: path.join(houses.tmp, 'empty-watch.json'), seedRepos: [] });
    const summary = await runSecurityScan({ wallet: HOUSE_A, trigger: 'manual', watchStore: emptyWatch });
    expect(summary.repos).toEqual([]);
    const a = await readScanState(HOUSE_A);
    const b = await readScanState(HOUSE_B);
    expect(a.lastRunAt).toBe(summary.startedAt);
    expect(a.runs).toHaveLength(1);
    expect(b.lastRunAt).toBeNull();
    expect(b.runs).toEqual([]);
    expect(b.host).toEqual(a.host); // one machine, one kernel
    expect(await houses.readJson(stateOf(HOUSE_A))).not.toHaveProperty('host');
    await expect(runSecurityScan({ trigger: 'manual' })).rejects.toThrow(/runs for a house/);
  }, 60_000);
});
