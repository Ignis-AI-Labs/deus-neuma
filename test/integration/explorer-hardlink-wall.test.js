/**
 * THE EXPLORER NEVER SERVES A HARD-LINKED TWIN OF A SECRET (security re-check
 * 2026-10-20). The Explorer's walls judged a path by its name and by where
 * its symlinks lead; a hard link has no "where it leads" — notes.txt IS the
 * .env's inode — so /read and /raw served a secret's bytes under the innocent
 * name to any signed-in wallet. The walls now ask secret-inodes.js too.
 *
 * The real router behind real requireAuth (each wallet signs a real
 * challenge), a real git checkout on temp disk opened through the real POST
 * /roots, real hard links. Secret contents are markers built at runtime.
 * Nothing is mocked (RULE 0).
 */
import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { execFileSync } from 'child_process';
import { createTempDir } from '../helpers/temp-fs.js';
import { plant, hardlink, marker } from '../helpers/secret-hardlink-kit.js';

describe('the Explorer serves no hard-linked twin of a secret, to any wallet', () => {
  let app, alpha, beta, folder;
  const marks = {};
  const prior = {};

  beforeAll(async () => {
    const dir = await createTempDir('explorer-hardlink');
    folder = path.join(dir, 'checkout');
    for (const k of ['NEUMA_FILES_SETTINGS_PATH', 'NEUMA_REALM_ROOT', 'WORKSPACES_ROOT']) prior[k] = process.env[k];
    process.env.NEUMA_FILES_SETTINGS_PATH = path.join(dir, 'user-files.json');
    process.env.NEUMA_REALM_ROOT = path.join(dir, 'realm');
    process.env.WORKSPACES_ROOT = path.join(dir, 'workspaces');
    vi.resetModules();
    const { fullAuth } = await import('../helpers/audit-auth.js');
    alpha = await fullAuth();
    beta = await fullAuth();

    await fs.mkdir(folder, { recursive: true });
    execFileSync('git', ['init', '-q', folder]);
    await fs.writeFile(path.join(folder, '.gitignore'), '.env*\n');
    for (const [kind, rel] of [['top', '.env'], ['nested', 'sub/dir/.env']]) {
      marks[kind] = marker(kind);
      await plant(path.join(folder, rel), `API_TOKEN=${marks[kind]}\n`);
    }
    await hardlink(path.join(folder, '.env'), path.join(folder, 'notes.txt'));
    await hardlink(path.join(folder, 'sub', 'dir', '.env'), path.join(folder, 'docs', 'readme.txt'));
    marks.plain = marker('plain');
    await plant(path.join(folder, 'plain-a.txt'), `${marks.plain}\n`);
    await hardlink(path.join(folder, 'plain-a.txt'), path.join(folder, 'plain-b.txt'));

    const { setRealmRoot } = await import('../../backend/services/user-realm.js');
    setRealmRoot(path.join(dir, 'realm'));
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

  afterAll(() => {
    for (const [k, v] of Object.entries(prior)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const as = (who, req) => req.set('Authorization', `Bearer ${who.token}`);
  const read = (who, p) => as(who, request(app).get('/api/v1/user/files/read').query({ path: p }));
  const raw = (who, p) => as(who, request(app).get('/api/v1/user/files/raw').query({ path: p }));

  test('a twin of the checkout\'s .env and of a nested, git-ignored sub/dir/.env never reads, as text or raw', async () => {
    for (const [rel, kind] of [['notes.txt', 'top'], ['docs/readme.txt', 'nested']]) {
      for (const who of [alpha, beta]) {
        const text = await read(who, path.join(folder, rel));
        expect(text.status, rel).toBe(403);
        expect(JSON.stringify(text.body)).not.toContain(marks[kind]);
        const bytes = await raw(who, path.join(folder, rel));
        expect(bytes.status, rel).toBe(403);
        expect(bytes.text || '').not.toContain(marks[kind]);
      }
    }
  });

  test('a twin is never written through (a write would rewrite the secret itself)', async () => {
    const write = await as(beta, request(app).put('/api/v1/user/files/write')).send({ path: path.join(folder, 'notes.txt'), content: 'overwritten\n' });
    expect(write.status).toBe(403);
    expect(await fs.readFile(path.join(folder, '.env'), 'utf8')).toBe(`API_TOKEN=${marks.top}\n`);
  });

  test('an ordinary file with two names reads by either', async () => {
    for (const rel of ['plain-a.txt', 'plain-b.txt']) {
      const res = await read(beta, path.join(folder, rel));
      expect(res.status, rel).toBe(200);
      expect(res.body.content).toBe(`${marks.plain}\n`);
    }
  });
});
