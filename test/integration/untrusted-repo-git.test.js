// A REPOSITORY'S OWN CONFIG IS DATA (RULE 0: real git, real repositories on a temp folder, real
// programs that leave a mark when run). Audit 2026-10-28 H-01: opening a folder in the explorer
// ran `git status` there, and a repository can name a program for git to run during that walk.
// Each case first proves the attack fires under plain git on this machine, then that the
// platform's reads never run it (untrusted-git.js).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { invalidateGitStatusCache, readGitStatus } from '../../backend/services/git-status.js';
import { checkoutSecretFiles } from '../../backend/services/checkout-secret-files.js';

let dir;
const plainGit = (repo, args) => {
  try { execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }); } catch { /* the hook may fail; the mark is the proof */ }
};
const makeRepo = (name) => {
  const repo = path.join(dir, name);
  fs.mkdirSync(repo, { recursive: true });
  const g = (...args) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { stdio: 'ignore' });
  g('init', '-q');
  fs.writeFileSync(path.join(repo, 'notes.txt'), 'first\n');
  g('add', '.');
  g('commit', '-qm', 'first');
  return repo;
};
// a program that leaves a mark when git runs it (and passes content through, as a filter must)
const marker = (name) => path.join(dir, `${name}.ran`);
const program = (name) => {
  const file = path.join(dir, `${name}.sh`);
  fs.writeFileSync(file, `#!/bin/sh\ntouch '${marker(name)}'\ncat\n`, { mode: 0o755 });
  return file;
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'untrusted-repo-git-'));
  invalidateGitStatusCache();
});
afterEach(() => {
  invalidateGitStatusCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('the explorer reads a hostile repository without running it', () => {
  test('core.fsmonitor (the finding): plain git runs it; the explorer never does, and still badges', async () => {
    const repo = makeRepo('fsmonitor');
    execFileSync('git', ['-C', repo, 'config', 'core.fsmonitor', program('fsmonitor')]);
    fs.writeFileSync(path.join(repo, 'notes.txt'), 'changed\n');
    plainGit(repo, ['status']);
    expect(fs.existsSync(marker('fsmonitor')), 'the attack is real on this git').toBe(true);
    fs.rmSync(marker('fsmonitor'));

    const status = await readGitStatus(repo);
    expect(fs.existsSync(marker('fsmonitor'))).toBe(false);
    expect(status).toMatchObject({ isRepo: true, files: { 'notes.txt': 'M' } });
    expect(status.refused).toBeUndefined();
  });

  test('a clean filter named by .gitattributes: plain status runs it; the explorer refuses the repo, no badges', async () => {
    const repo = makeRepo('filter');
    execFileSync('git', ['-C', repo, 'config', 'filter.evil.clean', program('filter')]);
    fs.writeFileSync(path.join(repo, '.gitattributes'), '*.txt filter=evil\n');
    // same size, new bytes: git must hash the file (through the filter) to know it changed
    fs.writeFileSync(path.join(repo, 'notes.txt'), 'firsT\n');
    plainGit(repo, ['status']);
    expect(fs.existsSync(marker('filter')), 'the attack is real on this git').toBe(true);
    fs.rmSync(marker('filter'));

    const status = await readGitStatus(repo);
    expect(fs.existsSync(marker('filter'))).toBe(false);
    expect(status.isRepo).toBe(true);
    expect(status.files).toEqual({});
    expect(status.refused).toMatch(/names programs/);
  });

  test('the secret-file listing walks the same hostile repository without running its fsmonitor', () => {
    const repo = makeRepo('listing');
    execFileSync('git', ['-C', repo, 'config', 'core.fsmonitor', program('listing')]);
    fs.writeFileSync(path.join(repo, '.env'), 'X=1\n');
    plainGit(repo, ['ls-files', '--others']);
    const fired = fs.existsSync(marker('listing'));
    if (fired) fs.rmSync(marker('listing'));
    const { paths } = checkoutSecretFiles([repo]);
    expect(paths.some((p) => p.endsWith('.env'))).toBe(true);
    expect(fs.existsSync(marker('listing'))).toBe(false);
  });
});
