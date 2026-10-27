/**
 * THE MARKETING OFFICE PER HOUSE — real tmp disk, the real stores, the real
 * briefing and the real Optio fold; no double anywhere (RULE 0).
 *
 * Two operators, two houses, and the SAME lane id in both (ruling,
 * 2026-10-16: two houses are never confused by the system, at any level).
 * Proven: each house's CMO seat, campaign bench,
 * weekly plan and lead ledger are its own; the CMO briefing and house-state's
 * campaign, lead and posting-failure folds read only the lane's own house;
 * the machine-wide marketing data moves once to the original single operator
 * (the CMO seat is an explicit null), and a seat whose owner cannot be
 * resolved leaves the data serving no house.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { standTwoHouses, HOUSE_A, HOUSE_B } from '../helpers/house-office-kit.js';
import { cmoDesignation } from '../../backend/services/marketing/cmo-designation.js';
import { campaignStoreFor } from '../../backend/services/marketing/campaign-store.js';
import { leadLedgerFor } from '../../backend/services/leads/lead-ledger.js';
import { weeklyPlanStoreFor } from '../../backend/services/marketing/weekly-plan.js';
import { cmoBriefingSection } from '../../backend/services/portal-turn-sections.js';
import { computeHouseState } from '../../backend/services/staff/house-state.js';

const DAYS = [{ day: 'monday', theme: 'ship log', objective: 'show what moved', posts: 1 }];
const keirOf = (walletAddress) => ({ walletAddress, companion: { neumaId: 'keir' } });

describe('the marketing office — one per house (real tmp disk)', () => {
  let houses;
  let savedQueue;
  beforeEach(async () => {
    houses = await standTwoHouses({ label: 'marketing-houses' });
    savedQueue = process.env.NEUMA_SOCIAL_POST_QUEUE_PATH;
    process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = path.join(houses.settings, 'social-post-queue.json');
  });
  afterEach(() => {
    houses.restore();
    if (savedQueue === undefined) delete process.env.NEUMA_SOCIAL_POST_QUEUE_PATH;
    else process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = savedQueue;
  });

  test('the same lane id in two houses: each CMO, bench, plan, ledger and briefing is its own', async () => {
    houses.asHouse(HOUSE_A);
    await cmoDesignation.designate(HOUSE_A, 'keir');
    await (await campaignStoreFor(HOUSE_A)).add({ name: 'Brookmere Dawn', brand: 'brookmere' });
    await (await leadLedgerFor(HOUSE_A)).add({ name: 'Ada', addedBy: 'keir' });
    await (await weeklyPlanStoreFor(HOUSE_A)).approve(DAYS);

    // House B's keir holds nothing yet — not A's seat, not A's data.
    expect(await cmoDesignation.holds(HOUSE_B, 'keir')).toBe(false);
    expect(await (await campaignStoreFor(HOUSE_B)).load()).toEqual([]);
    expect(await (await leadLedgerFor(HOUSE_B)).load()).toEqual([]);
    expect(await (await weeklyPlanStoreFor(HOUSE_B)).load()).toBeNull();
    expect(await cmoBriefingSection(keirOf(HOUSE_B))).toBe('');

    const briefingA = await cmoBriefingSection(keirOf(HOUSE_A));
    expect(briefingA).toContain('CMO office');
    expect(briefingA).toContain('Brookmere Dawn');
    expect(briefingA).toContain('Ada');

    // House B seats its own keir; each briefing reads only its own house.
    houses.asHouse(HOUSE_B);
    await cmoDesignation.designate(HOUSE_B, 'keir');
    await (await campaignStoreFor(HOUSE_B)).add({ name: 'Thornfield Tide', brand: 'thornfield' });
    const briefingB = await cmoBriefingSection(keirOf(HOUSE_B));
    expect(briefingB).toContain('Thornfield Tide');
    expect(briefingB).not.toContain('Brookmere Dawn');
    expect(briefingB).not.toContain('Ada');
    expect(await cmoBriefingSection(keirOf(HOUSE_A))).not.toContain('Thornfield Tide');

    // Clearing house B's seat leaves house A's standing.
    await cmoDesignation.clear(HOUSE_B);
    expect(await cmoBriefingSection(keirOf(HOUSE_B))).toBe('');
    expect(await cmoBriefingSection(keirOf(HOUSE_A))).toContain('Brookmere Dawn');
  });

  test('the Optio fold: campaigns, leads and posting failures are the house\'s own', async () => {
    houses.asHouse(HOUSE_A);
    await (await campaignStoreFor(HOUSE_A)).add({ name: 'Brookmere Dawn', brand: 'brookmere' });
    await (await leadLedgerFor(HOUSE_A)).add({ name: 'Ada', addedBy: 'dovan' });
    await (await campaignStoreFor(HOUSE_B)).add({ name: 'Thornfield Tide', brand: 'thornfield', status: 'paused' });
    // The post queue is still one machine-wide store (slice C): the fold
    // reads only what is attributable to the house.
    const failed = (id, extra) => ({ id, status: 'failed', channelId: 'x', error: `boom ${id}`, failedAt: '2026-10-16T00:00:00.000Z', ...extra });
    await fs.writeFile(process.env.NEUMA_SOCIAL_POST_QUEUE_PATH, JSON.stringify([
      failed('a-operator', { queuedBy: HOUSE_A.toUpperCase().replace('0X', '0x'), authorNeumaId: null }),
      failed('a-lane', { queuedBy: 'dovan', authorNeumaId: 'dovan' }),
      failed('b-operator', { queuedBy: HOUSE_B, authorNeumaId: null }),
      failed('b-lane', { queuedBy: 'brio', authorNeumaId: 'brio' }),
      { id: 'a-sent', status: 'sent', queuedBy: HOUSE_A },
    ]));

    const a = await computeHouseState({ wallet: HOUSE_A, laneId: 'dovan' });
    expect(a.campaigns).toEqual({ total: 1, live: ['Brookmere Dawn'] });
    expect(a.leads.total).toBe(1);
    expect(a.failures.map((f) => f.id).sort()).toEqual(['a-lane', 'a-operator']);

    houses.asHouse(HOUSE_B); // house B's process: brio's owner.json names B
    const b = await computeHouseState({ wallet: HOUSE_B, laneId: 'brio' });
    expect(b.campaigns).toEqual({ total: 1, live: [] });
    expect(b.leads.total).toBe(0);
    expect(b.failures.map((f) => f.id).sort()).toEqual(['b-lane', 'b-operator']);

    // No house, no office.
    const none = await computeHouseState({ wallet: null, laneId: null });
    expect(none.campaigns.total).toBe(0);
    expect(none.failures).toEqual([]);
  });

  test('the machine-wide marketing data moves once to the original single operator (CMO seat null)', async () => {
    const campaigns = [{ id: 'c1', name: 'Legacy Bench', brand: 'neuma', status: 'active', pillars: [] }];
    const leads = [{ id: 'l1', name: 'Legacy Lead', status: 'cold', touches: [] }];
    const plan = { status: 'approved', approvedAt: '2026-09-04T00:00:00.000Z', days: DAYS };
    await houses.writeLegacy('marketing-cmo.json', null);
    await houses.writeLegacy('marketing-campaigns.json', campaigns);
    await houses.writeLegacy('lead-ledger.json', leads);
    await houses.writeLegacy('marketing-weekly-plan.json', plan);

    houses.asHouse(HOUSE_B); // even opened from house B's process first
    expect(await (await campaignStoreFor(HOUSE_B)).load()).toEqual([]);
    // The first-shape bench lands in A's house and is moved to shape v2 there.
    expect(await (await campaignStoreFor(HOUSE_A)).load()).toMatchObject([
      { id: 'c1', v: 2, name: 'Legacy Bench', brand: 'neuma', status: 'active', angles: [], subs: [], migratedFrom: { v: 1, pillars: [] } },
    ]);
    expect(await (await leadLedgerFor(HOUSE_B)).load()).toEqual([]);
    expect(await (await leadLedgerFor(HOUSE_A)).load()).toEqual(leads);
    expect(await (await weeklyPlanStoreFor(HOUSE_B)).load()).toBeNull();
    expect(await (await weeklyPlanStoreFor(HOUSE_A)).load()).toEqual(plan);
    for (const name of ['marketing-campaigns.json', 'lead-ledger.json', 'marketing-weekly-plan.json']) {
      expect((await houses.readJson(houses.legacy(name))).migratedTo).toBe(HOUSE_A);
    }
    // No CMO moved: the explicit null serves no house a seat.
    expect(await cmoDesignation.getOfficer(HOUSE_A)).toBeNull();

    // Idempotent: the house's own later edits are never undone.
    const benchA = await campaignStoreFor(HOUSE_A);
    await benchA.remove('c1');
    expect(await (await campaignStoreFor(HOUSE_A)).load()).toEqual([]);
  });

  test('a legacy CMO seat whose owner cannot be resolved: the data serves NO house, untouched', async () => {
    const campaigns = [{ id: 'c1', name: 'Orphan Bench', brand: 'neuma', status: 'active', pillars: [] }];
    await houses.writeLegacy('marketing-cmo.json', { laneId: 'ghostlane' });
    await houses.writeLegacy('marketing-campaigns.json', campaigns);
    expect(await (await campaignStoreFor(HOUSE_A)).load()).toEqual([]);
    expect(await (await campaignStoreFor(HOUSE_B)).load()).toEqual([]);
    expect(await houses.readJson(houses.legacy('marketing-campaigns.json'))).toEqual(campaigns);
    expect(await cmoDesignation.getOfficer(HOUSE_A)).toBeNull();
  });

  test('a legacy CMO seat moves the seat AND the data to the house that owns its lane', async () => {
    const leads = [{ id: 'l1', name: 'Seated Lead', status: 'cold', touches: [] }];
    await houses.writeLegacy('marketing-cmo.json', { laneId: 'dovan', designatedAt: '2026-09-07T00:00:00.000Z' });
    await houses.writeLegacy('lead-ledger.json', leads);
    houses.asHouse(HOUSE_A);
    expect(await (await leadLedgerFor(HOUSE_B)).load()).toEqual([]);
    expect(await (await leadLedgerFor(HOUSE_A)).load()).toEqual(leads);
    expect(await cmoDesignation.holds(HOUSE_A, 'dovan')).toBe(true);
    expect(await cmoDesignation.holds(HOUSE_B, 'dovan')).toBe(false);
  });
});
