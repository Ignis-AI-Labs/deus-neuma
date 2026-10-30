/**
 * /folder-info + roots-race hardening — REAL stack, no mocks (RULE 0).
 *
 * Real Express app mounting the real user-files router behind the REAL auth
 * middleware (challenge → sign → verify → Bearer session token), real
 * filesystem fixtures, and the real settings write — isolated to a temp file
 * via NEUMA_FILES_SETTINGS_PATH (never the live data/settings file). Proves:
 *  - /folder-info classifies an in-root repo (branch), follows a legit
 *    `gitdir:` worktree indirection, refuses anything outside the opened
 *    roots with a flat 403 (no repo oracle), and survives a hostile giant
 *    junk HEAD by reading a bounded slice — a ref planted past the 4KB bound
 *    must NOT be honored (the D9 regression assertion).
 *  - two parallel POST /roots land BOTH roots in memory AND in the persisted
 *    settings file (the T5 lost-update regression, withRootsLock).
 */
import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { realpathSync } from 'fs';
import { describe, test, expect, beforeAll } from 'vitest';
import { generateChallenge, verifySignature, createSessionToken, verifySessionToken } from '../../backend/services/auth.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';
import { setRealmRoot } from '../../backend/services/user-realm.js';
import { createTempDir } from '../helpers/temp-fs.js';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';

// The settings path must be decided BEFORE the router chain evaluates
// user-files-settings.js (it reads the env at module load) — hence the
// dynamic router import in beforeAll.
const SETTINGS_FILE = path.join(
  os.tmpdir(),
  `user-files-settings-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
);
process.env.NEUMA_FILES_SETTINGS_PATH = SETTINGS_FILE;

const makeAuthToken = async () => {
  const keypair = generateKeypair();
  const challenge = generateChallenge(keypair.address);
  const signature = await signMessage(keypair.privateKey, challenge);
  return createSessionToken(verifySignature(keypair.address, challenge, signature));
};

describe('folder-info + roots mutation hardening', () => {
  let app;
  let auth;
  let root;

  beforeAll(async () => {
    root = realpathSync(await createTempDir('folder-info-root'));
    setRealmRoot(await createTempDir('folder-info-realm')); // recents stay off the live realm
    const files = await import('../../backend/services/user-files.js');
    files.setRoots([root]);
    const { default: router } = await import('../../backend/routes/user-files-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/user/files', router);
    const token = await makeAuthToken();
    // A fresh install's first owner is seated by the owner claim, never by a first request (owner-claim.js): seated here.
    await makeInstallOwner(verifySessionToken(token).address);
    auth = { Authorization: `Bearer ${token}` };
  });

  test('rejects an unauthenticated call (real requireAuth)', async () => {
    const res = await request(app).get('/api/v1/user/files/folder-info').query({ path: root });
    expect(res.status).toBe(401);
  });

  test('in-root repo folder → { isRepo: true, branch }', async () => {
    const repo = path.join(root, 'repo');
    await fs.mkdir(path.join(repo, '.git'), { recursive: true });
    await fs.writeFile(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    const res = await request(app).get('/api/v1/user/files/folder-info').set(auth).query({ path: repo });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ isRepo: true, branch: 'main' });
  });

  test('plain in-root folder → { isRepo: false }', async () => {
    const plain = path.join(root, 'plain');
    await fs.mkdir(plain);
    const res = await request(app).get('/api/v1/user/files/folder-info').set(auth).query({ path: plain });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ isRepo: false, branch: null });
  });

  test('gitdir: worktree indirection is preserved', async () => {
    const wt = path.join(root, 'worktree');
    const store = path.join(root, 'gitstore');
    await fs.mkdir(wt);
    await fs.mkdir(store);
    await fs.writeFile(path.join(wt, '.git'), `gitdir: ${store}\n`);
    await fs.writeFile(path.join(store, 'HEAD'), 'ref: refs/heads/wave-2\n');
    const res = await request(app).get('/api/v1/user/files/folder-info').set(auth).query({ path: wt });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ isRepo: true, branch: 'wave-2' });
  });

  test('hostile giant junk HEAD → bounded read, ref past 4KB NOT honored', async () => {
    const wt = path.join(root, 'hostile');
    const store = path.join(root, 'hostile-store');
    await fs.mkdir(wt);
    await fs.mkdir(store);
    await fs.writeFile(path.join(wt, '.git'), `gitdir: ${store}\n`);
    // 5MB of junk, then a valid-looking ref line — an UNBOUNDED reader would
    // parse "evil" out of it; the 4KB-bounded reader must never see it.
    const junk = Buffer.concat([
      Buffer.alloc(5 * 1024 * 1024, 0x78),
      Buffer.from('\nref: refs/heads/evil\n'),
    ]);
    await fs.writeFile(path.join(store, 'HEAD'), junk);
    const started = Date.now();
    const res = await request(app).get('/api/v1/user/files/folder-info').set(auth).query({ path: wt });
    expect(Date.now() - started).toBeLessThan(3000); // bounded: no multi-MB slurp
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ isRepo: true, branch: null });
  });

  test('path outside the opened roots → flat 403 (no oracle)', async () => {
    const res = await request(app).get('/api/v1/user/files/folder-info').set(auth).query({ path: '/root' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Path outside allowed roots' });
  });

  test('in-root FILE (not a directory) → 403', async () => {
    const file = path.join(root, 'a-file.txt');
    await fs.writeFile(file, 'x');
    const res = await request(app).get('/api/v1/user/files/folder-info').set(auth).query({ path: file });
    expect(res.status).toBe(403);
  });

  test('two parallel POST /roots both persist (T5 lost-update regression)', async () => {
    const rootA = realpathSync(await createTempDir('race-root-a'));
    const rootB = realpathSync(await createTempDir('race-root-b'));
    const [resA, resB] = await Promise.all([
      request(app).post('/api/v1/user/files/roots').set(auth).send({ root: rootA }),
      request(app).post('/api/v1/user/files/roots').set(auth).send({ root: rootB }),
    ]);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    const listed = (await request(app).get('/api/v1/user/files/roots').set(auth)).body.roots;
    expect(listed).toContain(rootA);
    expect(listed).toContain(rootB);
    // The PERSISTED settings must carry both — the write itself was the race.
    const persisted = JSON.parse(await fs.readFile(SETTINGS_FILE, 'utf8'));
    expect(persisted.roots).toContain(rootA);
    expect(persisted.roots).toContain(rootB);
  });
});
