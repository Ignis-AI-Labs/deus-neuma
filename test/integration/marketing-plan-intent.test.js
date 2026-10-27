/**
 * THE WEEKLY PLAN ACT + THE CMO'S STANDING SURFACE (posting-pipeline-v2
 * phases 2-3) — proven on real stores, no mocks (RULE 0):
 *  (a) only the DESIGNATED CMO may propose the plan; any other lane is
 *      denied at validate before a card is ever raised;
 *  (b) the operator's allow LOCKS the plan (real store on real disk);
 *  (c) pipeline_state serves today's slot from the lock;
 *  (d) the designated CMO's turn opens with its pipeline tools ALREADY
 *      disclosed (round 0 standing surface) — another lane does not get them;
 *  (e) all of it inside the lane's OWN house: the same lane id under another
 *      operator's wallet is no CMO, and each house locks its own plan.
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { marketingPlanIntent } from '../../backend/services/intents/marketing-plan.js';
import { weeklyPlanStoreFor } from '../../backend/services/marketing/weekly-plan.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { writeOwner } from '../helpers/audit-auth.js';
import { cmoDesignation } from '../../backend/services/marketing/cmo-designation.js';
import { computePipelineState } from '../../backend/services/marketing/pipeline-state.js';
import { stashBeingTurnCatalog } from '../../backend/services/being-tool-surface.js';
import { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const PLAN_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'plan-intent-'));
const PLAN_PATH = path.join(PLAN_DIR, 'weekly-plan.json');
const CMO_PATH = path.join(PLAN_DIR, 'cmo.json');
const QUEUE_PATH = path.join(PLAN_DIR, 'queue.json');
const DATA_ROOT = path.join(PLAN_DIR, 'data');
const overrides = {
  NEUMA_WEEKLY_PLAN_PATH: PLAN_PATH,
  NEUMA_CMO_PATH: CMO_PATH,
  NEUMA_SOCIAL_POST_QUEUE_PATH: QUEUE_PATH,
  NEUMA_DATA_ROOT: DATA_ROOT,
};
const savedEnv = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
const savedRoot = getWorkspacesRoot();
const savedRealm = getRealmRoot();
const CMO_LANE = 'sodelight';
const OTHER_LANE = 'nottheboss';
const WALLET = `0x${'f'.repeat(40)}`;
const OTHER_HOUSE = `0x${'9'.repeat(40)}`;
const HOUSE_PLAN = path.join(PLAN_DIR, 'realm', WALLET, 'offices', 'marketing', 'marketing-weekly-plan.json');
const asLane = (neumaId, walletAddress = WALLET) => ({ connection: { walletAddress, companion: { neumaId } } });

const PLAN = {
  days: [
    { day: 'monday', theme: 'ship log', objective: 'show what moved', posts: 2 },
    { day: 'friday', theme: 'community', objective: 'answer everyone', posts: 1 },
  ],
};

describe('marketing/plan — author, approve, lock; and the standing surface', () => {
  beforeAll(async () => {
    Object.assign(process.env, overrides);
    setWorkspacesRoot(path.join(PLAN_DIR, 'lanes'));
    setRealmRoot(path.join(PLAN_DIR, 'realm'));
    for (const lane of [CMO_LANE, OTHER_LANE]) await writeOwner(path.join(PLAN_DIR, 'lanes'), lane, WALLET);
  });
  beforeEach(async () => {
    process.env.NEUMA_WEEKLY_PLAN_PATH = PLAN_PATH;
    process.env.NEUMA_CMO_PATH = CMO_PATH;
    await fs.rm(PLAN_PATH, { force: true });
    await fs.rm(CMO_PATH, { force: true });
    await fs.rm(QUEUE_PATH, { force: true });
    await fs.rm(path.join(PLAN_DIR, 'realm'), { recursive: true, force: true });
  });

  afterAll(async () => {
    setWorkspacesRoot(savedRoot);
    setRealmRoot(savedRealm);
    await fs.rm(PLAN_DIR, { recursive: true, force: true });
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test('(a) a lane that is not the CMO is denied before any card', async () => {
    const verdict = await marketingPlanIntent.validate({ days: PLAN.days }, asLane(OTHER_LANE));
    expect(verdict).toMatchObject({ ok: false, status: 'denied' });
    expect(verdict.reason).toContain('designated CMO');
    // And with NO CMO seated at all, the same denial.
    const unseated = await marketingPlanIntent.validate({ days: PLAN.days }, asLane(CMO_LANE));
    expect(unseated.ok).toBe(false);
  });

  test('(b) the designated CMO proposes; the execute LOCKS the real store', async () => {
    await cmoDesignation.designate(WALLET, CMO_LANE);
    const verdict = await marketingPlanIntent.validate({ days: PLAN.days }, asLane(CMO_LANE));
    expect(verdict).toMatchObject({ ok: true });
    // The card stakes the yes on the plan itself.
    expect(marketingPlanIntent.summarize({ days: PLAN.days })).toContain('mon');
    expect(marketingPlanIntent.summarize({ days: PLAN.days })).toContain('ship log');

    const done = await marketingPlanIntent.execute(verdict.value, asLane(CMO_LANE));
    expect(done.ok).toBe(true);
    const doc = JSON.parse(await fs.readFile(HOUSE_PLAN, 'utf8'));
    expect(doc.status).toBe('approved');
    expect(doc.days[0].theme).toBe('ship log');
  });

  test('(b2) malformed plans are invalid, named exactly', async () => {
    await cmoDesignation.designate(WALLET, CMO_LANE);
    const bad = await marketingPlanIntent.validate({ days: [{ day: 'someday', theme: 'x', objective: 'y' }] }, asLane(CMO_LANE));
    expect(bad.status).toBe('invalid');
    expect(bad.reason).toContain('day must be one of');
  });

  test('(c) pipeline_state serves the locked slot', async () => {
    await (await weeklyPlanStoreFor(WALLET)).approve(PLAN.days);
    const state = await computePipelineState({ laneId: CMO_LANE, wallet: WALLET });
    // The slot is day-true from the real clock: monday/friday planned, so any
    // other weekday is an honest null.
    const today = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'][(new Date().getUTCDay() + 6) % 7];
    if (today === 'monday' || today === 'friday') {
      expect(state.weeklySlot.theme).toBeTruthy();
    } else {
      expect(state.weeklySlot).toBeNull();
    }
    // Another house — and no house at all — reads no slot from this plan.
    expect((await computePipelineState({ laneId: CMO_LANE, wallet: OTHER_HOUSE })).weeklySlot).toBeNull();
    expect((await computePipelineState({ laneId: CMO_LANE, wallet: null })).weeklySlot).toBeNull();
  });

  test('(c2) pipeline_state names the REAL algorithm clones on this machine', async () => {
    // The sync receipt lives under the data root, and the suite's data root is
    // its own (9ed812b43) — so the receipt is written here, in the shape
    // scripts/x-algorithm-sync.mjs writes it, and read back through the real path.
    const syncedAt = '2026-10-19T08:00:00.000Z';
    await fs.mkdir(DATA_ROOT, { recursive: true });
    await fs.writeFile(path.join(DATA_ROOT, 'x-algorithm-sync.json'), JSON.stringify({ syncedAt }));
    const state = await computePipelineState({ laneId: CMO_LANE, wallet: null });
    expect(state.algorithm.ranking.cloned).toBe(true);
    expect(state.algorithm.ml.cloned).toBe(true);
    expect(state.algorithm.ranking.head).toMatch(/^[0-9a-f]{7,}$/);
    expect(state.algorithm.lastSynced).toBe(syncedAt);
  });

  test('next scheduled is the earliest eligible future entry, independent of insertion order', async () => {
    const now = Date.now();
    const earlier = new Date(now + 3600000 + 7 * 3600000).toISOString().replace('Z', '+07:00');
    const later = new Date(now + 7200000).toISOString();
    // Each entry authored by the house's CMO lane — the shape the queue
    // intent writes — so the posture (one house's) counts them.
    await fs.writeFile(QUEUE_PATH, JSON.stringify([
      { status: 'draft', scheduledFor: later },
      { status: 'approved', scheduledFor: earlier },
      { status: 'sent', scheduledFor: new Date(now + 1000).toISOString() },
      { status: 'draft', scheduledFor: new Date(now - 1000).toISOString() },
      { status: 'approved', scheduledFor: 'invalid' },
    ].map((e) => ({ ...e, authorNeumaId: CMO_LANE }))));
    const state = await computePipelineState({ laneId: CMO_LANE, wallet: WALLET });
    expect(state.queue.nextScheduled).toBe(earlier);
    expect(state.queue.counts).toMatchObject({ draft: 2, approved: 2, sent: 1 });
    // Another house, or none, counts none of this house's queue.
    expect((await computePipelineState({ laneId: CMO_LANE, wallet: OTHER_HOUSE })).queue.counts.draft).toBe(0);
    expect((await computePipelineState()).queue.counts.draft).toBe(0);
  });

  test('(d) the designated CMO\'s turn OPENS with the pipeline tools disclosed', async () => {
    await cmoDesignation.designate(WALLET, CMO_LANE);
    const tools = [
      { server: 'fs', name: 'read' },
      { server: 'marketing', name: 'pipeline_state' },
      { server: 'marketing', name: 'campaign_list' },
      { server: 'image', name: 'render_card' },
      { server: 'social', name: 'queue_list' },
      { server: 'system', name: 'tool_search' },
    ].map((t) => ({ ...t, description: t.name, access: 'allowed' }));
    const connection = { walletAddress: WALLET, companion: { neumaId: CMO_LANE } };
    await stashBeingTurnCatalog(connection, tools, []);
    const open = [...connection._turnDisclosedToolIds];
    expect(open).toContain('marketing/pipeline_state');
    expect(open).toContain('image/render_card');
    expect(open).toContain('social/queue_list');
    // tool_search and the fs hands ride separately (disclosedNativeTools'
    // own clauses) — the standing set is the CMO's EXTRA tools, pre-wired.
    expect(open).not.toContain('fs/read');

    // A different lane gets the lazy economy: nothing pre-disclosed; the
    // lazy clause alone wires tool_search + fs hands at render time.
    const other = { walletAddress: WALLET, companion: { neumaId: OTHER_LANE } };
    await stashBeingTurnCatalog(other, tools, []);
    expect([...other._turnDisclosedToolIds]).toEqual([]);

    // The SAME lane id under another operator's wallet is no CMO there.
    const elsewhere = { walletAddress: OTHER_HOUSE, companion: { neumaId: CMO_LANE } };
    await stashBeingTurnCatalog(elsewhere, tools, []);
    expect([...elsewhere._turnDisclosedToolIds]).toEqual([]);
  });

  test('(e) the same lane id in another house is no CMO there, and its plan is its own', async () => {
    await cmoDesignation.designate(WALLET, CMO_LANE);
    const elsewhere = await marketingPlanIntent.validate({ days: PLAN.days }, asLane(CMO_LANE, OTHER_HOUSE));
    expect(elsewhere).toMatchObject({ ok: false, status: 'denied' });
    expect((await (await weeklyPlanStoreFor(OTHER_HOUSE)).load())).toBeNull();
  });
});
