/**
 * THE LEGAL OFFICE PER HOUSE — two houses on one machine, the SAME lane id
 * in both, on REAL tmp disk with no double anywhere (RULE 0). Founder,
 * 2026-10-16: […]
 *
 * Proven: each house's CLO seat, matters, watch state and CLO briefing are
 * its own; the machine-wide legal records move once to the right house (the
 * seated lane's owner, or with no seat the original single operator), never
 * to both, and an unresolvable owner serves no house; the standing watch
 * walks only the houses this process serves.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { standTwoHouses, HOUSE_A, HOUSE_B } from '../helpers/house-office-kit.js';
import { writeOwner } from '../helpers/audit-auth.js';
import { cloDesignation } from '../../backend/services/legal/clo-designation.js';
import { matterLedgerFor } from '../../backend/services/legal/matter-ledger.js';
import { cloBriefingSection } from '../../backend/services/legal/legal-briefing.js';
import {
  readLegalWatchState, runLegalWatch, legalHouses, tickLegalHouses,
} from '../../backend/services/legal/legal-scheduler.js';

const matter = (title) => ({
  area: 'regulation', source: 'research', repo: null,
  externalId: `research:${title}`, title, summary: 'fixture', severity: 'low',
});
const connection = (walletAddress, neumaId = 'keir') => ({ walletAddress, companion: { neumaId } });

describe('the legal office, one per house (real tmp disk)', () => {
  let houses;
  const stateOf = (wallet) => houses.houseFile(wallet, 'offices', 'legal', 'legal-watch-state.json');
  const mattersOf = (wallet) => houses.houseFile(wallet, 'offices', 'legal', 'legal-matters.json');

  // Each house watches nothing — a real run over an empty list, no repo read.
  const emptyWatch = async (wallet) => {
    const file = houses.houseFile(wallet, 'offices', 'security', 'security-watch.json');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ repos: [], host: { expectedPorts: [] } }));
  };

  beforeEach(async () => {
    houses = await standTwoHouses({ label: 'legal-houses' });
    await emptyWatch(HOUSE_A);
    await emptyWatch(HOUSE_B);
  });
  afterEach(() => houses.restore());

  test('the same lane id seated as CLO in both houses: each seat, ledger, state and briefing is its own', async () => {
    houses.asHouse(HOUSE_A);
    await cloDesignation.designate(HOUSE_A, 'keir');
    await (await matterLedgerFor(HOUSE_A)).ingest([matter('house A reading')]);
    await runLegalWatch({ wallet: HOUSE_A, trigger: 'house-a' });

    houses.asHouse(HOUSE_B);
    await cloDesignation.designate(HOUSE_B, 'keir');
    await (await matterLedgerFor(HOUSE_B)).ingest([matter('house B reading')]);

    expect((await matterLedgerFor(HOUSE_A).then((l) => l.load())).map((m) => m.title)).toEqual(['house A reading']);
    expect((await matterLedgerFor(HOUSE_B).then((l) => l.load())).map((m) => m.title)).toEqual(['house B reading']);
    expect((await readLegalWatchState(HOUSE_A)).runs[0].trigger).toBe('house-a');
    expect((await readLegalWatchState(HOUSE_B)).lastRunAt).toBeNull();

    const briefA = await cloBriefingSection(connection(HOUSE_A));
    const briefB = await cloBriefingSection(connection(HOUSE_B));
    expect(briefA).toContain('house A reading');
    expect(briefA).not.toContain('house B reading');
    expect(briefB).toContain('house B reading');
    expect(briefB).not.toContain('house A reading');

    await cloDesignation.clear(HOUSE_B);
    expect(await cloBriefingSection(connection(HOUSE_B))).toBe('');
    expect(await cloBriefingSection(connection(HOUSE_A))).toContain('house A reading');
  });

  test('no CLO seat: the machine records move to the original single operator, once, never to both', async () => {
    const legacy = [{ id: 'lm_legacy', title: 'machine-wide reading' }];
    await houses.writeLegacy('legal-matters.json', legacy);
    await houses.writeLegacy('legal-watch-state.json', { lastRunAt: '2026-10-16T05:49:00.000Z', repos: {}, runs: [] });

    expect(await legalHouses()).toEqual([HOUSE_A]);
    expect(await houses.readJson(mattersOf(HOUSE_A))).toEqual(legacy);
    expect((await readLegalWatchState(HOUSE_A)).lastRunAt).toBe('2026-10-16T05:49:00.000Z');
    await expect(fs.access(mattersOf(HOUSE_B))).rejects.toThrow();
    expect((await readLegalWatchState(HOUSE_B)).lastRunAt).toBeNull();
    for (const name of ['legal-matters.json', 'legal-watch-state.json']) {
      const tomb = await houses.readJson(houses.legacy(name));
      expect(tomb.migratedTo).toBe(HOUSE_A);
      expect(JSON.stringify(tomb)).not.toContain('machine-wide reading');
    }

    // idempotent: the house's own later record is never overwritten
    await fs.writeFile(mattersOf(HOUSE_A), JSON.stringify([]));
    await legalHouses();
    expect(await (await matterLedgerFor(HOUSE_A)).load()).toEqual([]);
  });

  test('a seated CLO: the machine records go to the house that owns the seated lane', async () => {
    await writeOwner(houses.rootA, 'praetorb', HOUSE_B); // the original root says this lane is B's
    await houses.writeLegacy('legal-clo.json', { laneId: 'praetorb', designatedAt: '2026-10-01T00:00:00.000Z' });
    await houses.writeLegacy('legal-matters.json', [{ id: 'lm_b', title: 'B reading' }]);

    expect((await legalHouses()).sort()).toEqual([HOUSE_B]);
    expect((await cloDesignation.getOfficer(HOUSE_B)).laneId).toBe('praetorb');
    expect(await cloDesignation.getOfficer(HOUSE_A)).toBeNull();
    expect((await (await matterLedgerFor(HOUSE_B)).load()).map((m) => m.title)).toEqual(['B reading']);
    expect(await (await matterLedgerFor(HOUSE_A)).load()).toEqual([]);
  });

  test('a seated lane whose owner cannot be resolved: the records serve NO house and stay where they are', async () => {
    const legacy = [{ id: 'lm_ghost', title: 'nobody\'s reading' }];
    await houses.writeLegacy('legal-clo.json', { laneId: 'ghostlane' });
    await houses.writeLegacy('legal-matters.json', legacy);

    expect(await legalHouses()).toEqual([]);
    expect(await (await matterLedgerFor(HOUSE_A)).load()).toEqual([]);
    expect(await (await matterLedgerFor(HOUSE_B)).load()).toEqual([]);
    expect(await houses.readJson(houses.legacy('legal-matters.json'))).toEqual(legacy);
  });

  test('the standing watch walks only the houses this process serves', async () => {
    houses.asHouse(HOUSE_B);
    await cloDesignation.designate(HOUSE_B, 'brio');
    houses.asHouse(HOUSE_A); // this process serves house A's root alone
    await cloDesignation.designate(HOUSE_A, 'dovan');

    const ticked = await tickLegalHouses({ runFn: (wallet) => runLegalWatch({ wallet, trigger: 'served-walk' }) });
    expect(ticked).toEqual([HOUSE_A]);
    expect((await houses.readJson(stateOf(HOUSE_A))).runs[0].trigger).toBe('served-walk');
    await expect(fs.access(stateOf(HOUSE_B))).rejects.toThrow();
  });
});
