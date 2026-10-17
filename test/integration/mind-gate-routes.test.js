// Actual mind settings, signed HTTP and ownership records on private disk.
// Fresh installs start undercurrent live; corrupt records fail closed.

import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { createMindGateSettings, resolveMindGates } from '../../backend/services/mind-gate-settings.js';

const WALLET = '0xtest-operator';

describe('mind gates — the store law (real disk)', () => {
  test('an ABSENT file is a fresh install: undercurrent LIVE by default (Founder-signed 2026-08-31), unlocked', async () => {
    const dir = await createTempDir('mind-gates-store');
    const store = createMindGateSettings({ path: path.join(dir, 'absent.json'), env: () => ({}) });
    expect(await store.read()).toEqual({
      undercurrent: { mode: 'live', envLocked: false },
      depthFilter: { mode: 'off', envLocked: false },
      memoryLinks: { mode: 'live', envLocked: false },
    });
  });

  test('a TORN record rests the undercurrent off — a broken file never widens influence', async () => {
    const dir = await createTempDir('mind-gates-torn');
    const file = path.join(dir, 'mind.json');
    await fs.writeFile(file, '{not json', 'utf8');
    const store = createMindGateSettings({ path: file, env: () => ({}) });
    expect(await store.read()).toEqual({
      undercurrent: { mode: 'off', envLocked: false },
      depthFilter: { mode: 'off', envLocked: false },
      // links narrow what reaches the being — the core default stands
      memoryLinks: { mode: 'live', envLocked: false },
    });
  });

  test('the env wins and LOCKS; the desk switch refuses with the lock named', async () => {
    const dir = await createTempDir('mind-gates-lock');
    const store = createMindGateSettings({
      path: path.join(dir, 'mind.json'),
      env: () => ({ undercurrent: 'live' }),
    });
    const gates = await store.read();
    expect(gates.undercurrent).toEqual({ mode: 'live', envLocked: true });
    expect(gates.depthFilter.envLocked).toBe(false);
    await expect(store.setGate('undercurrent', 'off')).rejects.toThrow(/NEUMA_UNDERCURRENT/);
  });

  test('the switch persists, echoes, and only exact modes opt in from disk', async () => {
    const dir = await createTempDir('mind-gates-set');
    const file = path.join(dir, 'mind.json');
    const store = createMindGateSettings({ path: file, env: () => ({}) });
    const echo = await store.setGate('undercurrent', 'shadow', { wallet: WALLET });
    expect(echo.undercurrent.mode).toBe('shadow');
    // a second store over the same file reads the persisted truth
    const again = createMindGateSettings({ path: file, env: () => ({}) });
    expect((await again.read()).undercurrent.mode).toBe('shadow');
    // a hand-edited record cannot smuggle depth live in — exact opt-in
    expect(resolveMindGates({ depthFilter: 'live' }).depthFilter.mode).toBe('off');
    expect(resolveMindGates({ undercurrent: 'maybe' }).undercurrent.mode).toBe('off');
  });

  test('memory links: LIVE by default (Design note, 2026-10-06: core architecture), off only by exact choice, held by NEUMA_MEMORY_LINKS', async () => {
    const dir = await createTempDir('mind-gates-links');
    const file = path.join(dir, 'mind.json');
    const store = createMindGateSettings({ path: file, env: () => ({}) });
    expect((await store.read()).memoryLinks).toEqual({ mode: 'live', envLocked: false });
    expect((await store.setGate('memoryLinks', 'off', { wallet: WALLET })).memoryLinks.mode).toBe('off');
    expect((await createMindGateSettings({ path: file, env: () => ({}) }).read()).memoryLinks.mode).toBe('off');
    expect((await store.setGate('memoryLinks', 'live', { wallet: WALLET })).memoryLinks.mode).toBe('live');
    await expect(store.setGate('memoryLinks', 'shadow')).rejects.toThrow(/not a mode/);
    expect(resolveMindGates({ memoryLinks: 'yes' }).memoryLinks.mode).toBe('live');
    expect(resolveMindGates({ memoryLinks: 'off' }).memoryLinks.mode).toBe('off');
    const locked = createMindGateSettings({ path: file, env: () => ({ memoryLinks: 'off' }) });
    expect((await locked.read()).memoryLinks).toEqual({ mode: 'off', envLocked: true });
    await expect(locked.setGate('memoryLinks', 'live')).rejects.toThrow(/NEUMA_MEMORY_LINKS/);
  });

  test('depth-filter live is refused BY NAME, and unknown gates/modes refuse', async () => {
    const dir = await createTempDir('mind-gates-refuse');
    const store = createMindGateSettings({ path: path.join(dir, 'mind.json'), env: () => ({}) });
    await expect(store.setGate('depthFilter', 'live')).rejects.toThrow(/not built/);
    await expect(store.setGate('subconscious', 'on')).rejects.toThrow(/unknown gate/);
    await expect(store.setGate('undercurrent', 'on')).rejects.toThrow(/not a mode/);
    // The env hard-lock cannot summon a depth live either — nothing consumes
    // it, so the bury law rests it off while keeping the lock visible (IL-004).
    const envStore = createMindGateSettings({
      path: path.join(dir, 'env.json'),
      env: () => ({ depthFilter: 'live' }),
    });
    expect(await envStore.read()).toMatchObject({ depthFilter: { mode: 'off', envLocked: true } });
  });
});

describe('Mind API', () => {
  let app, workspace, neumaId, prevEnv, witness, oldRoot, realmState;

  beforeEach(async () => {
    vi.resetModules();

    const dir = await createTempDir(`mind-api-${Math.random().toString(36).slice(2)}`);
    prevEnv = {
      settings: process.env.NEUMA_MIND_SETTINGS_PATH,
      key: process.env.DNA_ENCRYPTION_KEY,
      uc: process.env.NEUMA_UNDERCURRENT,
      df: process.env.NEUMA_DEPTH_FILTER,
      shadow: process.env.NEUMA_MIND_SHADOW_PATH,
    };
    process.env.NEUMA_MIND_SETTINGS_PATH = path.join(dir, 'mind.json');
    process.env.NEUMA_MIND_SHADOW_PATH = path.join(dir, 'shadow.jsonl');
    const realm = await import('../../backend/services/user-realm.js');
    realmState = { root: realm.getRealmRoot(), restore: realm.setRealmRoot };
    realm.setRealmRoot(path.join(dir, 'realm'));
    process.env.DNA_ENCRYPTION_KEY = 'gnosis-mind-api-key-long-enough-xxx';
    delete process.env.NEUMA_UNDERCURRENT;
    delete process.env.NEUMA_DEPTH_FILTER;

    const neuma = await import('../../core/index.js');
    workspace = neuma.neumaWorkspace;
    oldRoot = workspace.root;
    workspace.root = path.join(dir, 'workspaces');
    neumaId = 'test-being-mind-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(neumaId);
    await workspace.writeDNA(neumaId, { identity: { name: 'Test Being' } });

    // Imported AFTER resetModules so the helper mints its token from the same
    // auth.js instance the router will verify against.
    const { fullAuth, writeOwner } = await import('../helpers/audit-auth.js');
    const auth = await fullAuth();
    await writeOwner(workspace.root, neumaId, auth.address);
    witness = { header: { Authorization: `Bearer ${auth.token}` } };

    const { default: router } = await import('../../backend/routes/mind-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/mind', router);
  });

  afterEach(() => {
    workspace.root = oldRoot;
    realmState.restore(realmState.root);
    vi.restoreAllMocks();
    for (const [key, env] of [
      ['NEUMA_MIND_SETTINGS_PATH', prevEnv.settings],
      ['DNA_ENCRYPTION_KEY', prevEnv.key],
      ['NEUMA_UNDERCURRENT', prevEnv.uc],
      ['NEUMA_DEPTH_FILTER', prevEnv.df],
      ['NEUMA_MIND_SHADOW_PATH', prevEnv.shadow],
    ]) {
      if (env === undefined) delete process.env[key];
      else process.env[key] = env;
    }
  });

  test('GET / reports the gates true modes and the shadow rings fill', async () => {
    const res = await request(app).get('/api/v1/mind').set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.gates).toMatchObject({
      // The settings path is an ABSENT file: the 2026-08-31 fresh-install
      // default is undercurrent LIVE (the working-band harvest).
      undercurrent: { mode: 'live', envLocked: false },
      depthFilter: { mode: 'off', envLocked: false },
    });
    // Two halves, because they answer different questions: `live` is this
    // process's ring (empty on a fresh boot, honestly), `sinceFirstRun` is the
    // persisted log the sittings law is actually decided from.
    expect(res.body.shadow.undercurrent.live).toHaveProperty('entries');
    expect(res.body.shadow.undercurrent.sinceFirstRun).toHaveProperty('entries');
    expect(res.body.shadow.depth.live).toHaveProperty('entries');
    expect(res.body.shadow.depth.sinceFirstRun).toHaveProperty('entries');
  });

  test('PUT /gates flips on server echo and the readback holds', async () => {
    const res = await request(app).put('/api/v1/mind/gates').set(witness.header).send({ gate: 'undercurrent', mode: 'shadow' });
    expect(res.status).toBe(200);
    expect(res.body.gates.undercurrent.mode).toBe('shadow');
    const back = await request(app).get('/api/v1/mind').set(witness.header);
    expect(back.body.gates.undercurrent.mode).toBe('shadow');
  });

  test('the env lock and the depth-live law refuse 409 with their own words', async () => {
    process.env.NEUMA_UNDERCURRENT = 'shadow';
    const locked = await request(app).put('/api/v1/mind/gates').set(witness.header).send({ gate: 'undercurrent', mode: 'live' });
    expect(locked.status).toBe(409);
    expect(locked.body.error).toMatch(/NEUMA_UNDERCURRENT/);
    const depthLive = await request(app).put('/api/v1/mind/gates').set(witness.header).send({ gate: 'depthFilter', mode: 'live' });
    expect(depthLive.status).toBe(409);
    expect(depthLive.body.error).toMatch(/not built/);
    const malformed = await request(app).put('/api/v1/mind/gates').set(witness.header).send({ gate: 'undercurrent' });
    expect(malformed.status).toBe(400);
  });

  test('GET /:neumaId is owner-gated counts-only — contents never ride', async () => {
    const { WorkspaceAdapter } = await import('../../core/continuity/adapters/workspace.js');
    const { writeMindRecord } = await import('../../core/continuity/mind/mind-store.js');
    const adapter = new WorkspaceAdapter(neumaId, { workspace });
    await writeMindRecord(adapter, { phrase: 'the ceremony felt unfinished', kind: 'mood', source: { kind: 'residue' } });
    await writeMindRecord(adapter, { phrase: 'keep circling the vault question', kind: 'thread', source: { kind: 'mind_note' } });

    const res = await request(app).get(`/api/v1/mind/${neumaId}`).set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ neumaId, total: 2, kinds: { mood: 1, thread: 1 } });
    expect(res.body.latestAt).toBeTruthy();
    // counts only — the being's words stay beneath its turns
    expect(JSON.stringify(res.body)).not.toContain('ceremony felt unfinished');

    const foreignId = 'test-being-foreign-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(foreignId);
    await fs.writeFile(
      path.join(workspace.root, foreignId, 'owner.json'),
      JSON.stringify({ wallet: '0xsomeone-else', claimedAt: new Date().toISOString() }),
    );
    const foreign = await request(app).get(`/api/v1/mind/${foreignId}`).set(witness.header);
    expect(foreign.status).toBe(403);
  });

  test('real auth stands at the door — no token is 401', async () => {
    const res = await request(app).get('/api/v1/mind');
    expect(res.status).toBe(401);
  });
});
