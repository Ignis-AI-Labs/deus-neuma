import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { releaseGroundSyncLock } from '../../backend/services/ground-sync-lock.js';

let root, lockPath, handle;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-lock-release-'));
  lockPath = path.join(root, 'sync.lock');
  handle = await fs.open(lockPath, 'wx', 0o600);
});

afterEach(async () => {
  await handle.close();
  await fs.rm(root, { recursive: true, force: true });
});

it('removes its owned lock and closes its descriptor', async () => {
  expect(await releaseGroundSyncLock(handle, lockPath)).toBe(true);
  await expect(fs.lstat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(handle.stat()).rejects.toMatchObject({ code: 'EBADF' });
});

it('preserves a replacement inode and closes the old descriptor', async () => {
  await fs.rename(lockPath, path.join(root, 'original.lock'));
  await fs.writeFile(lockPath, 'replacement owner', { flag: 'wx' });
  expect(await releaseGroundSyncLock(handle, lockPath)).toBe(false);
  expect(await fs.readFile(lockPath, 'utf8')).toBe('replacement owner');
  await expect(handle.stat()).rejects.toMatchObject({ code: 'EBADF' });
});

it('reports a missing path while still closing its descriptor', async () => {
  await fs.unlink(lockPath);
  expect(await releaseGroundSyncLock(handle, lockPath)).toBe(false);
  await expect(handle.stat()).rejects.toMatchObject({ code: 'EBADF' });
});

it('refuses an already closed handle without unlinking the path', async () => {
  await handle.close();
  expect(await releaseGroundSyncLock(handle, lockPath)).toBe(false);
  expect((await fs.lstat(lockPath)).isFile()).toBe(true);
});

it('leaves an existing lock untouched when no handle was acquired', async () => {
  await handle.writeFile('another operation');
  expect(await releaseGroundSyncLock(undefined, lockPath)).toBe(true);
  expect(await fs.readFile(lockPath, 'utf8')).toBe('another operation');
});
