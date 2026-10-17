import { beforeEach, afterEach, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const script = path.resolve('scripts/sync-from-dev.mjs');
let root, remote, owner, maintainer;
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const identity = (cwd) => {
  git(cwd, 'config', 'user.name', 'Git pipeline fixture');
  git(cwd, 'config', 'user.email', 'git-fixture@example.invalid');
};
const commit = (cwd, file, content) => {
  fs.writeFileSync(path.join(cwd, file), content);
  git(cwd, 'add', '--', file);
  git(cwd, 'commit', '-m', file, '--', file);
};
const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: owner, encoding: 'utf8' });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-sync-proof-'));
  remote = path.join(root, 'origin.git'); owner = path.join(root, 'owner'); maintainer = path.join(root, 'maintainer');
  git(root, 'init', '--bare', '--initial-branch=dev', remote);
  git(root, 'clone', remote, maintainer); identity(maintainer);
  commit(maintainer, 'base.txt', 'base\n'); git(maintainer, 'push', 'origin', 'dev');
  git(root, 'clone', remote, owner); identity(owner);
  git(owner, 'checkout', '-b', 'main'); git(owner, 'push', '-u', 'origin', 'main');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

it.each(['unstaged', 'staged', 'untracked'])('refuses %s work without changing it or HEAD', (kind) => {
  const file = kind === 'untracked' ? 'draft.txt' : 'base.txt';
  fs.writeFileSync(path.join(owner, file), 'unfinished work\n');
  if (kind === 'staged') git(owner, 'add', '--', file);
  const head = git(owner, 'rev-parse', 'HEAD'), status = git(owner, 'status', '--porcelain');
  const result = run('--apply');
  expect(result.status).toBe(1); expect(result.stderr).toContain('not clean');
  expect(git(owner, 'rev-parse', 'HEAD')).toBe(head);
  expect(git(owner, 'status', '--porcelain')).toBe(status);
  expect(fs.readFileSync(path.join(owner, file), 'utf8')).toBe('unfinished work\n');
});

it('refuses unpushed commits', () => {
  commit(owner, 'local.txt', 'local only\n');
  const head = git(owner, 'rev-parse', 'HEAD');
  const result = run('--apply');
  expect(result.status).toBe(1); expect(result.stderr).toContain('tips differ');
  expect(git(owner, 'rev-parse', 'HEAD')).toBe(head);
});

it('requires the published personal work to reach dev first', () => {
  commit(owner, 'ready.txt', 'ready for PR\n'); git(owner, 'push', 'origin', 'main');
  const head = git(owner, 'rev-parse', 'HEAD');
  const result = run('--apply');
  expect(result.status).toBe(1); expect(result.stderr).toContain('PR to dev');
  expect(git(owner, 'rev-parse', 'HEAD')).toBe(head);
});

it('checks without changing HEAD and applies only a dev fast-forward', () => {
  commit(maintainer, 'approved.txt', 'approved through dev\n'); git(maintainer, 'push', 'origin', 'dev');
  const original = git(owner, 'rev-parse', 'HEAD'), approved = git(maintainer, 'rev-parse', 'HEAD');
  expect(run('--check').status).toBe(0);
  expect(git(owner, 'rev-parse', 'HEAD')).toBe(original);
  expect(fs.existsSync(path.join(owner, 'approved.txt'))).toBe(false);
  expect(run('--apply').status).toBe(0);
  expect(git(owner, 'rev-parse', 'HEAD')).toBe(approved);
  expect(git(owner, 'status', '--porcelain')).toBe('');
});

it('rejects any attempt to select another branch as the source', () => {
  const head = git(owner, 'rev-parse', 'HEAD');
  const result = run('--apply', 'benni/dev');
  expect(result.status).toBe(1); expect(result.stderr).toContain('source is always origin/dev');
  expect(git(owner, 'rev-parse', 'HEAD')).toBe(head);
});
