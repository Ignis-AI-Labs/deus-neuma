/**
 * THE TMP JANITOR on real disk with real processes — no mocks (RULE 0). A stale folder moves to the
 * holding folder; a fresh one, one a live process stands in, a loose file, a link and a system runtime
 * folder stay; holding folders past their week are removed. Roots live under /var/tmp (disk), never /tmp.
 */
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import net from 'node:net';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { heldPaths, purgeHolding, reclaimEntries, staleEntries, HOLDING_PREFIX } from '../../backend/services/ram-keeper/tmp-janitor.js';
import { KEEPER } from '../../backend/services/ram-keeper/ram-keeper.js';

const DAY = 24 * 60 * 60 * 1000;
let root;
let holding;
let child;
const after = [];

// make a folder (with one file) whose every timestamp is `ageMs` old
const aged = async (path, ageMs) => {
  await fs.mkdir(path, { recursive: true });
  await fs.writeFile(join(path, 'f.txt'), 'x');
  const t = new Date(Date.now() - ageMs);
  await fs.utimes(join(path, 'f.txt'), t, t);
  await fs.utimes(path, t, t);
};

describe('the tmp janitor', () => {
  beforeEach(async () => {
    root = await fs.mkdtemp('/var/tmp/janitor-root-');
    holding = await fs.mkdtemp('/var/tmp/janitor-holding-');
  });

  afterEach(async () => {
    while (after.length) await after.pop()();
    if (child && child.exitCode === null) child.kill('SIGKILL');
    child = null;
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(holding, { recursive: true, force: true });
  });

  test('PR20 M-11: the janitor is opt-in, and its holding is private to this user', async () => {
    expect(KEEPER.janitorEnabled).toBe(false);
    await aged(join(root, 'neuma-private'), 3 * DAY);
    const moved = await reclaimEntries([join(root, 'neuma-private')], holding);
    const stat = await fs.stat(moved.holding);
    expect(stat.mode & 0o777).toBe(0o700);
    expect(stat.uid).toBe(process.getuid());
  });

  test('only an old, unheld, user-owned folder is stale', async () => {
    await aged(join(root, 'old-clone'), 3 * DAY);
    await aged(join(root, 'fresh'), 60 * 1000);
    await aged(join(root, 'held'), 3 * DAY);
    await aged(join(root, 'systemd-private-abc'), 3 * DAY);
    await fs.writeFile(join(root, 'quit.blend'), 'scene');
    const old = new Date(Date.now() - 3 * DAY);
    await fs.utimes(join(root, 'quit.blend'), old, old);
    await fs.symlink(join(root, 'old-clone'), join(root, 'link'));
    // a folder with something fresh deep inside is not stale, however old its top
    await aged(join(root, 'deep/a/b'), 3 * DAY);
    await fs.writeFile(join(root, 'deep/a/b/new.log'), 'now');
    await fs.utimes(join(root, 'deep/a/b'), old, old);
    await fs.utimes(join(root, 'deep/a'), old, old);
    await fs.utimes(join(root, 'deep'), old, old);
    // a running app's single-instance marker: a socket, old as the rest
    await aged(join(root, 'org.chromium.Chromium.Ab12Cd'), 3 * DAY);
    const sock = net.createServer().listen(join(root, 'org.chromium.Chromium.Ab12Cd', 'SingletonSocket'));
    await new Promise((r) => sock.once('listening', r));
    after.push(() => new Promise((r) => sock.close(r)));
    await fs.utimes(join(root, 'org.chromium.Chromium.Ab12Cd', 'SingletonSocket'), old, old); // only the socket rule may keep it
    await fs.utimes(join(root, 'org.chromium.Chromium.Ab12Cd'), old, old);
    // a live process stands in "held"
    child = spawn('sleep', ['30'], { cwd: join(root, 'held'), stdio: 'ignore' });
    await delay(200);
    expect(await heldPaths(root)).toContain(join(root, 'held'));

    expect(await staleEntries({ root })).toEqual([join(root, 'old-clone')]);
  });

  test('a stale folder moves to the holding folder, a name clash gets a suffix, nothing is deleted', async () => {
    await aged(join(root, 'neuma-139-git'), 3 * DAY);
    const now = Date.now();
    const first = await reclaimEntries(await staleEntries({ root }), holding, now);
    expect(first.moved).toEqual([join(root, 'neuma-139-git')]);
    expect(first.holding).toBe(join(holding, `${HOLDING_PREFIX}${new Date(now).toISOString().slice(0, 10)}`));
    expect(await fs.readFile(join(first.holding, 'neuma-139-git', 'f.txt'), 'utf8')).toBe('x');
    await expect(fs.stat(join(root, 'neuma-139-git'))).rejects.toMatchObject({ code: 'ENOENT' });

    await aged(join(root, 'neuma-139-git'), 3 * DAY);
    const second = await reclaimEntries([join(root, 'neuma-139-git')], holding, now);
    expect(second.moved).toHaveLength(1);
    expect(await fs.readdir(second.holding)).toEqual(['neuma-139-git', 'neuma-139-git.1']);
  });

  test('a holding folder is removed after its week, kept within it; other folders are never touched', async () => {
    const now = Date.parse('2026-11-16T12:00:00Z');
    await fs.mkdir(join(holding, `${HOLDING_PREFIX}2026-11-08`));
    await fs.mkdir(join(holding, `${HOLDING_PREFIX}2026-11-12`));
    await fs.mkdir(join(holding, 'someone-elses-folder'));
    await fs.mkdir(join(root, 'must-survive'));
    await fs.symlink(join(root, 'must-survive'), join(holding, `${HOLDING_PREFIX}2026-11-07`));
    expect(await purgeHolding(holding, now)).toEqual([join(holding, `${HOLDING_PREFIX}2026-11-08`)]);
    expect((await fs.readdir(holding)).sort()).toEqual([`${HOLDING_PREFIX}2026-11-07`, `${HOLDING_PREFIX}2026-11-12`, 'someone-elses-folder']);
    expect(await fs.stat(join(root, 'must-survive'))).toBeTruthy();
  });
});
