/**
 * A PROJECT IS ITS HOUSE'S; THE OPENED-FOLDER LIST IS THE MACHINE'S (security
 * seat pen matrix, 2026-10-19; the install-owner ruling the same day). A
 * guest's project used to write its folder into the machine's explorer roots —
 * another house's lane included — bypassing the owner gate on POST /roots.
 * Now a project folder in a lane must be the caller's own being's, only the
 * install owner's project opens a folder for the machine, and a guest's own
 * project still opens in its explorer: for that house alone.
 *
 * The real projects and explorer routers behind real requireAuth, each wallet
 * signing a real challenge; real lanes, a genesis seal, a realm and a settings
 * file on a temp disk; requests over a real loopback socket through the real
 * access guard. Nothing is mocked.
 */
import http from 'node:http';
import fs from 'fs/promises';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { createTempDir } from '../helpers/temp-fs.js';

describe('a guest\'s project opens in its own house, never as a machine folder', () => {
  let server, port, owner, guest, workspaces, ownerLane, guestWork, settingsPath, getRoots;

  beforeAll(async () => {
    const dir = await createTempDir('project-guest-ground');
    workspaces = path.join(dir, 'workspaces');
    settingsPath = path.join(dir, 'user-files.json');
    process.env.NEUMA_DATA_ROOT = path.join(dir, 'data');
    process.env.NEUMA_FILES_SETTINGS_PATH = settingsPath;
    process.env.NEUMA_REALM_ROOT = path.join(dir, 'realm');
    process.env.WORKSPACES_ROOT = workspaces;
    process.env.WITNESSES_ROOT = path.join(dir, 'witnesses');
    vi.resetModules();
    const { fullAuth, writeOwner } = await import('../helpers/audit-auth.js');
    owner = await fullAuth();
    guest = await fullAuth();
    ownerLane = path.join(workspaces, 'ownerlane');
    await writeOwner(workspaces, 'ownerlane', owner.address);
    await fs.mkdir(path.join(ownerLane, 'identity'), { recursive: true });
    await fs.mkdir(path.join(ownerLane, 'art'), { recursive: true });
    // the owner's seal makes it the install's owner (the first sealed being)
    await fs.writeFile(path.join(ownerLane, 'identity', 'genesis-seal.json'), JSON.stringify({
      record: { witnessWallet: owner.address, birthMoment: { epochMs: Date.UTC(2026, 5, 23) } },
    }));
    await writeOwner(workspaces, 'guestlane', guest.address);
    guestWork = path.join(workspaces, 'guestlane', 'work');
    await fs.mkdir(guestWork, { recursive: true });
    await fs.writeFile(path.join(guestWork, 'notes.md'), 'guest project words\n');

    ({ getRoots } = await import('../../backend/services/user-files.js'));
    const app = express();
    app.set('trust proxy', 'loopback');
    const { createRemoteStore } = await import('../../backend/services/remote/remote-store.js');
    const { createAccessGuard } = await import('../../backend/services/remote/access-guard.js');
    app.use(createAccessGuard({ store: createRemoteStore({ path: path.join(dir, 'remote.json') }) }).middleware);
    app.use(express.json());
    app.use('/api/v1/user/projects', (await import('../../backend/routes/user-projects-routes.js')).default);
    app.use('/api/v1/user/files', (await import('../../backend/routes/user-files-routes.js')).default);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const api = (who, method, url) => request(`http://127.0.0.1:${port}`)[method](url)
    .set('Authorization', `Bearer ${who.token}`).set('Host', `localhost:${port}`);
  const machineRoots = async () => {
    const stored = await fs.readFile(settingsPath, 'utf8').then(JSON.parse).catch(() => ({ roots: [] }));
    return { live: getRoots(), stored: stored.roots ?? [] };
  };

  test('a guest\'s project on another house\'s lane is refused, and nothing is recorded or opened', async () => {
    const before = await machineRoots();
    const res = await api(guest, 'post', '/api/v1/user/projects').send({ name: 'borrowed', folder: ownerLane, channel: 'neuma', neumaId: 'guestlane' });
    expect(res.status).toBe(403);
    expect((await api(guest, 'get', '/api/v1/user/projects')).body.projects).toEqual([]);
    expect(await machineRoots()).toEqual(before);
  });

  test('a guest\'s project in its own lane is recorded and opens in its explorer, never in the machine\'s list', async () => {
    const before = await machineRoots();
    const res = await api(guest, 'post', '/api/v1/user/projects').send({ name: 'mine', folder: guestWork, channel: 'neuma', neumaId: 'guestlane' });
    expect(res.status).toBe(200);
    expect(await machineRoots()).toEqual(before);
    expect(getRoots()).not.toContain(guestWork);
    // …and the guest's explorer opens it, for that house alone
    expect((await api(guest, 'get', '/api/v1/user/files/roots')).body.roots).toEqual([guestWork]);
    const list = await api(guest, 'get', '/api/v1/user/files/list').query({ path: guestWork });
    expect(list.status).toBe(200);
    const read = await api(guest, 'get', '/api/v1/user/files/read').query({ path: path.join(guestWork, 'notes.md') });
    expect([read.status, read.body.content]).toEqual([200, 'guest project words\n']);
    // the owner's explorer list is the machine's, and the guest's project is not in it
    expect((await api(owner, 'get', '/api/v1/user/files/roots')).body.roots).not.toContain(guestWork);
  });

  test('attaching another house\'s lane to a guest\'s own project is refused', async () => {
    const { projects } = (await api(guest, 'get', '/api/v1/user/projects')).body;
    const id = projects.find((p) => p.name === 'mine').id;
    const res = await api(guest, 'post', `/api/v1/user/projects/${id}/folders`).send({ path: path.join(ownerLane, 'art') });
    expect(res.status).toBe(403);
    const again = await api(guest, 'post', `/api/v1/user/projects/${id}/folders/reconnect`).send({ path: ownerLane });
    expect(again.status).toBe(403);
    expect(getRoots().some((root) => root.startsWith(ownerLane))).toBe(false);
  });

  test('the install owner\'s project opens its folder for the machine, as before', async () => {
    const res = await api(owner, 'post', '/api/v1/user/projects').send({ name: 'art', folder: path.join(ownerLane, 'art'), channel: 'neuma', neumaId: 'ownerlane' });
    expect(res.status).toBe(200);
    const { live, stored } = await machineRoots();
    expect(live).toContain(path.join(ownerLane, 'art'));
    expect(stored).toContain(path.join(ownerLane, 'art'));
    // and the guest is still not shown it
    expect((await api(guest, 'get', '/api/v1/user/files/roots')).body.roots).toEqual([guestWork]);
  });
});
