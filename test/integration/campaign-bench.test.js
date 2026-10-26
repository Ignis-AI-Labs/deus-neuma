/**
 * THE CAMPAIGN BENCHMARK (campaign plan slice 13): the real
 * `scripts/campaign-bench.mjs`, run as its own process over a house's records
 * on real tmp disk — two campaigns declared through the real campaign store,
 * accounts through the real account store, a queue written as the store
 * writes it (drafts and history only: no `approved` entry ever) — prints the
 * three scores, the same numbers counted here by hand from the queue file,
 * and leaves every file as it found it. No double anywhere (RULE 0).
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import process from 'process';
import { standTwoHouses, HOUSE_A, LEGACY_ENV } from '../helpers/house-office-kit.js';
import { writeOwner } from '../helpers/audit-auth.js';
import { setAppFields, setAccountFields, setAccountMeta, addAccount } from '../../backend/services/social/account-store.js';
import { campaignStoreFor } from '../../backend/services/marketing/campaign-store.js';
import { campaignContextFor } from '../../backend/services/marketing/campaign-context.js';

const run = promisify(execFile);
const SCRIPT = path.resolve('scripts/campaign-bench.mjs');
const AT = '2026-10-24T09:00:00Z';
const DOORS = ['NEUMA_SOCIAL_POST_QUEUE_PATH', 'NEUMA_SOCIAL_BINDINGS_PATH', 'NEUMA_SECTOR_CREW_PATH', 'NEUMA_SOCIAL_CREDENTIALS_PATH'];
let houses;
let env;
let launch;
let bare;

const snapshot = async (root) => {
  const out = {};
  const walk = async (dir) => {
    for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else out[path.relative(root, p)] = createHash('sha256').update(await fs.readFile(p)).digest('hex');
    }
  };
  await walk(root);
  return out;
};

const entry = (id, fields) => ({
  id, channelId: 'x', scheduledFor: null, campaignId: null, pillar: '', media: [], authorNeumaId: 'core-cmo',
  queuedBy: 'core-cmo', createdAt: '2026-10-12T08:00:00Z', ...fields,
});

beforeAll(async () => {
  houses = await standTwoHouses({ label: 'campaign-bench', lanesA: ['core-cmo'], lanesB: [] });
  for (const [door, name] of DOORS.map((d) => [d, `${d.toLowerCase()}.json`])) process.env[door] = path.join(houses.settings, name);
  await writeOwner(houses.rootA, 'core-cmo', HOUSE_A);
  await setAppFields(HOUSE_A, 'x', { apiKey: 'ph-x-app', apiSecret: 'ph-x-app-secret' });
  await setAccountMeta(HOUSE_A, 'x-1', { companyId: 'ignis' }, ['ignis', 'umbrae']);
  await setAccountFields(HOUSE_A, 'x-1', { accessToken: 'ph-x-token-1', accessSecret: 'ph-x-secret-1' });
  await addAccount(HOUSE_A, 'x', { companyId: 'umbrae' }, ['ignis', 'umbrae']);
  const bench = await campaignStoreFor(HOUSE_A);
  const ctx = await campaignContextFor(HOUSE_A);
  launch = await bench.add({
    name: 'Launch week', company: 'ignis', status: 'active', goal: { kind: 'downloads' },
    kpi: { metric: 'conversions', target: 100, by: '2026-11-15' }, window: { start: '2026-10-20', end: '2026-11-20' },
    angles: ['proof'], subs: [{ account: 'x-1', cadence: 'daily', angles: ['proof'] }],
  }, ctx, HOUSE_A);
  bare = await bench.add({ name: 'Bare', company: 'umbrae', status: 'active' }, ctx, HOUSE_A);
  const op = HOUSE_A;
  await fs.writeFile(process.env.NEUMA_SOCIAL_POST_QUEUE_PATH, JSON.stringify([
    // W42: a sent post the operator approved after two edits of their own.
    entry('e5000000000000a5', { accountId: 'x-1', campaignId: launch.id, angleId: 'proof', text: 'Week one.', status: 'sent',
      decidedBy: op, decidedAt: '2026-10-14T10:00:00Z', sentAt: '2026-10-14T12:00:00Z',
      revisions: [{ at: '2026-10-13T09:00:00Z', by: op, changed: { text: 'a' } }, { at: '2026-10-13T10:00:00Z', by: op, changed: { text: 'b' } }] }),
    // W42: the operator staged one by hand on umbrae's account and declined it.
    entry('e4000000000000a4', { accountId: 'x-2', campaignId: bare.id, text: 'Typed by hand.', status: 'rejected', authorNeumaId: null,
      queuedBy: op, createdAt: '2026-10-15T08:00:00Z', decidedBy: op, decidedAt: '2026-10-15T09:00:00Z' }),
    // W43: two sent — one with a tracked link, one edited with a plain link.
    entry('e1000000000000a1', { accountId: 'x-1', campaignId: launch.id, angleId: 'proof', text: 'Read it https://deusneuma.ai/go/abc123',
      status: 'sent', decidedBy: op, decidedAt: '2026-10-20T10:00:00Z', sentAt: '2026-10-20T12:00:00Z' }),
    entry('e2000000000000a2', { accountId: 'x-1', campaignId: launch.id, pillar: 'proof', text: 'See https://example.com/x', status: 'sent',
      decidedBy: op, decidedAt: '2026-10-21T10:00:00Z', sentAt: '2026-10-21T12:00:00Z',
      revisions: [{ at: '2026-10-21T09:00:00Z', by: op, changed: { text: 'old' } }] }),
    // A draft for the coming week.
    entry('e3000000000000a3', { accountId: 'x-1', campaignId: launch.id, angleId: 'proof', text: 'Coming soon.', status: 'draft',
      scheduledFor: '2026-10-26T09:00:00Z' }),
  ]));
  env = {
    ...process.env,
    NEUMA_DATA_ROOT: path.join(houses.tmp, 'data'),
    NEUMA_REALM_ROOT: houses.realm,
    WORKSPACES_ROOT: houses.rootA,
    ...Object.fromEntries(Object.keys(LEGACY_ENV).map((k) => [k, process.env[k]])),
  };
});

afterAll(() => {
  houses.restore();
  for (const k of DOORS) delete process.env[k];
});

const items = (row) => Object.fromEntries(row.structure.items.map((i) => [i.id, i.met]));

describe('scripts/campaign-bench.mjs — STRUCTURE, HANDS, OUTCOME over real records', () => {
  test('the numbers match the queue counted by hand; missing data reads NOT MEASURED; nothing is written', async () => {
    const before = await snapshot(houses.tmp);
    const { stdout } = await run(process.execPath, [SCRIPT, '--wallet', HOUSE_A, '--at', AT, '--json'], { env, timeout: 60000 });
    const report = JSON.parse(stdout);
    const c1 = report.campaigns.find((c) => c.id === launch.id);
    const c2 = report.campaigns.find((c) => c.id === bare.id);

    // Launch week: declared, its sub complete, 4 of 4 posts tagged, 1 of 2 links coded,
    // the coming week staged; stats and the house check not measured. 4 of 5 = 80%.
    expect(items(c1)).toEqual({ declared: true, subs: true, 'posts-tagged': true, 'links-coded': false, 'next-7-days': true, 'stats-fresh': null, 'house-check': null });
    expect(c1.structure).toMatchObject({ met: 4, measured: 5, share: 80, notMeasured: 2 });
    // Hands: e5 approved + 2 edits, e1 approved, e2 approved + 1 edit = 6 touches over 3 published.
    expect(c1.hands).toMatchObject({ touches: 6, published: 3, per10: 20, byKind: { approved: 3, edited: 3 }, trend: 'falling' });
    expect(c1.hands.weeks).toEqual([
      { week: '2026-W42', touches: 3, published: 1, per10: 30 },
      { week: '2026-W43', touches: 3, published: 2, per10: 15 },
    ]);
    expect(c1.hands.firstTime).toEqual({ approved: 3, unedited: 1, share: 33.3 });
    // Outcome: the window is 4 days of 31 gone; nothing counted yet — "—", never 0.
    expect(c1.outcome).toMatchObject({ kpi: { metric: 'conversions', target: 100 }, timeGone: 13.7, progress: null, perAngle: null, best: null, worst: null });

    // Bare: no goal, no sub, nothing staged; its only post was declined (not live).
    expect(items(c2)).toEqual({ declared: false, subs: false, 'posts-tagged': null, 'links-coded': null, 'next-7-days': false, 'stats-fresh': null, 'house-check': null });
    expect(c2.structure.share).toBe(0);

    // The house: 4 of 8 measured items; 8 touches (the hand-staged decline is 2) over 3 published.
    expect(report.house.structure).toMatchObject({ met: 4, measured: 8, share: 50 });
    expect(report.house.hands).toMatchObject({ touches: 8, published: 3, per10: 26.7, trend: 'falling' });
    // Per company: umbrae's account published nothing — its rate is "—", not 0.
    const umbrae = report.companies.find((c) => c.id === 'umbrae');
    expect(umbrae).toMatchObject({ campaigns: [bare.id], hands: { touches: 2, published: 0, per10: null } });

    const words = (await run(process.execPath, [SCRIPT, '--wallet', HOUSE_A, '--at', AT], { env, timeout: 60000 })).stdout;
    expect(words).toContain('STRUCTURE 80% (4 of 5 met · 2 not measured)');
    expect(words).toContain('NOT MEASURED · Stats under 24 h old for posts under 30 days — no stats are collected in this build yet (the stats sweep)');
    expect(words).toContain('NOT MET · Every linked post carries a tracked code — 1 of 2 linked post(s) carry a tracked code');
    expect(words).toContain('HANDS 20 touches per 10 published (6 touches · 3 published) · approved with no edit 33.3% of 3 · week over week falling');
    // Repeatable: the same records at the same moment give the same report.
    expect(JSON.parse((await run(process.execPath, [SCRIPT, '--wallet', HOUSE_A, '--at', AT, '--json'], { env, timeout: 60000 })).stdout)).toEqual(report);
    expect(await snapshot(houses.tmp)).toEqual(before);
  }, 180000);
});
