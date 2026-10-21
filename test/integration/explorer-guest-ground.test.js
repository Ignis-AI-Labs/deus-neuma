/**
 * THE WHOLE-MACHINE EXPLORER IS THE INSTALL OWNER'S (Design note, 2026-10-19, ruling
 * D-1; audit 3 E4). The owner browses every folder it opened, and only the
 * owner opens or closes one — at this computer's own desk. A guest reaches
 * its own house and nothing else: its lanes, its realm dir, its house ground.
 * The folders a guest is shown, and the paths it may name — directly or
 * through a symlink — are cut to that.
 *
 * The real router behind real requireAuth, each wallet signing a real
 * challenge; real folders, lanes, a genesis seal and a realm on a temp disk;
 * the real access guard over a real loopback socket, with a real paired
 * device for the phone. Nothing is mocked.
 */
import http from 'node:http';
import fs from 'fs/promises';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { createTempDir } from '../helpers/temp-fs.js';

const ORIGIN = 'desk.tail0d3e.ts.net';

describe('the explorer reaches the whole machine for its owner, a guest\'s own house for a guest', () => {
  let server, port, owner, guest, phoneSecret, projects, workspaces, guestLane;

  beforeAll(async () => {
    const dir = await createTempDir('explorer-ground');
    projects = path.join(dir, 'projects');
    workspaces = path.join(dir, 'workspaces');
    guestLane = path.join(workspaces, 'guestlane');
    process.env.NEUMA_DATA_ROOT = path.join(dir, 'data');
    process.env.NEUMA_FILES_SETTINGS_PATH = path.join(dir, 'user-files.json');
    process.env.NEUMA_REALM_ROOT = path.join(dir, 'realm');
    process.env.WORKSPACES_ROOT = workspaces;
    process.env.WITNESSES_ROOT = path.join(dir, 'witnesses');
    vi.resetModules();
    const { fullAuth, writeOwner } = await import('../helpers/audit-auth.js');
    owner = await fullAuth();
    guest = await fullAuth();
    await writeOwner(workspaces, 'ownerlane', owner.address);
    await fs.mkdir(path.join(workspaces, 'ownerlane', 'identity'), { recursive: true });
    await fs.writeFile(path.join(workspaces, 'ownerlane', 'identity', 'genesis-seal.json'), JSON.stringify({
      record: { witnessWallet: owner.address, birthMoment: { epochMs: Date.UTC(2026, 5, 23) } },
    }));
    await writeOwner(workspaces, 'guestlane', guest.address);
    await fs.writeFile(path.join(guestLane, 'journal.md'), 'guest house words\n');
    await fs.mkdir(projects, { recursive: true });
    await fs.writeFile(path.join(projects, 'plan.md'), 'the owner\'s plan\n');
    await fs.symlink(path.join(projects, 'plan.md'), path.join(guestLane, 'borrowed.md'));

    const { setRoots } = await import('../../backend/services/user-files.js');
    setRoots([projects, workspaces]);
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
    app.use('/api/v1/user/files', (await import('../../backend/routes/user-files-routes.js')).default);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const base = () => `http://127.0.0.1:${port}/api/v1/user/files`;
  const atDesk = (who, req) => req.set('Authorization', `Bearer ${who.token}`).set('Host', `localhost:${port}`);
  const fromPhone = (who, req) => req.set('Authorization', `Bearer ${who.token}`)
    .set('Host', ORIGIN).set('X-Forwarded-For', '100.100.7.9').set('Cookie', `neuma_remote=${phoneSecret}`);
  const read = (who, p) => atDesk(who, request(base()).get('/read').query({ path: p }));

  test('the owner reads the folders it opened', async () => {
    const res = await read(owner, path.join(projects, 'plan.md'));
    expect(res.status).toBe(200);
    const roots = await atDesk(owner, request(base()).get('/roots'));
    expect(roots.body.roots).toEqual([projects, workspaces]);
  });

  test('a guest is shown none of the owner\'s folders and reads none of them', async () => {
    const roots = await atDesk(guest, request(base()).get('/roots'));
    expect(roots.body.roots).toEqual([]);
    const plan = await read(guest, path.join(projects, 'plan.md'));
    expect(plan.status).toBe(403);
    expect(JSON.stringify(plan.body)).not.toContain('the owner');
    expect((await atDesk(guest, request(base()).get('/list').query({ path: workspaces }))).status).toBe(403);
    expect((await atDesk(guest, request(base()).get('/browse'))).status).toBe(403);
    expect((await atDesk(guest, request(base()).get('/browse').query({ path: projects }))).status).toBe(403);
  });

  test('a guest reaches its own lane, but not through a symlink out of it', async () => {
    const own = await read(guest, path.join(guestLane, 'journal.md'));
    expect(own.status).toBe(200);
    expect(own.body.content).toBe('guest house words\n');
    const borrowed = await read(guest, path.join(guestLane, 'borrowed.md'));
    expect(borrowed.status).toBe(403);
  });

  test('only the owner opens a folder for the machine, and only at its own desk', async () => {
    const byGuest = await atDesk(guest, request(base()).post('/roots')).send({ root: projects });
    expect(byGuest.status).toBe(403);
    const closeByGuest = await atDesk(guest, request(base()).delete('/roots')).send({ root: projects });
    expect(closeByGuest.status).toBe(403);
    const byPhone = await fromPhone(owner, request(base()).delete('/roots')).send({ root: projects });
    expect([byPhone.status, byPhone.body.code]).toEqual([403, 'INSTALL_OWNER_DESK_ONLY']);
    const roots = await atDesk(owner, request(base()).get('/roots'));
    expect(roots.body.roots).toEqual([projects, workspaces]);
  });
});
