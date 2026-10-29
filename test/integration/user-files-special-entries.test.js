import express from 'express';
import request from 'supertest';
import { execFileSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';

/**
 * A folder holding a FIFO, and the honest error class for every read failure
 * (#243, #241).
 *
 * REAL throughout (RULE 0): a real temp directory, a real FIFO made by the real
 * `mkfifo`, the real `listDir` / `readFile` services, and the real router. Only
 * auth and the settings-file write are stubbed, exactly as the sibling
 * `api-user-files.test.js` does — neither is the behaviour under claim.
 */
const FILES = '/api/v1/user/files';

describe('a folder with a special entry, and honest read errors', () => {
  let app;
  let folder;
  let witness;

  beforeEach(async () => {
    vi.resetModules();

    // Imported AFTER resetModules — the token must be minted from the same
    // auth.js instance the router will verify against (memoized HMAC secret
    // per module instance; a stale import 401s honestly).
    // No neuma lane on this router; a real session that claims no workspace
    // is exactly the right shape for the witness's own file browser.
    const { strangerWitness } = await import('../helpers/witness.js');
    witness = strangerWitness();
    await makeInstallOwner(witness.address);
    // The REAL settings module, aimed at a real throwaway file (#390 tranche
    // 3). NEUMA_FILES_SETTINGS_PATH is the module's own isolation door and is
    // read per call, so the persist path runs for real and the operator's
    // live data/settings/user-files.json is never touched.
    process.env.NEUMA_FILES_SETTINGS_PATH = path.join(
      await createTempDir('files-settings'), 'user-files.json');

    const realm = await import('../../backend/services/user-realm.js');
    realm.setRealmRoot(await createTempDir(`special-realm-${Math.random().toString(36).slice(2)}`));

    folder = await createTempDir('special-entries');
    await fs.writeFile(path.join(folder, 'notes.txt'), 'hello\n');
    await fs.mkdir(path.join(folder, 'inner'), { recursive: true });
    // A REAL named pipe — the entry class the listing used to drop entirely.
    execFileSync('mkfifo', [path.join(folder, 'a-pipe')]);

    const files = await import('../../backend/services/user-files.js');
    files.setRoots([folder]);

    const { default: router } = await import('../../backend/routes/user-files-routes.js');
    app = express();
    app.use(express.json());
    app.use(FILES, router);
  });

  test('the FIFO is named in the listing instead of vanishing', async () => {
    const res = await request(app).get(`${FILES}/list`).set(witness.header).query({ path: folder });
    expect(res.status).toBe(200);
    const byName = Object.fromEntries(res.body.entries.map((e) => [e.name, e]));
    expect(Object.keys(byName).sort()).toEqual(['a-pipe', 'inner', 'notes.txt']);
    expect(byName['a-pipe'].type).toBe('special');
    expect(byName.inner.type).toBe('dir');
    expect(byName['notes.txt'].type).toBe('file');
  });

  test('the old ordering contract still holds: dirs first, then files, then special', async () => {
    const res = await request(app).get(`${FILES}/list`).set(witness.header).query({ path: folder });
    expect(res.body.entries.map((e) => e.name)).toEqual(['inner', 'notes.txt', 'a-pipe']);
  });

  test('reading the FIFO refuses as 422 — the caller asked for the wrong thing', async () => {
    // Without the refusal this read would block forever on an empty pipe.
    const res = await request(app).get(`${FILES}/read`).set(witness.header).query({ path: path.join(folder, 'a-pipe') });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/not a text file/i);
  });

  test('reading a directory refuses as 422, not 500', async () => {
    const res = await request(app).get(`${FILES}/read`).set(witness.header).query({ path: path.join(folder, 'inner') });
    expect(res.status).toBe(422);
  });

  test('a missing path is 404 and leaks no errno or absolute path', async () => {
    const missing = path.join(folder, 'no-such-file.txt');
    const read = await request(app).get(`${FILES}/read`).set(witness.header).query({ path: missing });
    expect(read.status).toBe(404);
    expect(read.body.error).toBe('No such path');
    expect(read.body.error).not.toContain(missing);
    expect(read.body.error).not.toMatch(/ENOENT/);

    const list = await request(app).get(`${FILES}/list`).set(witness.header).query({ path: path.join(folder, 'no-dir') });
    expect(list.status).toBe(404);
    expect(list.body.error).toBe('No such path');
  });

  test('a path outside the roots is still 403', async () => {
    const outside = await createTempDir('outside-roots');
    const res = await request(app).get(`${FILES}/list`).set(witness.header).query({ path: outside });
    expect(res.status).toBe(403);
  });

  test('an ordinary text file still reads exactly as before', async () => {
    const res = await request(app).get(`${FILES}/read`).set(witness.header).query({ path: path.join(folder, 'notes.txt') });
    expect(res.status).toBe(200);
    expect(res.body.content).toBe('hello\n');
    expect(res.body.binary).toBe(false);
    expect(res.body.lossy).toBe(false);
  });
});
