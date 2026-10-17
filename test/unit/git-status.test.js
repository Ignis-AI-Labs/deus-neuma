/**
 * Tests for git-status — the pure porcelain parse (letterForCode,
 * parsePorcelain) plus a REAL end-to-end probe: readGitStatus against an
 * actual `git init`'d repo on disk (RULE 0 — no mocks anywhere on the
 * claimed path: real git, real subprocess, real filesystem).
 */
import { describe, expect, test } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { letterForCode, parsePorcelain, readGitStatus, invalidateGitStatusCache } from '../../backend/services/git-status.js';

describe('letterForCode — one badge letter per XY code', () => {
  test('untracked, conflicts, added, modified, deleted, renamed, typechange', () => {
    expect(letterForCode('??')).toBe('U');
    for (const c of ['DD', 'AA', 'UU', 'AU', 'UA', 'DU', 'UD']) expect(letterForCode(c)).toBe('C');
    expect(letterForCode('A ')).toBe('A');
    expect(letterForCode('AM')).toBe('A'); // added then touched still reads added
    expect(letterForCode('M ')).toBe('M');
    expect(letterForCode(' M')).toBe('M');
    expect(letterForCode('MM')).toBe('M');
    expect(letterForCode(' D')).toBe('D');
    expect(letterForCode('D ')).toBe('D');
    expect(letterForCode('R ')).toBe('M'); // rename badges its destination as modified
    expect(letterForCode('T ')).toBe('M'); // typechange is a modification
    expect(letterForCode('  ')).toBeNull(); // unmodified
  });
});

describe('parsePorcelain — branch header + file letters', () => {
  test('tracking branch with ahead/behind', () => {
    const r = parsePorcelain('## main...origin/main [ahead 2, behind 1]\n M backend/a.js\n?? notes.md\n');
    expect(r).toEqual({ branch: 'main', ahead: 2, behind: 1, files: { 'backend/a.js': 'M', 'notes.md': 'U' }, ignored: [] });
  });

  test('no upstream, no divergence numbers', () => {
    const r = parsePorcelain('## main\nM  staged.js\n');
    expect(r).toEqual({ branch: 'main', ahead: 0, behind: 0, files: { 'staged.js': 'M' }, ignored: [] });
  });

  test('no commits yet still names the branch', () => {
    const r = parsePorcelain('## No commits yet on main\nA  first.js\n');
    expect(r.branch).toBe('main');
    expect(r.files).toEqual({ 'first.js': 'A' });
  });

  test('detached HEAD has no branch', () => {
    const r = parsePorcelain('## HEAD (no branch)\n M a.js\n');
    expect(r.branch).toBeNull();
    expect(r.files).toEqual({ 'a.js': 'M' });
  });

  test('a rename badges the NEW path; quoted paths are unquoted', () => {
    const r = parsePorcelain('## main\nR  old.js -> new.js\nM  "dir with space/f.js"\n');
    expect(r.files).toEqual({ 'new.js': 'M', 'dir with space/f.js': 'M' });
  });

  test('ignored paths land in their own list, trailing slashes stripped — never a badge', () => {
    const r = parsePorcelain('## main\n!! node_modules/\n!! debug.log\n M a.js\n');
    expect(r.ignored).toEqual(['node_modules', 'debug.log']);
    expect(r.files).toEqual({ 'a.js': 'M' });
  });

  test('junk input degrades, never throws', () => {
    expect(parsePorcelain(null)).toEqual({ branch: null, ahead: 0, behind: 0, files: {}, ignored: [] });
    expect(parsePorcelain('')).toEqual({ branch: null, ahead: 0, behind: 0, files: {}, ignored: [] });
  });
});

describe('readGitStatus — real repo, real git (RULE 0)', () => {
  test('clean repo → branch, no files; modified + untracked → letters; nested dir rolls up by path', async () => {
    const dir = await createTempDir('git-status-');
    const git = (args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
    git(['init', '-b', 'trunk']);
    git(['config', 'user.email', 'e2e@void']);
    git(['config', 'user.name', 'e2e']);
    await fs.writeFile(path.join(dir, 'tracked.txt'), 'one\n');
    await fs.mkdir(path.join(dir, 'sub'));
    await fs.writeFile(path.join(dir, 'sub', 'nested.txt'), 'nested\n');
    git(['add', '.']);
    git(['commit', '-m', 'birth']);

    const clean = await readGitStatus(dir);
    expect(clean).toMatchObject({ isRepo: true, branch: 'trunk', ahead: 0, behind: 0, files: {} });

    await fs.writeFile(path.join(dir, 'tracked.txt'), 'two\n');
    await fs.writeFile(path.join(dir, 'sub', 'fresh.txt'), 'fresh\n');
    // The repo MOVED — production's door for that is the files watcher's
    // frame invalidating the 4s porcelain cache (2026-09-02); this test walks
    // through the same door rather than waiting the TTL out.
    invalidateGitStatusCache();
    const dirty = await readGitStatus(dir);
    expect(dirty.files).toEqual({ 'tracked.txt': 'M', 'sub/fresh.txt': 'U' });
  });

  test('a non-repo folder answers isRepo:false (the rev-parse probe fails honestly)', async () => {
    const dir = await createTempDir('git-status-plain-');
    expect(await readGitStatus(dir)).toEqual({ isRepo: false });
  });

  test('a root that is a SUBDIRECTORY of a repo is served by the enclosing repo, keys re-based, outside paths dropped', async () => {
    const dir = await createTempDir('git-status-sub-');
    const git = (args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
    git(['init', '-b', 'trunk']);
    git(['config', 'user.email', 'e2e@void']);
    git(['config', 'user.name', 'e2e']);
    await fs.mkdir(path.join(dir, 'sub'));
    await fs.writeFile(path.join(dir, 'sub', 'inner.txt'), 'inner\n');
    await fs.writeFile(path.join(dir, 'outer.txt'), 'outer\n');
    git(['add', '.']);
    git(['commit', '-m', 'birth']);

    await fs.writeFile(path.join(dir, 'sub', 'inner.txt'), 'touched\n');
    await fs.writeFile(path.join(dir, 'outer.txt'), 'touched\n');
    const sub = path.join(dir, 'sub');
    const status = await readGitStatus(sub);
    // inner.txt is re-based onto the opened root; outer.txt never leaks in.
    expect(status).toMatchObject({ isRepo: true, branch: 'trunk', files: { 'inner.txt': 'M' } });
  });

  test('a non-ASCII filename badges as raw UTF-8, never octal escapes', async () => {
    const dir = await createTempDir('git-status-utf8-');
    const git = (args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
    git(['init', '-b', 'trunk']);
    git(['config', 'user.email', 'e2e@void']);
    git(['config', 'user.name', 'e2e']);
    await fs.writeFile(path.join(dir, 'seed.txt'), 'seed\n');
    git(['add', '.']);
    git(['commit', '-m', 'birth']);

    await fs.writeFile(path.join(dir, 'café.txt'), 'café\n');
    const status = await readGitStatus(dir);
    expect(status.files).toEqual({ 'café.txt': 'U' });
  });

  test('ignored entries arrive in the ignored list — files AND collapsed dirs — and never as badges', async () => {
    const dir = await createTempDir('git-status-ignored-');
    const git = (args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
    git(['init', '-b', 'trunk']);
    git(['config', 'user.email', 'e2e@void']);
    git(['config', 'user.name', 'e2e']);
    await fs.writeFile(path.join(dir, '.gitignore'), 'debug.log\nbuild/\n');
    await fs.writeFile(path.join(dir, 'seed.txt'), 'seed\n');
    git(['add', '.']);
    git(['commit', '-m', 'birth']);

    await fs.writeFile(path.join(dir, 'debug.log'), 'log\n');
    await fs.mkdir(path.join(dir, 'build'));
    await fs.writeFile(path.join(dir, 'build', 'out.js'), 'out\n');
    const status = await readGitStatus(dir);
    expect(status.files).toEqual({});
    expect(status.ignored.sort()).toEqual(['build', 'debug.log']);
  });
});
