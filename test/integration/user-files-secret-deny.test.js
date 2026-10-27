/**
 * THE EXPLORER'S WALLS (audit 3, E4). The desk's file explorer edits anything
 * inside an opened folder — but never the secrets the platform runs on (.env,
 * keypairs, owner records, credential stores, sealed DNA) and never another
 * house's data (Design note, 2026-10-16: two houses on one machine are never
 * confused), however the path is spelled: directly, through a symlink, or by
 * renaming a secret out from under its name.
 *
 * The real router behind real requireAuth, each wallet signing a real
 * challenge; a real folder on a temp disk opened through the real POST /roots;
 * real lanes and a real realm on temp roots. Nothing is mocked.
 */
import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';

describe('the file explorer never serves or writes secrets or another house\'s data', () => {
  let app, alpha, beta, folder, realm, workspaces;

  beforeAll(async () => {
    const dir = await createTempDir('explorer-walls');
    folder = path.join(dir, 'checkout');
    realm = path.join(folder, 'realm');
    workspaces = path.join(folder, 'workspaces');
    process.env.NEUMA_FILES_SETTINGS_PATH = path.join(dir, 'user-files.json');
    process.env.NEUMA_REALM_ROOT = realm;
    process.env.WORKSPACES_ROOT = workspaces;
    vi.resetModules();
    const { fullAuth, writeOwner } = await import('../helpers/audit-auth.js');
    alpha = await fullAuth();
    beta = await fullAuth();

    await fs.mkdir(path.join(folder, 'keys'), { recursive: true });
    await fs.writeFile(path.join(folder, '.env'), 'AUTH_SECRET=planted-fixture\n');
    await fs.writeFile(path.join(folder, 'keys', 'keypair.json'), '{"privateKey":"planted-fixture"}');
    await fs.writeFile(path.join(folder, 'provider-credentials.json'), '{"planted":"fixture"}');
    await fs.writeFile(path.join(folder, 'notes.txt'), 'ordinary words\n');
    await fs.symlink(path.join(folder, '.env'), path.join(folder, 'innocent.txt'));
    await writeOwner(workspaces, 'alphalane', alpha.address);
    await fs.writeFile(path.join(workspaces, 'alphalane', 'journal.md'), 'alpha house words\n');
    await fs.mkdir(path.join(realm, alpha.address), { recursive: true });
    await fs.writeFile(path.join(realm, alpha.address, 'chat.json'), '{"alpha":"house"}');

    const { setRealmRoot } = await import('../../backend/services/user-realm.js');
    setRealmRoot(realm);
    const { setRoots } = await import('../../backend/services/user-files.js');
    setRoots([]);
    const { default: router } = await import('../../backend/routes/user-files-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/user/files', router);
    const opened = await request(app).post('/api/v1/user/files/roots')
      .set('Authorization', `Bearer ${beta.token}`).send({ root: folder });
    expect(opened.status).toBe(200);
  });

  const as = (who, req) => req.set('Authorization', `Bearer ${who.token}`);
  const read = (who, p) => as(who, request(app).get('/api/v1/user/files/read').query({ path: p }));
  const raw = (who, p) => as(who, request(app).get('/api/v1/user/files/raw').query({ path: p }));

  test('an ordinary file still reads', async () => {
    const res = await read(beta, path.join(folder, 'notes.txt'));
    expect(res.status).toBe(200);
    expect(res.body.content).toBe('ordinary words\n');
  });

  test('.env, a keypair and a credential store never read, as text or raw', async () => {
    for (const p of [path.join(folder, '.env'), path.join(folder, 'keys', 'keypair.json'), path.join(folder, 'provider-credentials.json')]) {
      const text = await read(beta, p);
      expect(text.status).toBe(403);
      expect(JSON.stringify(text.body)).not.toContain('planted-fixture');
      const bytes = await raw(beta, p);
      expect(bytes.status).toBe(403);
      expect(bytes.text || '').not.toContain('planted-fixture');
    }
  });

  test('a symlink to the .env does not read it', async () => {
    const res = await read(beta, path.join(folder, 'innocent.txt'));
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain('planted-fixture');
  });

  test('a secret is never written, created, or renamed away from its name', async () => {
    const write = await as(beta, request(app).put('/api/v1/user/files/write')).send({ path: path.join(folder, '.env'), content: 'AUTH_SECRET=mine\n' });
    expect(write.status).toBe(403);
    const create = await as(beta, request(app).post('/api/v1/user/files/create')).send({ path: path.join(folder, 'keys', 'other.pem'), kind: 'file' });
    expect(create.status).toBe(403);
    const rename = await as(beta, request(app).post('/api/v1/user/files/rename')).send({ from: path.join(folder, 'keys'), to: path.join(folder, 'kz') });
    expect(rename.status).toBe(403);
    expect(await fs.readFile(path.join(folder, '.env'), 'utf8')).toBe('AUTH_SECRET=planted-fixture\n');
    await expect(fs.stat(path.join(folder, 'keys', 'keypair.json'))).resolves.toBeTruthy();
  });

  test('another house\'s lane and realm dir are walled; the owner reads its own', async () => {
    const lane = path.join(workspaces, 'alphalane', 'journal.md');
    const chat = path.join(realm, alpha.address, 'chat.json');
    expect((await read(beta, lane)).status).toBe(403);
    expect((await read(beta, chat)).status).toBe(403);
    expect((await as(beta, request(app).get('/api/v1/user/files/list').query({ path: path.join(realm, alpha.address) }))).status).toBe(403);
    expect((await as(beta, request(app).put('/api/v1/user/files/write')).send({ path: lane, content: 'beta was here' })).status).toBe(403);
    expect(await fs.readFile(lane, 'utf8')).toBe('alpha house words\n');
    expect((await read(alpha, lane)).status).toBe(200);
  });

  test('a respelled path never slips a wall (#589: case, long-s, decomposed forms fold like macOS volumes do)', async () => {
    // Another house's lane, its realm dir and a secret folder, each under a spelling a
    // case-/normalization-insensitive volume opens as the same file.
    const respell = (p) => p.replace('alphalane', 'ALPHALANE');
    const lane = respell(path.join(workspaces, 'alphalane', 'journal.md'));
    expect((await as(beta, request(app).put('/api/v1/user/files/write')).send({ path: lane, content: 'beta was here' })).status).toBe(403);
    const chat = path.join(realm, alpha.address.toUpperCase().replace('0X', '0x'), 'chat.json');
    expect((await as(beta, request(app).put('/api/v1/user/files/write')).send({ path: chat, content: '{}' })).status).toBe(403);
    const longS = path.join(folder, 'keyſ', 'keypair.json');
    expect((await as(beta, request(app).put('/api/v1/user/files/write')).send({ path: longS, content: '{}' })).status).toBe(403);
    const nfd = path.join(folder, '.env').normalize('NFD').replace('.env', '.ENV');
    expect((await as(beta, request(app).put('/api/v1/user/files/write')).send({ path: nfd, content: 'x' })).status).toBe(403);
    expect(await fs.readFile(path.join(workspaces, 'alphalane', 'journal.md'), 'utf8')).toBe('alpha house words\n');
  });

  test('the realm and the neuma home are never deleted or moved through the explorer', async () => {
    const del = await as(alpha, request(app).delete('/api/v1/user/files/entry')).send({ path: realm });
    expect(del.status).toBe(403);
    const move = await as(alpha, request(app).post('/api/v1/user/files/rename')).send({ from: workspaces, to: path.join(folder, 'elsewhere') });
    expect(move.status).toBe(403);
    await expect(fs.stat(path.join(realm, alpha.address, 'chat.json'))).resolves.toBeTruthy();
  });
});
