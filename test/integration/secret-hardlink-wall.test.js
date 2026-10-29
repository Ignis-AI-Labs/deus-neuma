/**
 * A HARD LINK NEVER LAUNDERS A SECRET (security re-check 2026-10-20, the
 * residual of 36ab6b7dd). A hard link made outside the being gives a secret's
 * bytes a second, innocent name — notes.txt, same inode as .env — and every
 * wall judged by name read it. The identity law (secret-inodes.js) refuses
 * any multi-link file whose inode is a known secret's: fs/read, fs/search by
 * name and by content, a directory copy, and the coding shell's mask sweep.
 *
 * REAL organ, REAL sandbox, REAL bwrap shell, REAL hard links on one temp
 * filesystem. Secret contents are markers built at runtime. No mock (RULE 0).
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { standHouse, plant, hardlink, marker, textOf } from '../helpers/secret-hardlink-kit.js';
import { SECRET_INODE_TTL_MS, secretLinkReason } from '../../backend/services/secret-inodes.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { ensureWitnessCodingSandbox, runWitnessCommand } from '../../backend/services/witness-coding-sandbox.js';

const BEING = 'hardlinkwall';
const SHELL_LANE = 'witness-test-Hardlink';
// Each twin's innocent name, in the being's own lane, by the secret it shares an inode with.
const TWINS = Object.freeze({
  env: 'files/notes.txt',
  keypair: 'files/deep/er/ledger.json',
  dek: 'files/dek-notes.md',
  credentials: 'files/claude-notes.txt',
  ghHosts: 'files/hosts-copy.yml',
  store: 'files/settings-backup.json',
  nestedEnv: 'files/sub-notes.txt',
  vault: 'files/vault-copy/notes.json',
  owner: 'files/who.json',
  laneDna: 'files/essay.json',
  dataDna: 'files/data-notes.json',
});

describe('a hard link to a secret is refused by identity, wherever it stands', () => {
  let house;
  let ordinary;
  const twin = (kind) => path.join(house.lane, TWINS[kind]);

  beforeAll(async () => {
    house = await standHouse('secret-hardlink', BEING);
    for (const [kind, rel] of Object.entries(TWINS)) await hardlink(house.secrets[kind].file, path.join(house.lane, rel));
    // An ordinary file with two names: one inode, nothing secret.
    ordinary = { mark: marker('ordinary') };
    ordinary.file = await plant(path.join(house.lane, 'files', 'plain-a.txt'), `${ordinary.mark}\n`);
    ordinary.twin = await hardlink(ordinary.file, path.join(house.lane, 'files', 'plain-b.txt'));
    await fs.symlink(twin('env'), path.join(house.lane, 'files', 'link-to-notes.txt'));
  });

  afterAll(async () => { await house.restore(); });

  test.each(Object.keys(TWINS))('fs/read of the %s twin (same inode, innocent name) is refused', async (kind) => {
    const stat = await fs.stat(twin(kind));
    expect(stat.ino).toBe((await fs.stat(house.secrets[kind].file)).ino);
    await expect(house.call('fs', 'read', { path: twin(kind) })).rejects.toThrow(/hard link/i);
  });

  test('a symlink to a twin is refused (symlink-to-hardlink chain)', async () => {
    await expect(house.call('fs', 'read', { path: path.join(house.lane, 'files', 'link-to-notes.txt') }))
      .rejects.toThrow(/hard link/i);
  });

  test('an ordinary file with two names still reads by either', async () => {
    for (const file of [ordinary.file, ordinary.twin]) {
      expect((await fs.stat(file)).nlink).toBe(2);
      expect(textOf(await house.call('fs', 'read', { path: file }))).toContain(ordinary.mark);
    }
  });

  test('fs/search by content never returns a twin; the ordinary pair is found', async () => {
    const text = textOf(await house.call('fs', 'search', {
      path: path.join(house.lane, 'files'), pattern: 'HARDLINK_', content: true, excludePatterns: [], maxResults: 500,
    }));
    for (const kind of Object.keys(TWINS)) expect(text, kind).not.toContain(house.secrets[kind].mark);
    expect(text).toContain(ordinary.mark);
    expect(text).toMatch(/withheld by the secret-path policy/);
  });

  test('fs/search by name never lists a twin; the ordinary pair is listed', async () => {
    const text = textOf(await house.call('fs', 'search', { path: path.join(house.lane, 'files'), pattern: '*', excludePatterns: [] }));
    for (const rel of Object.values(TWINS)) expect(text, rel).not.toContain(path.basename(rel));
    expect(text).not.toContain('link-to-notes.txt');
    expect(text).toContain('plain-a.txt');
    expect(text).toContain('plain-b.txt');
  });

  test('copying the folder never mints a twin a fresh inode', async () => {
    await house.call('fs', 'edit', { path: path.join(house.lane, 'files'), destination: path.join(house.lane, 'files-copy'), copy: true });
    const copied = textOf(await house.call('fs', 'search', {
      path: path.join(house.lane, 'files-copy'), pattern: 'HARDLINK_', content: true, excludePatterns: [],
    }));
    for (const kind of Object.keys(TWINS)) expect(copied, kind).not.toContain(house.secrets[kind].mark);
    expect(copied).toContain(ordinary.mark);
    await expect(fs.access(path.join(house.lane, 'files-copy', 'notes.txt'))).rejects.toThrow(/ENOENT/);
  });

  test('a secret file itself still refuses by name, with one link or two', async () => {
    await expect(house.call('fs', 'read', { path: house.secrets.env.file })).rejects.toThrow(/denied/i);
  });

  test('rotation: in place keeps the twin refused; a new inode refuses its own twins; the stale twin is the stated residual', async () => {
    const rotating = path.join(house.roots.proj, '.env.rotating');
    const first = marker('rot');
    await plant(rotating, `ROTATING_TOKEN=${first}\n`);
    const oldTwin = await hardlink(rotating, path.join(house.lane, 'files', 'rot-notes.txt'));
    await expect(house.call('fs', 'read', { path: oldTwin })).rejects.toThrow(/hard link/i);

    // Rewritten in place: same inode, the twin now carries the NEW value and stays refused.
    const second = marker('rot');
    await fs.writeFile(rotating, `ROTATING_TOKEN=${second}\n`);
    await expect(house.call('fs', 'read', { path: oldTwin })).rejects.toThrow(/hard link/i);

    // Rotated by replace: a new inode under the secret's name.
    const third = marker('rot');
    await plant(`${rotating}.tmp`, `ROTATING_TOKEN=${third}\n`);
    await fs.rename(`${rotating}.tmp`, rotating);
    const newTwin = await hardlink(rotating, path.join(house.lane, 'files', 'rot-notes-new.txt'));
    await expect(house.call('fs', 'read', { path: newTwin })).rejects.toThrow(/hard link/i);
    // RESIDUAL, stated: the old twin is now the only name of the revoked
    // value — one link, an inode no secret holds — and reads as an ordinary
    // file. It never sees the new value.
    expect((await fs.stat(oldTwin)).nlink).toBe(1);
    expect(secretLinkReason(oldTwin)).toBeNull();
    const stale = textOf(await house.call('fs', 'read', { path: oldTwin }));
    expect(stale).toContain(second);
    expect(stale).not.toContain(third);
  });

  test('no window: a secret made a moment ago is refused through its twin at once, the set warm and fresh', async () => {
    // Warm the set with a miss, so a cached set exists that predates the secret.
    await house.call('fs', 'read', { path: ordinary.twin });
    const fresh = await plant(path.join(house.roots.home, '.netrc'), `machine example.invalid password ${marker('fresh')}\n`);
    const twin = await hardlink(fresh, path.join(house.lane, 'files', 'fresh-notes.txt'));
    await expect(house.call('fs', 'read', { path: twin })).rejects.toThrow(/hard link/i);
    expect(Date.now() - (await fs.stat(fresh)).ctimeMs).toBeLessThan(SECRET_INODE_TTL_MS);
  });

  test('no window: a secret NAME made without touching the inode (a symlink) is matched past the miss floor', async () => {
    const original = await plant(path.join(house.roots.tmp, 'elsewhere', 'blob.json'), `{"auth":"${marker('symname')}"}\n`);
    const twin = await hardlink(original, path.join(house.lane, 'files', 'blob-copy.json'));
    await new Promise((r) => setTimeout(r, 80)); // the inode's ctime now predates every later build
    expect(textOf(await house.call('fs', 'read', { path: twin }))).toContain('symname'); // not a secret yet
    await fs.mkdir(path.join(house.roots.home, '.docker'), { recursive: true });
    await fs.symlink(original, path.join(house.roots.home, '.docker', 'config.json'));
    await new Promise((r) => setTimeout(r, 30)); // past MISS_REBUILD_FLOOR_MS
    await expect(house.call('fs', 'read', { path: twin })).rejects.toThrow(/hard link/i);
  });

  test('the coding shell (real bwrap) masks every twin and still shows the ordinary pair', async () => {
    const ground = path.join(house.roots.tmp, 'ground');
    for (const [kind, rel] of Object.entries(TWINS)) await hardlink(house.secrets[kind].file, path.join(ground, rel));
    await hardlink(ordinary.file, path.join(ground, 'plain-c.txt'));
    // node_modules is never swept by name; a twin there is found by inode.
    const depTwin = 'node_modules/dep/lib/notes.txt';
    await hardlink(house.secrets.env.file, path.join(ground, depTwin));
    await neumaWorkspace.create(SHELL_LANE);
    const sandbox = await ensureWitnessCodingSandbox(SHELL_LANE, ground);
    const run = await runWitnessCommand({
      ...sandbox, mode: 'inspect', command: `cat ${Object.values(TWINS).join(' ')} ${depTwin} plain-c.txt`,
    });
    for (const kind of Object.keys(TWINS)) expect(run.stdout, kind).not.toContain(house.secrets[kind].mark);
    expect(run.stdout).toContain(ordinary.mark);
    for (const rel of [...Object.values(TWINS), depTwin]) expect(sandbox.masks.files, rel).toContain(path.join(ground, rel));
    expect(sandbox.masks.files).not.toContain(path.join(ground, 'plain-c.txt'));
  }, 60_000);
});
