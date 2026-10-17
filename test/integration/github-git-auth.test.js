// Real gh reads fixture-owned credential config. No fake command or token broker.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { resolveGitHubAuthorization, gitHubNetworkConfig, releaseGitHubAuthorization } from '../../backend/services/github-git-auth.js';
import { createHarnessGitKit } from '../helpers/harness-git-kit.js';
import { runGroundGit } from '../../backend/services/ground-git-exec.js';
import { previewGroundSync } from '../../backend/services/ground-sync.js';

const URL = 'https://github.com/example/fixture.git';
const REF = 'refs/heads/main';
const advertise = (url = URL) => ['ls-remote', '--refs', '--exit-code', '--', url, REF];
const KEYS = ['GH_CONFIG_DIR', 'HOME', 'GH_TOKEN', 'GITHUB_TOKEN', 'GH_HOST'];
let root, token, oldEnv, git;
const held = [];
const exec = promisify(execFile);

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-github-auth-'));
  oldEnv = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  process.env.GH_CONFIG_DIR = path.join(root, 'gh');
  process.env.HOME = root;
  process.env.GH_TOKEN = 'gho_AMBIENT_MUST_NOT_BE_USED';
  process.env.GITHUB_TOKEN = 'gho_AMBIENT_MUST_NOT_BE_USED';
  process.env.GH_HOST = 'example.invalid';
  await fs.mkdir(process.env.GH_CONFIG_DIR);
  token = `gho_${randomBytes(24).toString('hex')}`;
  await fs.writeFile(path.join(process.env.GH_CONFIG_DIR, 'hosts.yml'),
    `github.com:\n    user: HarnessFixture\n    oauth_token: ${token}\n    git_protocol: https\n`, { mode: 0o600 });
});
afterEach(async () => {
  for (const authorization of held.splice(0)) releaseGitHubAuthorization(authorization);
  await git?.close(); git = null;
  for (const key of KEYS) {
    if (oldEnv[key] === undefined) delete process.env[key]; else process.env[key] = oldEnv[key];
  }
  await fs.rm(root, { recursive: true, force: true });
});
const authorize = async () => {
  const authorization = await resolveGitHubAuthorization(URL);
  held.push(authorization);
  expect(authorization).not.toBeNull();
  return authorization;
};

describe('backend-only GitHub authorization', () => {
  test('real CLI lookup returns opaque repository authority, not a token; ignores ambient token/host overrides', async () => {
    const authorization = await authorize();
    expect(Object.isFrozen(authorization)).toBe(true);
    expect(JSON.stringify(authorization)).toBe(JSON.stringify({ repository: URL }));
    const config = gitHubNetworkConfig(authorization, advertise());
    expect(config.env.NEUMA_GITHUB_GIT_AUTH).toBe(`Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`);
    expect(config.args).toEqual([`--config-env=http.${URL}.extraHeader=NEUMA_GITHUB_GIT_AUTH`]);
    expect(JSON.stringify(config.args)).not.toContain(token);
    expect(JSON.stringify(config.args)).not.toContain(config.env.NEUMA_GITHUB_GIT_AUTH);
  });

  test('exact fetch OID is supported; forged, released or differently scoped authority refuses', async () => {
    const authorization = await authorize();
    const args = ['fetch', '--no-tags', '--no-recurse-submodules', '--no-write-fetch-head', '--no-auto-maintenance', '--', URL, 'a'.repeat(40)];
    expect(gitHubNetworkConfig(authorization, args).env.NEUMA_GITHUB_GIT_AUTH).toBeTruthy();
    for (const changed of [advertise('https://github.com/example/other.git'), advertise('http://127.0.0.1:12345/repo.git'),
      ['config', '--list'], ['merge', '--ff-only', 'HEAD'], ['ls-remote', '--upload-pack=evil', '--', URL, REF],
      [...args.slice(0, -1), '--upload-pack=evil']]) {
      expect(() => gitHubNetworkConfig(authorization, changed)).toThrow(/does not cover/);
    }
    expect(() => gitHubNetworkConfig({ repository: URL }, advertise())).toThrow(/does not cover/);
    releaseGitHubAuthorization(authorization);
    expect(() => gitHubNetworkConfig(authorization, advertise())).toThrow(/does not cover/);
  });

  test('no account supports anonymous public access; malformed credential output refuses without reflecting bytes', async () => {
    await fs.writeFile(path.join(process.env.GH_CONFIG_DIR, 'hosts.yml'), '{}\n');
    expect(await resolveGitHubAuthorization(URL)).toBeNull();
    await fs.writeFile(path.join(process.env.GH_CONFIG_DIR, 'hosts.yml'),
      'github.com:\n    user: HarnessFixture\n    oauth_token: "INVALID CREDENTIAL MARKER"\n');
    const error = await resolveGitHubAuthorization(URL).catch((failure) => failure);
    expect(error.code).toBe('github_auth_unavailable');
    expect(error.message).not.toContain('INVALID CREDENTIAL MARKER');
  });

  test('loopback has no GitHub authority; foreign hosts and userinfo refuse before lookup', async () => {
    expect(await resolveGitHubAuthorization('http://127.0.0.1:12345/repo.git')).toBeNull();
    for (const remote of ['https://github.com.evil.test/o/r.git', 'https://secret:token@github.com/o/r.git',
      'https://github.com/o/r.git?token=secret', 'ssh://github.com/o/r.git']) {
      await expect(resolveGitHubAuthorization(remote)).rejects.toMatchObject({ code: 'unsafe_transport' });
    }
  });

  test('cancelled lookup yields no capability; authorization cannot reach local Git or a loopback HTTP server', async () => {
    const aborted = AbortSignal.abort();
    await expect(resolveGitHubAuthorization(URL, { signal: aborted })).rejects.toMatchObject({ code: 'cancelled' });
    const authorization = await authorize();
    git = await createHarnessGitKit();
    await expect(runGroundGit(git.ground, ['status', '--porcelain=v1'], { authorization }))
      .rejects.toMatchObject({ code: 'github_auth_scope' });
    await expect(runGroundGit(git.ground, advertise(git.url), { authorization }))
      .rejects.toMatchObject({ code: 'github_auth_scope' });
    expect(git.requests).toHaveLength(0);
    const config = await fs.readFile(path.join(git.ground, '.git/config'), 'utf8');
    expect(config).not.toContain(token);
    expect(config).not.toContain('NEUMA_GITHUB_GIT_AUTH');
  });

  test('GitHub approval previews name the credential source, never its contents', async () => {
    const authorization = await authorize();
    const preview = previewGroundSync({ root: '/tmp/fixture', branch: REF, head: 'a'.repeat(40),
      upstream: 'refs/remotes/origin/main', url: authorization.repository });
    expect(preview.authentication).toBe('Operator GitHub CLI login, if available');
    expect(preview.github).toBe(URL);
    expect(JSON.stringify(preview)).not.toContain(token);
  });

  test('interrupt kills a real in-flight CLI lookup blocked on fixture configuration', async () => {
    const config = path.join(process.env.GH_CONFIG_DIR, 'hosts.yml');
    await fs.unlink(config);
    await exec('/usr/bin/mkfifo', [config]);
    const controller = new AbortController();
    const running = resolveGitHubAuthorization(URL, { signal: controller.signal });
    const stopped = expect(running).rejects.toMatchObject({ code: 'cancelled' });
    let child;
    try {
      await expect.poll(async () => {
        const children = await fs.readFile(`/proc/${process.pid}/task/${process.pid}/children`, 'utf8');
        for (const id of children.trim().split(/\s+/).filter(Boolean)) {
          const command = await fs.readFile(`/proc/${id}/cmdline`, 'utf8').catch(() => '');
          if (command.startsWith('/usr/bin/gh\0config\0get\0user\0')) { child = id; return true; }
        }
        return false;
      }, { timeout: 2000 }).toBe(true);
      controller.abort();
      await stopped;
      await expect(fs.stat(`/proc/${child}`)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      controller.abort();
      await stopped;
    }
  });

  test('Electron bundled Node executes the actual CLI/capability path without exposing credentials', async () => {
    const moduleUrl = new globalThis.URL('../../backend/services/github-git-auth.js', import.meta.url).href;
    const electron = new globalThis.URL('../../node_modules/electron/dist/electron', import.meta.url);
    const script = `
      import assert from 'node:assert/strict';
      import { resolveGitHubAuthorization, gitHubNetworkConfig, releaseGitHubAuthorization } from ${JSON.stringify(moduleUrl)};
      const authority = await resolveGitHubAuthorization(${JSON.stringify(URL)});
      assert.ok(authority);
      assert.deepEqual(Object.keys(authority), ['repository']);
      const config = gitHubNetworkConfig(authority, ${JSON.stringify(advertise())});
      assert.equal(config.args.length, 1);
      assert.ok(config.args[0].endsWith('=NEUMA_GITHUB_GIT_AUTH'));
      assert.ok(config.env.NEUMA_GITHUB_GIT_AUTH.startsWith('Authorization: Basic '));
      releaseGitHubAuthorization(authority);
      assert.throws(() => gitHubNetworkConfig(authority, ${JSON.stringify(advertise())}));
      process.stdout.write('Electron GitHub auth: passed');
    `;
    const { stdout } = await exec(fileURLToPath(electron), ['--input-type=module', '-e', script], {
      cwd: '/', timeout: 15000,
      env: { PATH: '/usr/bin:/bin', HOME: root, GH_CONFIG_DIR: process.env.GH_CONFIG_DIR, ELECTRON_RUN_AS_NODE: '1' },
    });
    expect(stdout).toBe('Electron GitHub auth: passed');
    expect(stdout).not.toContain(token);
  });
});
