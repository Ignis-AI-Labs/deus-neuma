import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import fsp from 'fs/promises';
import { createTempDir } from '../helpers/temp-fs.js';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';

/**
 * Integration tests for the projects API. The projects service + user-files
 * roots are REAL (a temp realm root + a real temp folder), so we prove the
 * honest contract end to end: creating/activating a project adds its folder to
 * the file-explorer roots (so Files + Terminal point at it), a non-existent
 * folder is refused, and pin/unpin/delete round-trip. Auth is REAL (RULE 0,
 * #390 tranche 4); only the settings-file write is stubbed.
 */
describe('User projects API routes', () => {
  let app;
  let tempFolder;
  let getRoots;
  let setRoots;
  let readProjectStore;
  let witness;

  beforeEach(async () => {
    vi.resetModules();

    // Imported AFTER resetModules — the token must be minted from the same
    // auth.js instance the router will verify against (memoized HMAC secret
    // per module instance; a stale import 401s honestly).
    // No neuma lane on this router; a real session that claims no workspace
    // is exactly the right shape for the witness's own project list.
    const { strangerWitness } = await import('../helpers/witness.js');
    witness = strangerWitness();
    // Opening a project's folder for the machine is the install owner's act
    // (a guest's project stays in its own house — project-guest-ground.test.js):
    // this witness owns the install these tests run on.
    process.env.NEUMA_DATA_ROOT = await createTempDir('proj-data');
    await makeInstallOwner(witness.address);
    // The REAL settings module, aimed at a real throwaway file (#390 tranche
    // 3). NEUMA_FILES_SETTINGS_PATH is the module's own isolation door and is
    // read per call, so the persist path runs for real and the operator's
    // live data/settings/user-files.json is never touched.
    process.env.NEUMA_FILES_SETTINGS_PATH = path.join(
      await createTempDir('files-settings'), 'user-files.json');

    const realm = await import('../../backend/services/user-realm.js');
    realm.setRealmRoot(await createTempDir('proj-realm'));

    const files = await import('../../backend/services/user-files.js');
    getRoots = files.getRoots;
    setRoots = files.setRoots;
    setRoots([]); // reset roots singleton between tests

    ({ readProjectStore } = await import('../../backend/services/user-projects.js'));

    const { default: router } = await import('../../backend/routes/user-projects-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/user/projects', router);

    tempFolder = await createTempDir('proj-target');
  });

  afterEach(() => vi.restoreAllMocks());

  test('POST / creates a project and adds its folder to the file roots', async () => {
    const res = await request(app).post('/api/v1/user/projects').set(witness.header).send({ name: 'Core', folder: tempFolder });
    expect(res.status).toBe(200);
    expect(res.body.project.name).toBe('Core');
    expect(getRoots()).toContain(tempFolder);
  });

  test('the new root really PERSISTS through the real settings writer', async () => {
    // This is what the saveFileSettings mock made unprovable: the route said
    // "saved" and nothing was asked to land. Now the real writer runs against
    // the real (throwaway) settings file, and the real reader reads it back —
    // which also proves the isolation door engaged, since the assertion would
    // otherwise be reading the operator's live file.
    await request(app).post('/api/v1/user/projects').set(witness.header)
      .send({ name: 'Core', folder: tempFolder });

    const onDisk = JSON.parse(await fsp.readFile(process.env.NEUMA_FILES_SETTINGS_PATH, 'utf8'));
    expect(onDisk.roots).toContain(tempFolder);

    const { loadFileSettings } = await import('../../backend/services/user-files-settings.js');
    expect((await loadFileSettings()).roots).toContain(tempFolder);
  });

  test('POST / refuses a non-existent folder (422)', async () => {
    const res = await request(app).post('/api/v1/user/projects').set(witness.header).send({ name: 'X', folder: '/does/not/exist/xyz123' });
    expect(res.status).toBe(422);
  });

  test('POST / refuses a relative folder (400)', async () => {
    const res = await request(app).post('/api/v1/user/projects').set(witness.header).send({ name: 'X', folder: 'relative/path' });
    expect(res.status).toBe(400);
  });

  test('GET / lists projects and the active id', async () => {
    await request(app).post('/api/v1/user/projects').set(witness.header).send({ name: 'Core', folder: tempFolder });
    const res = await request(app).get('/api/v1/user/projects').set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.projects).toHaveLength(1);
    expect(res.body.activeProjectId).toBe(res.body.projects[0].id);
  });

  test('activate re-adds the folder; pin/unpin/delete round-trip', async () => {
    const created = (await request(app).post('/api/v1/user/projects').set(witness.header).send({ name: 'Core', folder: tempFolder })).body.project;
    setRoots([]); // prove activate re-adds the folder

    const act = await request(app).post(`/api/v1/user/projects/${created.id}/activate`).set(witness.header);
    expect(act.status).toBe(200);
    expect(getRoots()).toContain(tempFolder);

    const pin = await request(app).post(`/api/v1/user/projects/${created.id}/chats`).set(witness.header)
      .send({ neumaId: 'n1', companionName: 'Keir', sessionId: 'session-1', label: 'first' });
    expect(pin.status).toBe(200);
    expect(pin.body.project.pinnedChats).toHaveLength(1);

    const unpin = await request(app).delete(`/api/v1/user/projects/${created.id}/chats`).set(witness.header)
      .send({ sessionId: 'session-1', neumaId: 'n1' });
    expect(unpin.body.project.pinnedChats).toHaveLength(0);

    const del = await request(app).delete(`/api/v1/user/projects/${created.id}`).set(witness.header);
    expect(del.status).toBe(200);
    expect((await readProjectStore(witness.address)).projects).toHaveLength(0);
  });

  test('shared files: add a real file, list it, remove it (the UI contract)', async () => {
    const created = (await request(app).post('/api/v1/user/projects').set(witness.header).send({ name: 'Core', folder: tempFolder })).body.project;
    await fs.writeFile(path.join(tempFolder, 'spec.md'), '# spec');

    const add = await request(app).post(`/api/v1/user/projects/${created.id}/files`).set(witness.header).send({ path: 'spec.md' });
    expect(add.status).toBe(200);
    expect(add.body.project.sharedFiles).toHaveLength(1);
    expect(add.body.project.sharedFiles[0].path).toBe(path.join(tempFolder, 'spec.md'));

    const list = await request(app).get('/api/v1/user/projects').set(witness.header);
    expect(list.body.projects[0].sharedFiles).toHaveLength(1);

    const rm = await request(app).delete(`/api/v1/user/projects/${created.id}/files`).set(witness.header)
      .send({ path: path.join(tempFolder, 'spec.md') });
    expect(rm.status).toBe(200);
    expect(rm.body.project.sharedFiles).toHaveLength(0);
  });

  test('shared files: a path outside the project folder is refused (400)', async () => {
    const created = (await request(app).post('/api/v1/user/projects').set(witness.header).send({ name: 'Core', folder: tempFolder })).body.project;
    const res = await request(app).post(`/api/v1/user/projects/${created.id}/files`).set(witness.header).send({ path: '../../etc/passwd' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/inside the project folder/);
  });

  describe('folders (multi-folder / repo attachment)', () => {
    const create = () => request(app).post('/api/v1/user/projects').set(witness.header).send({ name: 'Core', folder: tempFolder });

    test('a git repo folder is enriched with isRepo + branch on GET', async () => {
      const created = (await create()).body.project;
      await fs.mkdir(path.join(tempFolder, '.git'));
      await fs.writeFile(path.join(tempFolder, '.git', 'HEAD'), 'ref: refs/heads/main\n');
      const list = await request(app).get('/api/v1/user/projects').set(witness.header);
      expect(list.body.projects[0].folders[0]).toMatchObject({ path: tempFolder, isRepo: true, branch: 'main' });
      expect(created.id).toBeTruthy();
    });

    test('POST /:id/folders attaches a folder and adds it to the roots', async () => {
      const created = (await create()).body.project;
      const second = await createTempDir('proj-second');
      const res = await request(app).post(`/api/v1/user/projects/${created.id}/folders`).set(witness.header).send({ path: second });
      expect(res.status).toBe(200);
      expect(res.body.project.folders.map((f) => f.path)).toEqual([tempFolder, second]);
      expect(getRoots()).toContain(second);
    });

    test('POST /:id/folders refuses a non-existent directory (422)', async () => {
      const created = (await create()).body.project;
      const res = await request(app).post(`/api/v1/user/projects/${created.id}/folders`).set(witness.header).send({ path: '/does/not/exist/zzz' });
      expect(res.status).toBe(422);
    });

    test('creating a project on a folder owned by another returns 409 with the owner id', async () => {
      const a = (await create()).body.project;
      const res = await request(app).post('/api/v1/user/projects').set(witness.header).send({ name: 'Dup', folder: tempFolder });
      expect(res.status).toBe(409);
      expect(res.body.conflictProjectId).toBe(a.id);
    });

    test('attaching a folder owned by another project returns 409 with the owner id', async () => {
      const a = (await create()).body.project;
      const otherFolder = await createTempDir('proj-owned');
      const b = (await request(app).post('/api/v1/user/projects').set(witness.header).send({ name: 'B', folder: otherFolder })).body.project;
      const res = await request(app).post(`/api/v1/user/projects/${a.id}/folders`).set(witness.header).send({ path: otherFolder });
      expect(res.status).toBe(409);
      expect(res.body.conflictProjectId).toBe(b.id);
    });

    test('POST /:id/cwd sets the working folder among attached folders', async () => {
      const created = (await create()).body.project;
      const second = await createTempDir('proj-second');
      await request(app).post(`/api/v1/user/projects/${created.id}/folders`).set(witness.header).send({ path: second });
      const res = await request(app).post(`/api/v1/user/projects/${created.id}/cwd`).set(witness.header).send({ path: second });
      expect(res.status).toBe(200);
      expect(res.body.project.folder).toBe(second);
    });

    test('GET /folders/resolve reports the owning project (switch-vs-reconnect input)', async () => {
      const created = (await create()).body.project;
      const bound = await request(app).get('/api/v1/user/projects/folders/resolve').set(witness.header).query({ path: tempFolder });
      expect(bound.body.binding).toMatchObject({ id: created.id, isActive: true });
      const unbound = await request(app).get('/api/v1/user/projects/folders/resolve').set(witness.header).query({ path: await createTempDir('proj-free') });
      expect(unbound.body.binding).toBeNull();
    });

    test('POST /:id/folders/reconnect moves a folder here and makes it the cwd', async () => {
      const a = (await create()).body.project;
      const shared = await createTempDir('proj-shared');
      await request(app).post(`/api/v1/user/projects/${a.id}/folders`).set(witness.header).send({ path: shared });
      const b = (await request(app).post('/api/v1/user/projects').set(witness.header).send({ name: 'B', folder: await createTempDir('proj-b') })).body.project;
      const res = await request(app).post(`/api/v1/user/projects/${b.id}/folders/reconnect`).set(witness.header).send({ path: shared });
      expect(res.status).toBe(200);
      expect(res.body.project.folder).toBe(shared);
      const store = await readProjectStore(witness.address);
      expect(store.projects.find((p) => p.id === a.id).folders.map((f) => f.path)).toEqual([tempFolder]);
    });

    test('DELETE /:id/folders detaches a folder (keeps at least one)', async () => {
      const created = (await create()).body.project;
      const second = await createTempDir('proj-second');
      await request(app).post(`/api/v1/user/projects/${created.id}/folders`).set(witness.header).send({ path: second });
      const res = await request(app).delete(`/api/v1/user/projects/${created.id}/folders`).set(witness.header).send({ path: second });
      expect(res.status).toBe(200);
      expect(res.body.project.folders.map((f) => f.path)).toEqual([tempFolder]);
    });
  });
});
