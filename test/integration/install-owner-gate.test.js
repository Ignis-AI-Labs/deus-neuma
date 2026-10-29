/**
 * THIS COMPUTER'S SETTINGS ARE ITS OWNER'S (Design note, 2026-10-19, ruling D-1). The
 * wallet that set the install up owns the machine-wide settings and may name
 * co-owners; any other wallet is a guest who runs its own house but cannot
 * change the machine; and every machine-wide change also has to come from
 * this computer's own desk, never a paired phone.
 *
 * Real routers behind real requireAuth, each wallet signing a real challenge;
 * real genesis seals on a temp workspaces root (the first one names the
 * owner); the real access guard over a real loopback socket, with a real
 * remote store whose paired device makes a request a phone's; the real
 * settings stores on a temp data root. Nothing is mocked.
 */
import http from 'node:http';
import net from 'node:net';
import fs from 'fs/promises';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { createTempDir } from '../helpers/temp-fs.js';

const ORIGIN = 'desk.tail0d1e.ts.net';

const deadPort = () => new Promise((resolve) => {
  const probe = net.createServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

// impure — a born, sealed lane the way finalize-birth leaves one
const sealLane = async (root, laneId, wallet, epochMs) => {
  const lane = path.join(root, laneId);
  await fs.mkdir(path.join(lane, 'identity'), { recursive: true });
  await fs.mkdir(path.join(lane, 'dna'), { recursive: true });
  await fs.writeFile(path.join(lane, 'dna', 'genesis.md'), '# genesis\n');
  await fs.writeFile(path.join(lane, 'identity', 'genesis-seal.json'), JSON.stringify({
    genesisHash: 'sha256:00', record: { chosenName: laneId, witnessWallet: wallet, birthMoment: { epochMs } },
  }));
  await fs.writeFile(path.join(lane, 'owner.json'), JSON.stringify({ wallet, claimedAt: epochMs }));
};

describe('machine-wide settings belong to the install owner, changed at its own desk', () => {
  let dir, server, port, store, owner, guest, third, phoneSecret, llm, mind, realmApi, core;

  beforeAll(async () => {
    dir = await createTempDir('install-owner');
    process.env.NEUMA_DATA_ROOT = path.join(dir, 'data');
    process.env.WORKSPACES_ROOT = path.join(dir, 'workspaces');
    process.env.WITNESSES_ROOT = path.join(dir, 'witnesses');
    process.env.NEUMA_REALM_ROOT = path.join(dir, 'realm');
    process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(dir, 'provider-credentials.json');
    process.env.NEUMA_WORKSPACE_SETTINGS_PATH = path.join(dir, 'workspace-settings.json');
    process.env.NEUMA_REALM_SETTINGS_PATH = path.join(dir, 'user-realm.json');
    process.env.NEUMA_SUBSTRATE_CLAIM_DIR = path.join(dir, 'claim');
    process.env.LLAMA_SERVER_URL = `http://127.0.0.1:${await deadPort()}`;
    vi.resetModules();
    const { fullAuth } = await import('../helpers/audit-auth.js');
    owner = await fullAuth();
    guest = await fullAuth();
    third = await fullAuth();
    // The guest's being was born too — later. The first genesis names the owner.
    await sealLane(process.env.WORKSPACES_ROOT, 'guestlane', guest.address, Date.UTC(2026, 6, 1));
    await sealLane(process.env.WORKSPACES_ROOT, 'ownerlane', owner.address, Date.UTC(2026, 5, 23));
    const feedLog = (await import('../../backend/services/logger.js')).createLogger('OwnerFeedProof');
    feedLog.warn('owner house bind failed', { neumaId: 'ownerlane', wallet: owner.address });
    feedLog.warn('guest house bind failed', { neumaId: 'guestlane', wallet: guest.address });

    llm = await import('../../backend/services/llm-provider.js');
    mind = (await import('../../backend/services/mind-gate-settings.js')).mindGateSettings;
    realmApi = await import('../../backend/services/user-realm.js');
    core = await import('../../core/index.js');
    const { createRemoteStore } = await import('../../backend/services/remote/remote-store.js');
    const { createAccessGuard } = await import('../../backend/services/remote/access-guard.js');
    const { createRemoteRouter } = await import('../../backend/routes/remote-routes.js');
    const { mintDevice } = await import('../../backend/services/remote/pairing.js');
    store = createRemoteStore({ path: path.join(dir, 'remote.json') });
    const phone = mintDevice({ address: owner.address, label: 'owner phone' });
    phoneSecret = phone.secret;
    await store.save({ enabled: true, origin: ORIGIN, devices: [phone.device, mintDevice({ address: guest.address, label: 'guest phone' }).device] });

    const app = express();
    app.set('trust proxy', 'loopback');
    app.use(createAccessGuard({ store }).middleware);
    app.use(express.json());
    app.use('/api/v1', (await import('../../backend/routes/llm-routes.js')).default);
    app.use('/api/v1/mind', (await import('../../backend/routes/mind-routes.js')).default);
    app.use('/api/v1/routing', (await import('../../backend/routes/routing-routes.js')).default);
    app.use('/api/v1/user/realm', (await import('../../backend/routes/user-realm-routes.js')).default);
    app.use('/api/v1/preflight', (await import('../../backend/routes/preflight-routes.js')).default);
    app.use('/api/v1/web', (await import('../../backend/routes/web-routes.js')).default);
    app.use('/api/v1/substrate', (await import('../../backend/routes/substrate-routes.js')).default);
    app.use('/api/v1/install-owner', (await import('../../backend/routes/install-owner-routes.js')).default);
    app.use('/api/v1/remote', createRemoteRouter({ store }));
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const base = () => `http://127.0.0.1:${port}`;
  const atDesk = (who, req) => req.set('Authorization', `Bearer ${who.token}`).set('Host', `localhost:${port}`);
  const fromPhone = (who, req) => req.set('Authorization', `Bearer ${who.token}`)
    .set('Host', ORIGIN).set('X-Forwarded-For', '100.100.7.9').set('Cookie', `neuma_remote=${phoneSecret}`);

  // Each machine change, with a body that would change it and one its handler refuses.
  const CHANGES = [
    ['put', '/api/v1/llm/provider', { temperature: 0.11 }, { endpoint: 'http://169.254.169.254/' }],
    ['put', '/api/v1/mind/gates', { gate: 'undercurrent', mode: 'live' }, { gate: 'no-such-gate', mode: 'live' }],
    ['put', '/api/v1/routing/providers/openai/key', { apiKey: ['sk', 'guest-key-000000000000'].join('-') }, { endpoint: 7 }],
    ['post', '/api/v1/user/realm/location', { root: '/tmp/x' }, { root: 'relative' }],
    ['post', '/api/v1/preflight/workspace', { root: '/tmp/x', allocationGB: 50 }, { root: 'relative' }],
    ['put', '/api/v1/web/web-access', { enabled: false }, { enabled: 'off' }],
    ['put', '/api/v1/substrate/standby', { enabled: false }, { enabled: 'off' }],
    ['put', '/api/v1/substrate/fit', { sharePct: 85 }, { sharePct: 120 }],
  ];
  const send = (who, place, [method, url], body) => place(who, request(base())[method](url)).send(body);

  test('the first genesis names the owner; every other wallet is a guest', async () => {
    const seen = await atDesk(guest, request(base()).get('/api/v1/install-owner'));
    expect(seen.status).toBe(200);
    expect(seen.body).toMatchObject({ standing: 'guest', owner: owner.address, coOwners: [] });
    const own = await atDesk(owner, request(base()).get('/api/v1/install-owner'));
    expect(own.body.standing).toBe('owner');
  });

  test('a guest at the desk is refused every machine change, out loud, and nothing moves', async () => {
    const before = { temperature: llm.getConfig().temperature, gates: await mind.read(), realm: realmApi.getRealmRoot(), home: core.getWorkspacesRoot() };
    for (const change of CHANGES) {
      const res = await send(guest, atDesk, change, change[2]);
      expect([change[1], res.status, res.body.code]).toEqual([change[1], 403, 'INSTALL_OWNER_ONLY']);
      expect(res.body.error).toMatch(/this computer's settings belong to its owner/i);
    }
    const rotate = await atDesk(guest, request(base()).post('/api/v1/remote/rotate'));
    expect(rotate.status).toBe(403);
    expect(store.get().devices).toHaveLength(2);
    expect(llm.getConfig().temperature).toBe(before.temperature);
    expect(await mind.read()).toEqual(before.gates);
    expect(realmApi.getRealmRoot()).toBe(before.realm);
    expect(core.getWorkspacesRoot()).toBe(before.home);
    await expect(fs.stat(process.env.NEUMA_PROVIDER_CREDENTIALS_PATH)).rejects.toThrow();
  });

  test('the owner from a paired phone is refused; the machine changes only at its own desk', async () => {
    for (const change of CHANGES) {
      const res = await send(owner, fromPhone, change, change[2]);
      expect([change[1], res.status, res.body.code]).toEqual([change[1], 403, 'INSTALL_OWNER_DESK_ONLY']);
    }
    expect(llm.getConfig().temperature).not.toBe(0.11);
  });

  test('the owner at the desk passes the gate to the route itself', async () => {
    for (const change of CHANGES) {
      const res = await send(owner, atDesk, change, change[3]);
      expect([change[1], res.status >= 400 && res.status !== 403]).toEqual([change[1], true]);
    }
    const gate = await send(owner, atDesk, CHANGES[1], CHANGES[1][2]);
    expect(gate.status).toBe(200);
    expect((await mind.read()).undercurrent.mode).toBe('live');
  });

  test('the owner reads the whole failures feed; a guest reads only the machine and its own house', async () => {
    const feed = async (who) => (await atDesk(who, request(base()).get('/api/v1/substrate/telemetry'))).body;
    const whole = await feed(owner);
    expect(whole.failures.map((row) => row.msg)).toEqual(expect.arrayContaining(['owner house bind failed', 'guest house bind failed']));
    expect(whole.failuresWithheld).toBe(0);
    const theirs = await feed(guest);
    expect(theirs.failures.map((row) => row.msg)).toContain('guest house bind failed');
    expect(theirs.failures.map((row) => row.msg)).not.toContain('owner house bind failed');
    expect(theirs.failuresWithheld).toBeGreaterThan(0);
  });

  test('the owner names a co-owner, who may then change the machine; no one else names one', async () => {
    const byGuest = await atDesk(guest, request(base()).post('/api/v1/install-owner/co-owners')).send({ wallet: third.address });
    expect(byGuest.status).toBe(403);
    const named = await atDesk(owner, request(base()).post('/api/v1/install-owner/co-owners')).send({ wallet: guest.address });
    expect(named.status).toBe(200);
    expect(named.body.coOwners).toEqual([guest.address]);
    const byCoOwner = await atDesk(guest, request(base()).post('/api/v1/install-owner/co-owners')).send({ wallet: third.address });
    expect(byCoOwner.status).toBe(403);
    const change = await send(guest, atDesk, CHANGES[5], { enabled: true });
    expect(change.status).toBe(200);
    const removed = await atDesk(owner, request(base()).delete(`/api/v1/install-owner/co-owners/${guest.address}`));
    expect(removed.body.coOwners).toEqual([]);
    expect((await send(guest, atDesk, CHANGES[5], { enabled: false })).status).toBe(403);
  });
});

describe('a fresh install belongs to the first wallet that signs in at its desk', () => {
  let server, port, first, second;

  beforeAll(async () => {
    const dir = await createTempDir('install-owner-fresh');
    process.env.NEUMA_DATA_ROOT = path.join(dir, 'data');
    process.env.WORKSPACES_ROOT = path.join(dir, 'workspaces');
    vi.resetModules();
    const { generateKeypair } = await import('../../core/weave/keypair.js');
    first = generateKeypair();
    second = generateKeypair();
    const { createAuthRouter } = await import('../../backend/services/auth.js');
    const { createAccessGuard } = await import('../../backend/services/remote/access-guard.js');
    const { createRemoteStore } = await import('../../backend/services/remote/remote-store.js');
    const app = express();
    app.use(createAccessGuard({ store: createRemoteStore({ path: path.join(dir, 'remote.json') }) }).middleware);
    app.use(express.json());
    app.use('/api/v1/auth', createAuthRouter(express));
    app.use('/api/v1/install-owner', (await import('../../backend/routes/install-owner-routes.js')).default);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const signIn = async (keypair) => {
    const { signMessage } = await import('../../core/weave/keypair.js');
    const at = `http://127.0.0.1:${port}`;
    const { body } = await request(at).get(`/api/v1/auth/challenge?address=${keypair.address}`).set('Host', `localhost:${port}`);
    const verified = await request(at).post('/api/v1/auth/verify').set('Host', `localhost:${port}`)
      .send({ address: keypair.address, challenge: body.challenge, signature: await signMessage(keypair.privateKey, body.challenge) });
    expect(verified.status).toBe(200);
    return verified.body.token;
  };

  test('the first local sign-in becomes the owner, the second is a guest', async () => {
    const firstToken = await signIn(first);
    const secondToken = await signIn(second);
    const at = `http://127.0.0.1:${port}`;
    const mine = await request(at).get('/api/v1/install-owner').set('Host', `localhost:${port}`).set('Authorization', `Bearer ${firstToken}`);
    expect(mine.body).toMatchObject({ standing: 'owner', owner: first.address.toLowerCase() });
    const theirs = await request(at).get('/api/v1/install-owner').set('Host', `localhost:${port}`).set('Authorization', `Bearer ${secondToken}`);
    expect(theirs.body.standing).toBe('guest');
  });
});

// re-audit 2026-10-29, NEW-L8: a record that parsed but named no valid owner was read as absent and
// re-derived — its co-owners dropped. Now it reads as torn: nothing is rewritten, nothing is guessed.
describe('a damaged owner record is never rewritten', () => {
  test('a record naming no valid owner refuses, keeps its bytes, and hands the machine to no one', async () => {
    const dir = await createTempDir('install-owner-damaged');
    process.env.NEUMA_DATA_ROOT = path.join(dir, 'data');
    process.env.WORKSPACES_ROOT = path.join(dir, 'workspaces');
    vi.resetModules();
    const file = path.join(dir, 'data', 'settings', 'install-owner.json');
    await fs.mkdir(path.dirname(file), { recursive: true });
    const damaged = JSON.stringify({ schema: 'install-owner/1', owner: 'not-a-wallet', coOwners: [`0x${'c'.repeat(40)}`] });
    await fs.writeFile(file, damaged);
    const { readInstallOwner, recordFirstLocalOwner } = await import('../../backend/services/install-owner.js');
    await expect(readInstallOwner()).rejects.toMatchObject({ code: 'INSTALL_OWNER_UNREADABLE' });
    await expect(recordFirstLocalOwner(`0x${'d'.repeat(40)}`)).rejects.toMatchObject({ code: 'INSTALL_OWNER_UNREADABLE' });
    expect(await fs.readFile(file, 'utf8')).toBe(damaged);
  });
});
