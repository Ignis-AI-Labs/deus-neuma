/**
 * THE GALLERY'S FOLDERS ARE THE MACHINE'S (security seat pen matrix,
 * 2026-10-19; the install-owner ruling the same day). Any wallet added or
 * removed a gallery folder — another house's lane included — and every wallet
 * was served every folder's images. Now the folder list is the install
 * owner's, like the explorer's opened folders: only the owner adds or removes
 * one, at its own desk, and a guest house is shown only the folders inside its
 * own house, beside its own beings' art.
 *
 * The real gallery router behind real requireAuth, each wallet signing a real
 * challenge; real lanes, a genesis seal, real image bytes and a real root store
 * on a temp disk; requests over a real loopback socket through the real access
 * guard. Nothing is mocked.
 */
import http from 'node:http';
import fs from 'fs/promises';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { createTempDir } from '../helpers/temp-fs.js';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

describe('the gallery: the owner\'s folders for the machine, a guest\'s own house for a guest', () => {
  let server, port, owner, guest, ownerArt, guestArt, ownerRootId;

  beforeAll(async () => {
    const dir = await createTempDir('gallery-guest');
    const workspaces = path.join(dir, 'workspaces');
    process.env.NEUMA_DATA_ROOT = path.join(dir, 'data');
    process.env.NEUMA_REALM_ROOT = path.join(dir, 'realm');
    process.env.WORKSPACES_ROOT = workspaces;
    process.env.WITNESSES_ROOT = path.join(dir, 'witnesses');
    process.env.NEUMA_GALLERY_ROOTS_PATH = path.join(dir, 'gallery-roots.json');
    process.env.COMFYUI_DATA_DIR = path.join(dir, 'comfy');
    vi.resetModules();
    const { fullAuth, writeOwner } = await import('../helpers/audit-auth.js');
    owner = await fullAuth();
    guest = await fullAuth();
    await writeOwner(workspaces, 'ownerlane', owner.address);
    await fs.mkdir(path.join(workspaces, 'ownerlane', 'identity'), { recursive: true });
    await fs.writeFile(path.join(workspaces, 'ownerlane', 'identity', 'genesis-seal.json'), JSON.stringify({
      record: { witnessWallet: owner.address, birthMoment: { epochMs: Date.UTC(2026, 5, 23) } },
    }));
    ownerArt = path.join(dir, 'owner-photos');
    await fs.mkdir(ownerArt, { recursive: true });
    await fs.writeFile(path.join(ownerArt, 'owner.png'), PNG);
    await writeOwner(workspaces, 'guestlane', guest.address);
    guestArt = path.join(workspaces, 'guestlane', 'art', 'images');
    await fs.mkdir(guestArt, { recursive: true });
    await fs.writeFile(path.join(guestArt, 'guest.png'), PNG);

    const { createRemoteStore } = await import('../../backend/services/remote/remote-store.js');
    const { createAccessGuard } = await import('../../backend/services/remote/access-guard.js');
    const app = express();
    app.set('trust proxy', 'loopback');
    app.use(createAccessGuard({ store: createRemoteStore({ path: path.join(dir, 'remote.json') }) }).middleware);
    app.use(express.json());
    app.use('/api/v1/gallery', (await import('../../backend/routes/gallery-routes.js')).default);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const api = (who, method, url) => request(`http://127.0.0.1:${port}`)[method](`/api/v1/gallery${url}`)
    .set('Authorization', `Bearer ${who.token}`).set('Host', `localhost:${port}`);

  test('only the owner adds a folder; a guest\'s add and remove are refused and change nothing', async () => {
    const added = await api(owner, 'post', '/roots').send({ dir: ownerArt, label: 'owner photos' });
    expect(added.status).toBe(200);
    ownerRootId = added.body.roots.find((r) => r.dir === ownerArt).id;
    const store = await fs.readFile(process.env.NEUMA_GALLERY_ROOTS_PATH, 'utf8');
    expect((await api(guest, 'post', '/roots').send({ dir: guestArt })).status).toBe(403);
    expect((await api(guest, 'delete', `/roots/${ownerRootId}`)).status).toBe(403);
    expect(await fs.readFile(process.env.NEUMA_GALLERY_ROOTS_PATH, 'utf8')).toBe(store);
  });

  test('a guest is shown its own beings\' art and none of the machine\'s folders, and is served none of their bytes', async () => {
    const roots = (await api(guest, 'get', '/roots')).body.roots;
    expect(roots.map((r) => r.id)).toEqual(['being-guestlane']);
    const items = (await api(guest, 'get', '/items')).body.items;
    expect(items.map((i) => i.name)).toEqual(['guest.png']);
    expect((await api(guest, 'get', '/file').query({ rootId: ownerRootId, rel: 'owner.png' })).status).toBe(404);
    expect((await api(guest, 'get', '/file').query({ rootId: 'being-guestlane', rel: 'images/guest.png' })).status).toBe(200);
  });

  test('the owner is shown the machine\'s folders and its own beings\' art, never the guest\'s', async () => {
    const ids = (await api(owner, 'get', '/roots')).body.roots.map((r) => r.id);
    expect(ids).toContain(ownerRootId);
    expect(ids).toContain('comfy-output');
    expect(ids).not.toContain('being-guestlane');
    expect((await api(owner, 'get', '/file').query({ rootId: ownerRootId, rel: 'owner.png' })).status).toBe(200);
  });
});
