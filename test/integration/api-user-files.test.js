import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { createTempDir } from '../helpers/temp-fs.js';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';

/**
 * Integration tests for the user-files browse + recents API. The browse
 * navigator, recents store, roots and settings file are ALL REAL (a temp
 * realm + temp folders + the module's own NEUMA_FILES_SETTINGS_PATH door,
 * #390 tranche 3 — nothing here is mocked). Proves the picker's honest
 * contract: browse lists real sub-dirs, opening a folder records it as
 * recent, and a missing path 404s.
 *
 * Auth is REAL (RULE 0, #390 tranche 4): a real HMAC session token through
 * the real requireAuth. No neuma lane on this router, so a real session that
 * claims no workspace (strangerWitness) is exactly the right shape.
 */
describe('User files browse + recents API', () => {
  let app;
  let tempFolder;
  let setRoots;
  let witness;

  beforeEach(async () => {
    vi.resetModules();

    // Imported AFTER resetModules — the token must be minted from the same
    // auth.js instance the router will verify against (memoized HMAC secret
    // per module instance; a stale import 401s honestly).
    const { strangerWitness } = await import('../helpers/witness.js');
    witness = strangerWitness();
    await makeInstallOwner(witness.address);
    // The REAL settings module through its own per-call door (#390 tranche 3).
    process.env.NEUMA_FILES_SETTINGS_PATH = path.join(
      await createTempDir('files-settings'), 'user-files.json');

    const realm = await import('../../backend/services/user-realm.js');
    // Unique realm per test (createTempDir only suffixes with Date.now()).
    realm.setRealmRoot(await createTempDir(`files-realm-${Math.random().toString(36).slice(2)}`));

    const files = await import('../../backend/services/user-files.js');
    setRoots = files.setRoots;
    setRoots([]); // reset the roots singleton between tests

    const { default: router } = await import('../../backend/routes/user-files-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/user/files', router);

    tempFolder = await createTempDir('files-target');
  });

  afterEach(() => vi.restoreAllMocks());

  test('GET /browse defaults to the home directory', async () => {
    const res = await request(app).get('/api/v1/user/files/browse').set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.path).toBe(path.resolve(os.homedir()));
    expect(Array.isArray(res.body.entries)).toBe(true);
  });

  test('GET /browse lists a folder\'s sub-directories', async () => {
    await fs.mkdir(path.join(tempFolder, 'sub'));
    const res = await request(app).get('/api/v1/user/files/browse').set(witness.header).query({ path: tempFolder });
    expect(res.status).toBe(200);
    expect(res.body.path).toBe(tempFolder);
    expect(res.body.entries.map((e) => e.name)).toContain('sub');
  });

  test('GET /browse 404s on a non-existent path', async () => {
    const res = await request(app).get('/api/v1/user/files/browse').set(witness.header).query({ path: '/does/not/exist/xyz123' });
    expect(res.status).toBe(404);
  });

  test('opening a folder records it under GET /recents', async () => {
    const open = await request(app).post('/api/v1/user/files/roots').set(witness.header).send({ root: tempFolder });
    expect(open.status).toBe(200);
    const res = await request(app).get('/api/v1/user/files/recents').set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.recents).toContain(tempFolder);
  });

  test('POST /roots refuses the home directory', async () => {
    const res = await request(app).post('/api/v1/user/files/roots').set(witness.header).send({ root: os.homedir() });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/Home is not a browse root/);
  });


  test('GET /git-status-many answers every named root in ONE call; escapes answer null', async () => {
    const { execFileSync } = await import('node:child_process');
    execFileSync('git', ['-c', 'init.templateDir=', 'init', '-q', '-b', 'main'], { cwd: tempFolder });
    await fs.writeFile(path.join(tempFolder, 'new.txt'), 'x');
    const plain = await createTempDir('files-plain');
    setRoots([tempFolder, plain]);
    const res = await request(app).get('/api/v1/user/files/git-status-many').set(witness.header)
      .query({ path: [tempFolder, plain, '/etc'] });
    expect(res.status).toBe(200);
    expect(res.body.statuses[tempFolder]).toMatchObject({ isRepo: true, branch: 'main', files: { 'new.txt': 'U' } });
    expect(res.body.statuses[plain]?.isRepo ?? false).toBe(false);
    expect(res.body.statuses['/etc']).toBeNull();
    const none = await request(app).get('/api/v1/user/files/git-status-many').set(witness.header);
    expect(none.status).toBe(400);
  });

  test('GET /drives lists mounted drives including root', async () => {
    const res = await request(app).get('/api/v1/user/files/drives').set(witness.header);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.drives)).toBe(true);
    const root = res.body.drives.find((d) => d.path === '/');
    expect(root).toBeTruthy();
    expect(root.label).toBe('/');
  });
});

// THE TWO-WAY BRIDGE (ruling, 2026-07-28) — upload and raw over the REAL app,
// REAL tmp roots, real disk. Auth is REAL (RULE 0).
describe('User files bridge — /upload + /raw', () => {
  let app;
  let tempFolder;
  let setRoots;
  let witness;

  beforeEach(async () => {
    vi.resetModules();

    const { strangerWitness } = await import('../helpers/witness.js');
    witness = strangerWitness();
    await makeInstallOwner(witness.address);
    // The REAL settings module through its own per-call door (#390 tranche 3).
    process.env.NEUMA_FILES_SETTINGS_PATH = path.join(
      await createTempDir('files-settings'), 'user-files.json');

    const files = await import('../../backend/services/user-files.js');
    setRoots = files.setRoots;
    tempFolder = await createTempDir(`files-bridge-${Math.random().toString(36).slice(2)}`);
    setRoots([tempFolder]);

    const { default: router } = await import('../../backend/routes/user-files-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/user/files', router);
  });

  afterEach(() => vi.restoreAllMocks());

  const BYTES = Buffer.from([0x89, 0x50, 0x4E, 0x47, 1, 2, 3, 4, 5, 6, 7, 8]);

  test('a dropped file lands byte-for-byte inside the folder', async () => {
    const res = await request(app)
      .post('/api/v1/user/files/upload')
      .query({ path: tempFolder, name: 'culture.png' })
      .set('Content-Type', 'application/octet-stream')
      .set(witness.header)
      .send(BYTES);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'culture.png', renamed: false, size: BYTES.length });
    const onDisk = await fs.readFile(path.join(tempFolder, 'culture.png'));
    expect(onDisk.equals(BYTES)).toBe(true);
  });

  test('a name already taken lands SUFFIXED — the drop never clobbers', async () => {
    await fs.writeFile(path.join(tempFolder, 'report.pdf'), 'the original');
    const res = await request(app)
      .post('/api/v1/user/files/upload')
      .query({ path: tempFolder, name: 'report.pdf' })
      .set('Content-Type', 'application/octet-stream')
      .set(witness.header)
      .send(BYTES);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'report (2).pdf', renamed: true });
    // The original stands, byte for byte.
    expect(await fs.readFile(path.join(tempFolder, 'report.pdf'), 'utf8')).toBe('the original');
    expect((await fs.readFile(path.join(tempFolder, 'report (2).pdf'))).equals(BYTES)).toBe(true);
  });

  test('a path-shaped name is refused, not quietly rewritten', async () => {
    for (const name of ['../evil.txt', 'a/b.txt', '..\\up.txt']) {
      const res = await request(app)
        .post('/api/v1/user/files/upload')
        .query({ path: tempFolder, name })
        .set('Content-Type', 'application/octet-stream')
        .set(witness.header)
        .send(BYTES);
      expect(res.status).toBe(400);
    }
    expect((await fs.readdir(tempFolder)).length).toBe(0);
  });

  test('outside the open roots is a flat 403; no bytes, a 400', async () => {
    const escape = await request(app)
      .post('/api/v1/user/files/upload')
      .query({ path: '/tmp', name: 'x.bin' })
      .set('Content-Type', 'application/octet-stream')
      .set(witness.header)
      .send(BYTES);
    expect(escape.status).toBe(403);
    const empty = await request(app)
      .post('/api/v1/user/files/upload')
      .query({ path: tempFolder, name: 'x.bin' })
      .set('Content-Type', 'application/octet-stream')
      .set(witness.header)
      .send(Buffer.alloc(0));
    expect(empty.status).toBe(400);
  });

  test('GET /raw streams the file with an attachment disposition; a directory and an escape are refused', async () => {
    await fs.writeFile(path.join(tempFolder, 'note.txt'), 'the real bytes');
    const ok = await request(app)
      .get('/api/v1/user/files/raw')
      .query({ path: path.join(tempFolder, 'note.txt') })
      .set(witness.header)
      .buffer(true)
      .parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(ok.status).toBe(200);
    expect(ok.headers['content-disposition']).toContain('attachment');
    expect(ok.headers['content-disposition']).toContain('note.txt');
    expect(ok.body.toString('utf8')).toBe('the real bytes');

    await fs.mkdir(path.join(tempFolder, 'afolder'));
    const dir = await request(app).get('/api/v1/user/files/raw').set(witness.header).query({ path: path.join(tempFolder, 'afolder') });
    expect(dir.status).toBe(400);
    const escape = await request(app).get('/api/v1/user/files/raw').set(witness.header).query({ path: '/etc/hostname' });
    expect(escape.status).toBe(403);
    const missing = await request(app).get('/api/v1/user/files/raw').set(witness.header).query({ path: path.join(tempFolder, 'gone.txt') });
    expect(missing.status).toBe(404);
  });
});

// #235 — the editor's conditional save over the REAL route: a stale stamp is
// a 409 that writes nothing; a fresh one lands. Real temp roots, real disk.
describe('User files conditional write — PUT /write (#235)', () => {
  let app;
  let tempFolder;
  let witness;

  beforeEach(async () => {
    vi.resetModules();

    const { strangerWitness } = await import('../helpers/witness.js');
    witness = strangerWitness();
    await makeInstallOwner(witness.address);
    // The REAL settings module through its own per-call door (#390 tranche 3).
    process.env.NEUMA_FILES_SETTINGS_PATH = path.join(
      await createTempDir('files-settings'), 'user-files.json');

    const files = await import('../../backend/services/user-files.js');
    tempFolder = await createTempDir(`files-conflict-${Math.random().toString(36).slice(2)}`);
    files.setRoots([tempFolder]);

    const { default: router } = await import('../../backend/routes/user-files-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/user/files', router);
  });

  afterEach(() => vi.restoreAllMocks());

  test('read → external change → conditional save answers 409 CONFLICT and the disk keeps the external work', async () => {
    const filePath = path.join(tempFolder, 'doc.txt');
    await fs.writeFile(filePath, 'the original');

    const read = await request(app).get('/api/v1/user/files/read').set(witness.header).query({ path: filePath });
    expect(read.status).toBe(200);
    expect(typeof read.body.mtimeMs).toBe('number');

    await fs.writeFile(filePath, 'external work');
    const shifted = new Date(Date.now() + 2000);
    await fs.utimes(filePath, shifted, shifted);

    const stale = await request(app)
      .put('/api/v1/user/files/write')
      .set(witness.header)
      .send({ path: filePath, content: 'stale buffer', expectedMtimeMs: read.body.mtimeMs });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('CONFLICT');
    expect(await fs.readFile(filePath, 'utf8')).toBe('external work');
  });

  test('a fresh stamp lands, and the response carries the next stamp', async () => {
    const filePath = path.join(tempFolder, 'doc.txt');
    await fs.writeFile(filePath, 'the original');
    const read = await request(app).get('/api/v1/user/files/read').set(witness.header).query({ path: filePath });

    const ok = await request(app)
      .put('/api/v1/user/files/write')
      .set(witness.header)
      .send({ path: filePath, content: 'saved by the desk', expectedMtimeMs: read.body.mtimeMs });
    expect(ok.status).toBe(200);
    expect(typeof ok.body.mtimeMs).toBe('number');
    expect(await fs.readFile(filePath, 'utf8')).toBe('saved by the desk');
  });

  test('no stamp → the unconditional write still lands (the being path)', async () => {
    const filePath = path.join(tempFolder, 'doc.txt');
    await fs.writeFile(filePath, 'the original');
    const res = await request(app)
      .put('/api/v1/user/files/write')
      .set(witness.header)
      .send({ path: filePath, content: 'unconditional' });
    expect(res.status).toBe(200);
    expect(await fs.readFile(filePath, 'utf8')).toBe('unconditional');
  });
});
