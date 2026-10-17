/** H4: real HTTP/Git/filesystem/processes only. No private provider claim. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { beforeEach, afterEach, describe, test, expect } from 'vitest';
import { createHarnessGitKit, fixtureGit, commitFixture } from '../helpers/harness-git-kit.js';
import { prepareGroundSync, previewGroundSync, syncGround } from '../../backend/services/ground-sync.js';
import { readGroundGit, readGroundDiff, readGroundCommit } from '../../backend/services/ground-git.js';
import { validateGroundRemote } from '../../backend/services/ground-git-exec.js';

let kit;
beforeEach(async () => { kit = await createHarnessGitKit(); });
afterEach(async () => { await kit?.close(); });
const sync = async (opts = {}) => syncGround(kit.ground, { snapshot: await prepareGroundSync(kit.ground), ...opts });
const waitFor = async (predicate) => {
  const end = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('HTTP fetch did not arrive');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe('snapshot-bound hardened Git', () => {
  test('actual HTTP fast-forward lands exact bytes and suppresses post-merge hook', async () => {
    const marker = path.join(kit.root, 'HOOK_RAN');
    const hooks = path.join(kit.root, 'hooks');
    await fs.mkdir(hooks);
    await fs.writeFile(path.join(hooks, 'post-merge'), `#!/bin/sh\nprintf 'token=HR_GIT_NOT_SECRET'\ntouch '${marker}'\n`, { mode: 0o755 });
    await fs.writeFile(path.join(hooks, 'reference-transaction'), `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
    await fixtureGit(kit.ground, ['config', 'core.hooksPath', hooks]);
    await fixtureGit(kit.ground, ['config', 'core.fsmonitor', path.join(hooks, 'post-merge')]);
    const target = await commitFixture(kit.origin, 'update.txt', 'remote update\n');
    const result = await sync();
    expect(result).toMatchObject({ ok: true, code: 'fast_forward', head: target, refsMayHaveChanged: true });
    expect(await fs.readFile(path.join(kit.ground, 'update.txt'), 'utf8')).toBe('remote update\n');
    await expect(fs.access(marker)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(JSON.stringify(result)).not.toContain('HR_GIT_NOT_SECRET');
    expect(kit.requests.length).toBeGreaterThan(0);
  });

  test('divergence reports fetch ref changes without claiming untouched Git state', async () => {
    const target = await commitFixture(kit.origin, 'remote.txt', 'remote\n');
    const local = await commitFixture(kit.ground, 'local.txt', 'local\n');
    const result = await sync();
    expect(result).toMatchObject({ ok: false, refsMayHaveChanged: true, checkoutMayHaveChanged: false });
    expect(await fixtureGit(kit.ground, ['rev-parse', 'HEAD'])).toBe(local);
    expect(await fixtureGit(kit.ground, ['rev-parse', 'refs/remotes/origin/main'])).toBe(target);
    expect(JSON.stringify(result)).not.toMatch(/untouched|fatal:/);
  });

  test('up-to-date succeeds; stale snapshot and dirty checkout fail before fetch', async () => {
    expect((await sync()).ok).toBe(true);
    const snapshot = await prepareGroundSync(kit.ground);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(previewGroundSync(snapshot)).toEqual({ root: kit.ground, branch: 'refs/heads/main', HEAD: snapshot.head, upstream: 'refs/remotes/origin/main' });
    await fixtureGit(kit.ground, ['switch', '-c', 'other']);
    expect((await syncGround(kit.ground, { snapshot })).ok).toBe(false);
    await fixtureGit(kit.ground, ['switch', 'main']);
    await fs.writeFile(path.join(kit.ground, 'base.txt'), 'uncommitted\n');
    const n = kit.requests.length;
    expect((await sync()).code).toBe('dirty');
    expect(kit.requests.length).toBe(n);
  });

  test('configured filter is refused for reads and sync without running it', async () => {
    const marker = path.join(kit.root, 'FILTER_RAN');
    await commitFixture(kit.origin, '.gitattributes', '*.txt filter=host\n');
    await fixtureGit(kit.ground, ['config', 'filter.host.smudge', `touch '${marker}'; printf token=HR_GIT_NOT_SECRET`]);
    await expect(prepareGroundSync(kit.ground)).rejects.toMatchObject({ code: 'unsafe_config' });
    await expect(readGroundGit(kit.ground)).rejects.toMatchObject({ code: 'unsafe_config' });
    await expect(readGroundDiff(kit.ground)).rejects.toMatchObject({ code: 'unsafe_config' });
    await expect(fs.access(marker)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(kit.requests).toHaveLength(0);
  });

  test.each([
    ['core.sshCommand', 'touch /tmp/HR_GIT_NOT_SECRET'],
    ['diff.external', 'touch /tmp/HR_GIT_NOT_SECRET'],
    ['remote.origin.uploadpack', 'touch /tmp/HR_GIT_NOT_SECRET'],
    ['url.ext::touch /tmp/HR_GIT_NOT_SECRET.insteadOf', 'https://github.com/'],
    ['credential.helper', '!printf token=HR_GIT_NOT_SECRET'],
  ])('rejects executable/config redirection %s without reflecting its value', async (key, value) => {
    await fixtureGit(kit.ground, ['config', key, value]);
    const error = await prepareGroundSync(kit.ground).catch((failure) => failure);
    expect(error.code).toBe('unsafe_config');
    expect(error.message).not.toContain('HR_GIT_NOT_SECRET');
  });

  test.each(['file:///tmp/fixture', '/tmp/fixture', 'git@github.com:owner/repo.git',
    'ssh://github.com/owner/repo.git', 'ext::sh -c id', 'https://token:HR_GIT_NOT_SECRET@github.com/o/r.git',
    'http://169.254.169.254/repo', 'https://github.com.evil.test/o/r', 'https://github.com/o/r?token=HR_GIT_NOT_SECRET',
  ])('refuses unsafe transport without echoing %s', async (url) => {
    expect(() => validateGroundRemote(url)).toThrow(/Unsupported Git remote/);
    await fixtureGit(kit.ground, ['remote', 'set-url', 'origin', url]);
    await expect(prepareGroundSync(kit.ground)).rejects.toMatchObject({ code: 'unsafe_transport' });
    expect(kit.requests).toHaveLength(0);
  });

  test('pre-abort never fetches; abort in real HTTP fetch kills helper connections and releases lock', async () => {
    const controller = new AbortController();
    controller.abort();
    expect((await sync({ signal: controller.signal })).code).toBe('cancelled');
    expect(kit.requests).toHaveLength(0);
    await commitFixture(kit.origin, 'fetch-pending.txt', 'must fetch an actual object\n');
    kit.hold(true);
    const active = new AbortController();
    const snapshot = await prepareGroundSync(kit.ground);
    const running = syncGround(kit.ground, { snapshot, signal: active.signal });
    await waitFor(() => kit.held.size > 0);
    const competing = await syncGround(kit.ground, { snapshot });
    expect(competing.code).toBe('locked');
    active.abort();
    expect(await running).toMatchObject({ ok: false, code: 'cancelled', objectsMayHaveChanged: true, refsMayHaveChanged: false });
    await waitFor(() => kit.held.size === 0);
    await expect(fs.access(path.join(snapshot.commonDir, 'neuma-ground-sync.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('stale lock fails explicitly; diagnostic errors and history credential markers stay redacted', async () => {
    const snapshot = await prepareGroundSync(kit.ground);
    await fs.writeFile(path.join(snapshot.commonDir, 'neuma-ground-sync.lock'), 'operator must inspect');
    expect((await syncGround(kit.ground, { snapshot })).code).toBe('locked');
    await fixtureGit(kit.ground, ['commit', '--allow-empty', '-m', 'token=HR_GIT_NOT_SECRET github_pat_FIXTURE_SECRET']);
    const history = await readGroundCommit(kit.ground, 'HEAD');
    expect(history).not.toContain('HR_GIT_NOT_SECRET');
    expect(history).not.toContain('github_pat_FIXTURE_SECRET');
    expect(history).toContain('[redacted]');
  });

  test('remote rollback never rewrites tracking or local history even without a force flag', async () => {
    const base = await fixtureGit(kit.origin, ['rev-parse', 'HEAD']);
    const advanced = await commitFixture(kit.origin, 'advance.txt', 'advance\n');
    expect((await sync()).ok).toBe(true);
    await fixtureGit(kit.origin, ['update-ref', 'refs/heads/main', base]);
    await fixtureGit(kit.origin, ['update-server-info']);
    expect(await sync()).toMatchObject({ ok: false, refsMayHaveChanged: false, objectsMayHaveChanged: true });
    expect(await fixtureGit(kit.ground, ['rev-parse', 'refs/remotes/origin/main'])).toBe(advanced);
    expect(await fixtureGit(kit.ground, ['rev-parse', 'HEAD'])).toBe(advanced);
  });

  test('actual HTTP auth error body cannot become a Git diagnostic result', async () => {
    kit.fail('token=HR_GIT_NOT_SECRET github_pat_FIXTURE_SECRET\n');
    const result = await sync();
    expect(result).toMatchObject({ ok: false, code: 'private_auth', refsMayHaveChanged: false });
    expect(JSON.stringify(result)).not.toMatch(/HR_GIT_NOT_SECRET|github_pat_FIXTURE_SECRET|fatal:|remote:/);
    expect(result.output).toContain('Check connectivity and repository permissions');
  });

  test('worktree config aliases and blob-object history queries fail closed', async () => {
    const blob = await fixtureGit(kit.ground, ['rev-parse', 'HEAD:base.txt']);
    expect(await readGroundCommit(kit.ground, blob)).toBeNull();
    await fixtureGit(kit.ground, ['config', 'extensions.worktreeConfig', '1']);
    await expect(prepareGroundSync(kit.ground)).rejects.toMatchObject({ code: 'unsafe_config' });
  });
});
