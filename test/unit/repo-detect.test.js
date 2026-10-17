/**
 * Tests for repo-detect — git classification from a real `.git` on disk. No
 * mocks (RULE 0): every case writes an actual `.git` layout and reads it back
 * through the real function. The parse step is also checked in isolation as a
 * pure function.
 */
import { describe, expect, test } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { detectRepo, parseBranch } from '../../backend/services/repo-detect.js';

describe('parseBranch — pure HEAD ref parsing', () => {
  test('extracts a branch from a ref line', () => {
    expect(parseBranch('ref: refs/heads/main\n')).toBe('main');
    expect(parseBranch('ref: refs/heads/main\n')).toBe('main');
  });
  test('a detached HEAD (raw sha) has no branch', () => {
    expect(parseBranch('9b9374836a1f2c3d4e5f6a7b8c9d0e1f2a3b4c5d\n')).toBeNull();
  });
  test('non-string input is null', () => {
    expect(parseBranch(null)).toBeNull();
    expect(parseBranch(undefined)).toBeNull();
  });
});

describe('detectRepo — real .git on disk', () => {
  test('a plain folder is not a repo', async () => {
    const dir = await createTempDir('plain');
    expect(await detectRepo(dir)).toEqual({ isRepo: false, branch: null });
  });

  test('a folder with .git/ and a branch HEAD is a repo on that branch', async () => {
    const dir = await createTempDir('repo');
    await fs.mkdir(path.join(dir, '.git'));
    await fs.writeFile(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    expect(await detectRepo(dir)).toEqual({ isRepo: true, branch: 'main' });
  });

  test('a detached HEAD is a repo with a null branch', async () => {
    const dir = await createTempDir('detached');
    await fs.mkdir(path.join(dir, '.git'));
    await fs.writeFile(path.join(dir, '.git', 'HEAD'), '0123456789abcdef0123456789abcdef01234567\n');
    expect(await detectRepo(dir)).toEqual({ isRepo: true, branch: null });
  });

  test('a linked worktree (.git FILE → gitdir) resolves the branch', async () => {
    const main = await createTempDir('wt-main');
    const gitDir = path.join(main, '.git', 'worktrees', 'wt1');
    await fs.mkdir(gitDir, { recursive: true });
    await fs.writeFile(path.join(gitDir, 'HEAD'), 'ref: refs/heads/feature\n');
    const wt = await createTempDir('wt-linked');
    await fs.writeFile(path.join(wt, '.git'), `gitdir: ${gitDir}\n`);
    expect(await detectRepo(wt)).toEqual({ isRepo: true, branch: 'feature' });
  });

  test('a missing folder never throws — just not a repo', async () => {
    expect(await detectRepo('/no/such/path/xyz123')).toEqual({ isRepo: false, branch: null });
  });
});
