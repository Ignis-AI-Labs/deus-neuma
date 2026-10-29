/**
 * The secret gate, end to end on REAL git (no mock): a throwaway repo whose
 * hooks run the real scripts/secret-gate.mjs, real `git commit`, a real bare
 * remote and a real `git push`. The leak this exists for: 422f95aff
 * (2026-04-14), where audit notes quoting live .env values were committed and
 * pushed while .env itself sat safely gitignored.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { randomBytes } from 'crypto';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createTempDir } from '../helpers/temp-fs.js';

const GATE = fileURLToPath(new URL('../../scripts/secret-gate.mjs', import.meta.url));
// Built at runtime: no key-shaped text sits in this file for the repo's own gate to trip on.
const opaque = () => randomBytes(24).toString('base64url'); // no rule's shape — only the live-value check can see it
const ghShaped = () => ['ghp', 'Z'.repeat(40)].join('_');

// HOME and NEUMA_SECRETS_FILE pinned away: the machine's own secret stores
// (secret-sources.js) and git config stay out of a fixture repo's gate.
let home = null;
const run = (cwd, cmd, args, input) => spawnSync(cmd, args, { cwd, encoding: 'utf8', input, env: { ...process.env, HOME: home, NEUMA_SECRETS_FILE: '', GIT_TERMINAL_PROMPT: '0' } });
const git = (cwd, ...args) => run(cwd, 'git', args);

const hook = (name, body) => `#!/bin/sh\n${body}\n`;

describe('secret gate (real git, real hooks, real push)', () => {
  let repo; let remote; let token; let rpcKey;

  beforeEach(async () => {
    const root = await createTempDir('secret-gate');
    repo = path.join(root, 'repo');
    remote = path.join(root, 'remote.git');
    const hooks = path.join(root, 'hooks');
    home = path.join(root, 'home');
    await fs.mkdir(home, { recursive: true });
    await fs.mkdir(repo, { recursive: true });
    await fs.mkdir(hooks, { recursive: true });
    git(root, 'init', '-q', '--bare', remote);
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 'gate@test.invalid');
    git(repo, 'config', 'user.name', 'gate test');
    git(repo, 'config', 'core.hooksPath', hooks);
    git(repo, 'remote', 'add', 'origin', remote);
    await fs.writeFile(path.join(hooks, 'pre-commit'), hook('pre-commit', `exec node "${GATE}" --staged`), { mode: 0o755 });
    await fs.writeFile(path.join(hooks, 'commit-msg'), hook('commit-msg', `exec node "${GATE}" --message "$1"`), { mode: 0o755 });
    await fs.writeFile(path.join(hooks, 'pre-push'), hook('pre-push', `exec node "${GATE}" --push`), { mode: 0o755 });

    token = opaque();
    rpcKey = opaque();
    await fs.writeFile(path.join(repo, '.gitignore'), '.env\n');
    await fs.writeFile(path.join(repo, '.env'), [
      `MY_SERVICE_TOKEN=${token}`,
      `ETH_RPC_URL=https://eth-mainnet.example-rpc.invalid/v2/${rpcKey}`,
      'BASE_RPC_URL=https://mainnet.base.org',
      'DEPLOYER_ADDRESS=0x1111111111111111111111111111111111111111',
    ].join('\n'));
    await fs.writeFile(path.join(repo, 'README.md'), '# fixture\n');
    git(repo, 'add', '.gitignore', 'README.md');
    expect(git(repo, 'commit', '-q', '-m', 'init').status).toBe(0);
    expect(git(repo, 'push', '-q', 'origin', 'main').status).toBe(0);
  });

  const head = () => git(repo, 'rev-parse', 'HEAD').stdout.trim();

  test('audit notes quoting a live value, in any format, are refused — and the value is never printed', async () => {
    await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'sector-infrastructure.md'),
      `| finding | evidence |\n|---|---|\n| token in env | \`${token}\` was readable |\n`);
    git(repo, 'add', 'docs');
    const before = head();
    const commit = git(repo, 'commit', '-q', '-m', 'audit notes');
    expect(commit.status).not.toBe(0);
    expect(commit.stderr).toContain('docs/sector-infrastructure.md:3');
    expect(commit.stderr).toContain('the live value of MY_SERVICE_TOKEN (from .env)');
    expect(commit.stderr + commit.stdout).not.toContain(token);
    expect(head()).toBe(before);
  });

  test("quoting only an RPC URL's key segment is refused too", async () => {
    await fs.writeFile(path.join(repo, 'notes.txt'), `the alchemy key is ${rpcKey}\n`);
    git(repo, 'add', 'notes.txt');
    const commit = git(repo, 'commit', '-q', '-m', 'notes');
    expect(commit.status).not.toBe(0);
    expect(commit.stderr).toContain('the live value of ETH_RPC_URL');
  });

  test('a live value in the commit message is refused', async () => {
    await fs.writeFile(path.join(repo, 'ok.txt'), 'honest\n');
    git(repo, 'add', 'ok.txt');
    const commit = git(repo, 'commit', '-q', '-m', `rotate token ${token}`);
    expect(commit.status).not.toBe(0);
    expect(commit.stderr).toContain('(commit message):1');
  });

  test('a key shape no env file holds is refused in our files, allowed in test fixtures', async () => {
    await fs.writeFile(path.join(repo, 'config.js'), `const t = '${ghShaped()}';\n`);
    git(repo, 'add', 'config.js');
    const refused = git(repo, 'commit', '-q', '-m', 'config');
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain('github-token');
    git(repo, 'rm', '-q', '--cached', 'config.js');
    await fs.mkdir(path.join(repo, 'test'), { recursive: true });
    await fs.writeFile(path.join(repo, 'test', 'fixture.js'), `const t = '${ghShaped()}';\n`);
    git(repo, 'add', 'test');
    expect(git(repo, 'commit', '-q', '-m', 'fixture').status).toBe(0);
  });

  test('honest work passes: variable names, public endpoints and addresses are not secrets', async () => {
    await fs.writeFile(path.join(repo, 'deploy.md'),
      'Set DEPLOYER_PRIVATE_KEY and MY_SERVICE_TOKEN in .env.\nRPC: https://mainnet.base.org\nDeployer 0x1111111111111111111111111111111111111111\n');
    git(repo, 'add', 'deploy.md');
    const commit = git(repo, 'commit', '-q', '-m', 'docs: how to deploy');
    expect(commit.status).toBe(0);
    expect(git(repo, 'push', '-q', 'origin', 'main').status).toBe(0);
  });

  test('a commit made with --no-verify still cannot be pushed: the remote never receives it', async () => {
    await fs.writeFile(path.join(repo, 'leak.md'), `key: ${token}\n`);
    git(repo, 'add', 'leak.md');
    expect(git(repo, 'commit', '-q', '--no-verify', '-m', 'sneak').status).toBe(0);
    const push = git(repo, 'push', '-q', 'origin', 'main');
    expect(push.status).not.toBe(0);
    expect(push.stderr).toContain('push refused');
    expect(push.stderr).toContain('leak.md:1');
    expect(push.stderr).not.toContain(token);
    expect(git(remote, 'rev-parse', 'main').stdout.trim()).not.toBe(head());
  });

  test('the public export is refused when any exported file carries a live value', async () => {
    const tree = path.join(repo, '..', 'export');
    await fs.mkdir(path.join(tree, 'docs'), { recursive: true });
    await fs.writeFile(path.join(tree, 'docs', 'clean.md'), 'nothing here\n');
    expect(run(repo, process.execPath, [GATE, '--tree', tree]).status).toBe(0);
    await fs.writeFile(path.join(tree, 'docs', 'notes.md'), `old key ${token}\n`);
    const refused = run(repo, process.execPath, [GATE, '--tree', tree]);
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain('export refused');
    expect(refused.stderr).toContain('docs/notes.md:1');
    expect(refused.stderr).not.toContain(token);
  });
});
