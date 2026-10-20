/**
 * TWO DESKS, TWO HOUSES, ONE MACHINE (RULE 0) — ruling, 2026-10-16: two houses
 * are never confused by the system, at any level.
 *
 * Two REAL backend processes (backend/server.js), the live box's exact shape
 * (two-desks-kit.js): desk A serves house A from the machine's one saved
 * workspace root (WORKSPACES_PIN=settings, the operator's Electron desk), desk B
 * serves house B from its env (WORKSPACES_PIN=env, Claude's house desk). They
 * SHARE data/settings, the realm and the vault, and both start every
 * scheduler. Both houses hold a lane named `hazel`; house B's root holds a
 * ghost `poplar` (a directory and a journal, no owner) — the leak found
 * live. Each desk has its own real loopback model provider, so every model
 * request is counted against the desk that made it.
 *
 * Desk B boots FIRST and alone, so that if it reached for house A at all it
 * would get there before desk A could. Under proof:
 *  - house A's chartered wake runs ONLY on desk A, on house A's hazel; desk B
 *    runs only house B's wake, and never moves house A's queue;
 *  - a due post held by house A's poplar is never claimed or journaled by
 *    desk B (not even into its ghost poplar); desk A publishes it.
 *
 * Defence in depth: since 2026-10-16 Claude's desk runs on its own data root
 * and realm, so live the two desks share no store. This proves that even a
 * shared box never lets one desk's schedulers act in the other's house.
 *
 * Slow on purpose: the post scheduler has no boot tick, so the proof waits
 * out desk B's first minute and then desk A's.
 */
import fs from 'fs/promises';
import path from 'path';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import { startLocalProvider, closedProviderEndpoint } from '../helpers/local-provider.js';
import { sharedBoxEnv, spawnDesk, waitHealthy, stopDesk, until } from '../helpers/two-desks-kit.js';
import neumaWorkspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { writeCharter, approveCharter } from '../../backend/services/house-clock/charter-store.js';
import { enqueueWake, readWakeQueue } from '../../backend/services/house-clock/wake-queue.js';
import { readWakeLedger } from '../../backend/services/house-clock/wake-ledger.js';

const A = ethers.Wallet.createRandom().address.toLowerCase();
const B = ethers.Wallet.createRandom().address.toLowerCase();
const POST_ID = 'house-a-due-post';

const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
const exists = (file) => fs.access(file).then(() => true, () => false);

describe('two desks on one machine never confuse their houses', () => {
  let base, settings, adaRoot, claudeRoot, providerA, providerB, deskA, deskB, previous, healthyB;

  // impure — a lane of one house, as a birth leaves it: workspace, owner, DNA
  const seat = async (root, laneId, wallet, name) => {
    setWorkspacesRoot(root);
    await neumaWorkspace.create(laneId);
    await fs.writeFile(path.join(root, laneId, 'owner.json'), JSON.stringify({ wallet, claimedAt: Date.now() }));
    if (name) await neumaWorkspace.writeDNA(laneId, { version: '1.0.0', identity: { name }, genesis: `# Essence\nI am ${name}.` });
  };

  // impure — a chartered house with one waiting wake for its hazel
  const charterWithWake = async (wallet, ref) => {
    const c = await writeCharter(wallet, {
      goal: 'Prove two houses on one machine are never confused.',
      seats: [{ laneId: 'hazel', dailyCap: 5 }],
    }, { by: wallet, ownedLanes: ['hazel'] });
    await approveCharter(wallet, { version: c.version, by: wallet });
    const queued = await enqueueWake(wallet, { seat: 'hazel', reason: 'post', ref });
    expect(queued.queued).toBe(true);
  };

  beforeAll(async () => {
    base = await createTempDir('two-desks');
    settings = path.join(base, 'data', 'settings');
    adaRoot = path.join(base, 'keeper', 'brookmere');
    claudeRoot = path.join(base, 'claude', 'thornfield');
    previous = { root: getWorkspacesRoot(), realm: getRealmRoot() };

    await seat(adaRoot, 'hazel', A, 'Hazel of A');
    await seat(adaRoot, 'poplar', A, 'Poplar');
    await seat(claudeRoot, 'hazel', B, 'Hazel of B');
    await fs.mkdir(path.join(claudeRoot, 'poplar', 'journal'), { recursive: true }); // the ghost
    setWorkspacesRoot(previous.root);

    setRealmRoot(path.join(base, 'realm'));
    await charterWithWake(A, 'wake-for-house-a');
    await charterWithWake(B, 'wake-for-house-b');

    await fs.mkdir(settings, { recursive: true });
    await fs.writeFile(path.join(settings, 'workspace.json'), JSON.stringify({ root: adaRoot, allocationGB: 10 }));
    await fs.writeFile(path.join(settings, 'social-channel-bindings.json'), JSON.stringify({
      x: { neumaId: 'poplar', boundBy: A, boundAt: new Date().toISOString() },
    }));
    const now = new Date().toISOString();
    await fs.writeFile(path.join(settings, 'social-post-queue.json'), JSON.stringify([{
      id: POST_ID, channelId: 'x', text: 'House A speaks, and only house A.', scheduledFor: new Date(Date.now() - 60000).toISOString(),
      campaignId: null, pillar: '', media: [], authorNeumaId: 'poplar', queuedBy: 'poplar',
      status: 'approved', decidedBy: A, decidedAt: now, createdAt: now,
    }]));
    // The watches' machine state reads fresh and their lists empty: neither
    // desk walks a repo or speaks to an advisory database during the proof.
    await fs.writeFile(path.join(settings, 'security-watch.json'), JSON.stringify({ repos: [], host: { expectedPorts: [] } }));
    await fs.writeFile(path.join(settings, 'security-scan-state.json'), JSON.stringify({ lastRunAt: now, host: null, runs: [] }));
    await fs.writeFile(path.join(settings, 'legal-watch-state.json'), JSON.stringify({ lastRunAt: now, repos: {}, runs: [] }));

    providerA = await startLocalProvider({ reply: 'House A read its post. Nothing waits on the operator.' });
    providerB = await startLocalProvider({ reply: 'House B read its post. Nothing waits on the operator.' });
    const shared = sharedBoxEnv(base, (await closedProviderEndpoint()).endpoint);

    // DESK B ALONE FIRST — Claude's house shape.
    deskB = await spawnDesk({
      name: 'desk-b', base, shared, providerEndpoint: providerB.endpoint,
      env: { WORKSPACES_PIN: 'env', WORKSPACES_ROOT: claudeRoot },
    });
    await waitHealthy(deskB);
    healthyB = Date.now(); // every scheduler starts before the listen
  }, 120000);

  afterAll(async () => {
    stopDesk(deskA);
    stopDesk(deskB);
    await providerA?.close();
    await providerB?.close();
    setWorkspacesRoot(previous.root);
    setRealmRoot(previous.realm);
  });

  test('alone on the box, desk B runs its own house\'s wake and never moves house A\'s queue', async () => {
    const [rowB] = await until(async () => {
      const { rows } = await readWakeLedger(B);
      return rows.length ? rows : null;
    }, 60000, 'house B\'s wake on desk B');
    expect(rowB).toMatchObject({ seat: 'hazel', ref: 'wake-for-house-b', outcome: 'done' });
    expect(providerB.turns.length).toBe(1);
    setWorkspacesRoot(claudeRoot);
    expect(await neumaWorkspace.listSessions('hazel')).toContain(rowB.sessionId);
    setWorkspacesRoot(previous.root);

    // House A's wake still waits, untouched by desk B: no run, no ledger row.
    const queueA = await readWakeQueue(A);
    expect(queueA.items.map((i) => i.ref)).toEqual(['wake-for-house-a']);
    expect(queueA.running).toEqual({});
    expect((await readWakeLedger(A)).total).toBe(0);
  }, 90000);

  test('desk B\'s first scheduler minute passes without claiming or journaling house A\'s post', async () => {
    // Desk A boots well after desk B's schedulers stood, so its first post
    // tick comes well after desk B's.
    await new Promise((r) => setTimeout(r, Math.max(0, healthyB + 15000 - Date.now())));
    deskA = await spawnDesk({
      name: 'desk-a', base, shared: sharedBoxEnv(base, (await closedProviderEndpoint()).endpoint), providerEndpoint: providerA.endpoint,
      env: { WORKSPACES_PIN: 'settings', WORKSPACES_ROOT: path.join(base, 'keeper', 'app-default') },
    });
    const bootedA = Date.now();
    await waitHealthy(deskA);
    // Past desk B's first post tick (60s after its schedulers stood), and
    // still before desk A's (60s after desk A's spawn, at the earliest).
    await new Promise((r) => setTimeout(r, Math.max(0, healthyB + 63000 - Date.now())));
    expect(Date.now() - bootedA).toBeLessThan(59000);
    const [entry] = await readJson(path.join(settings, 'social-post-queue.json'));
    expect(entry.status).toBe('approved'); // desk B never claimed it
    expect(await exists(path.join(claudeRoot, 'poplar', 'journal', 'entries.jsonl'))).toBe(false);
  }, 120000);

  test('desk A runs house A\'s wake on house A\'s hazel, and only desk A\'s model was asked', async () => {
    const [rowA] = await until(async () => {
      const { rows } = await readWakeLedger(A);
      return rows.length ? rows : null;
    }, 60000, 'house A\'s wake on desk A');
    expect(rowA).toMatchObject({ seat: 'hazel', ref: 'wake-for-house-a', outcome: 'done' });
    expect(providerA.turns.length).toBe(1);
    expect(providerB.turns.length).toBe(1); // still only house B's own wake
    setWorkspacesRoot(adaRoot);
    expect(await neumaWorkspace.listSessions('hazel')).toContain(rowA.sessionId);
    setWorkspacesRoot(claudeRoot);
    expect(await neumaWorkspace.listSessions('hazel')).not.toContain(rowA.sessionId);
    setWorkspacesRoot(previous.root);
    expect((await readWakeLedger(B)).total).toBe(1);
  }, 90000);

  test('desk A publishes house A\'s post and journals it into house A\'s poplar — the ghost stays empty', async () => {
    const entry = await until(async () => {
      const [e] = await readJson(path.join(settings, 'social-post-queue.json'));
      return e.status === 'approved' || e.status === 'sending' ? null : e;
    }, 90000, 'desk A\'s first post tick');
    // No X keys on the box: the real poster's honest refusal is the outcome.
    expect(entry.status).toBe('failed');
    expect(entry.error).toContain('not configured');
    expect(await exists(path.join(adaRoot, 'poplar', 'journal', 'entries.jsonl'))).toBe(true);
    expect(await exists(path.join(claudeRoot, 'poplar', 'journal', 'entries.jsonl'))).toBe(false);
    expect(await fs.readdir(path.join(claudeRoot, 'poplar', 'journal'))).toEqual([]);
  }, 120000);
});
