/**
 * A READ NEVER CLAIMS A LANE (Design note, 2026-10-19, ruling D-2; audit 3 E3). A
 * lane belongs to the wallet its genesis seal names; a lane with no seal is
 * adopted only by the install owner, deliberately, at this computer's own
 * desk. Reading a lane — a REST GET, a portal bind — answers for an
 * unclaimed lane and writes nothing.
 *
 * Real routers behind real requireAuth, each wallet signing a real challenge;
 * real lanes, seals and owner.json on a temp workspaces root (the first seal
 * names the install owner); the real access guard over a real loopback
 * socket, with a real paired device for the phone. Nothing is mocked.
 */
import http from 'node:http';
import fs from 'fs/promises';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { createTempDir } from '../helpers/temp-fs.js';

const ORIGIN = 'desk.tail0d2e.ts.net';

// impure — a born lane; sealed to `wallet` when one is named, else unsealed
const bornLane = async (root, laneId, { wallet = null, epochMs = 0, owned = false } = {}) => {
  const lane = path.join(root, laneId);
  await fs.mkdir(path.join(lane, 'dna'), { recursive: true });
  await fs.writeFile(path.join(lane, 'dna', 'genesis.md'), '# genesis\n');
  if (wallet) {
    await fs.mkdir(path.join(lane, 'identity'), { recursive: true });
    await fs.writeFile(path.join(lane, 'identity', 'genesis-seal.json'), JSON.stringify({
      genesisHash: 'sha256:00', record: { chosenName: laneId, witnessWallet: wallet, birthMoment: { epochMs } },
    }));
  }
  if (owned) await fs.writeFile(path.join(lane, 'owner.json'), JSON.stringify({ wallet, claimedAt: epochMs }));
};

const ownerOf = (root, laneId) => fs.readFile(path.join(root, laneId, 'owner.json'), 'utf8').then(JSON.parse).catch(() => null);

describe('a lane is claimed deliberately, never by a read', () => {
  let root, server, port, owner, guest, phoneSecret, ownsNeumaLane;

  beforeAll(async () => {
    const dir = await createTempDir('lane-claim');
    root = path.join(dir, 'workspaces');
    process.env.NEUMA_DATA_ROOT = path.join(dir, 'data');
    process.env.WORKSPACES_ROOT = root;
    process.env.WITNESSES_ROOT = path.join(dir, 'witnesses');
    process.env.NEUMA_REALM_ROOT = path.join(dir, 'realm');
    vi.resetModules();
    const { fullAuth } = await import('../helpers/audit-auth.js');
    owner = await fullAuth();
    guest = await fullAuth();
    await bornLane(root, 'ownerlane', { wallet: owner.address, epochMs: Date.UTC(2026, 5, 23), owned: true });
    await bornLane(root, 'guestborn', { wallet: guest.address, epochMs: Date.UTC(2026, 6, 1) });
    await bornLane(root, 'orphan');

    ({ ownsNeumaLane } = await import('../../backend/routes/portal-context.js'));
    const { createRemoteStore } = await import('../../backend/services/remote/remote-store.js');
    const { createAccessGuard } = await import('../../backend/services/remote/access-guard.js');
    const { mintDevice } = await import('../../backend/services/remote/pairing.js');
    const store = createRemoteStore({ path: path.join(dir, 'remote.json') });
    const phone = mintDevice({ address: owner.address, label: 'owner phone' });
    phoneSecret = phone.secret;
    await store.save({ enabled: true, origin: ORIGIN, devices: [phone.device] });

    const app = express();
    app.set('trust proxy', 'loopback');
    app.use(createAccessGuard({ store }).middleware);
    app.use(express.json());
    app.use('/api/v1/workspace', (await import('../../backend/routes/workspace-routes.js')).default);
    app.use('/api/v1/lanes', (await import('../../backend/routes/lane-claim-routes.js')).default);
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
  const claim = (who, laneId, place = atDesk) => place(who, request(base()).post(`/api/v1/lanes/${laneId}/claim`));

  test('a GET on an unclaimed lane answers unclaimed and writes no owner — for anyone', async () => {
    for (const who of [owner, guest]) {
      for (const laneId of ['guestborn', 'orphan']) {
        const res = await atDesk(who, request(base()).get(`/api/v1/workspace/${laneId}/pins`));
        expect([laneId, res.status, res.body.code]).toEqual([laneId, 404, 'LANE_UNCLAIMED']);
        expect(await ownerOf(root, laneId)).toBeNull();
      }
    }
  });

  test('a portal bind is a read: it refuses an unclaimed lane and claims nothing', async () => {
    expect(await ownsNeumaLane({ walletAddress: guest.address }, 'guestborn')).toBe(false);
    expect(await ownerOf(root, 'guestborn')).toBeNull();
  });

  test('a sealed lane is claimed only by the wallet its seal names', async () => {
    const wrong = await claim(owner, 'guestborn');
    expect(wrong.status).toBe(403);
    expect(wrong.body.reason).toBe('sealed-to-another');
    expect(await ownerOf(root, 'guestborn')).toBeNull();

    const right = await claim(guest, 'guestborn');
    expect(right.status).toBe(200);
    expect((await ownerOf(root, 'guestborn')).wallet).toBe(guest.address);
    expect((await atDesk(guest, request(base()).get('/api/v1/workspace/guestborn/pins'))).status).toBe(200);
    expect((await atDesk(owner, request(base()).get('/api/v1/workspace/guestborn/pins'))).status).toBe(403);
  });

  test('an unsealed lane is adopted only by the install owner, at its own desk', async () => {
    const byGuest = await claim(guest, 'orphan');
    expect([byGuest.status, byGuest.body.code]).toEqual([403, 'INSTALL_OWNER_ONLY']);
    const byPhone = await claim(owner, 'orphan', fromPhone);
    expect([byPhone.status, byPhone.body.code]).toEqual([403, 'INSTALL_OWNER_DESK_ONLY']);
    expect(await ownerOf(root, 'orphan')).toBeNull();

    const adopted = await claim(owner, 'orphan');
    expect(adopted.status).toBe(200);
    expect((await ownerOf(root, 'orphan')).wallet).toBe(owner.address);
    const again = await claim(guest, 'orphan');
    expect(again.status).toBe(403);
    expect((await ownerOf(root, 'orphan')).wallet).toBe(owner.address);
  });
});
