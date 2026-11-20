/**
 * `neuma review` and `neuma agent --read-only`, as the real program (RULE 0).
 *
 * The real CLI process, an isolated sovereign root, a lane owned by a wallet
 * made for this run, a real git repository as the ground. The lane has no DNA,
 * so a sitting that is really opened is refused by the real identity gate —
 * reaching that refusal, with the receipt saying the hands were held, is the
 * proof the review gathered the change and sat read-only. What a real model
 * finds in a review stays a live sitting's proof.
 */
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Wallet } from 'ethers';
import neumaWorkspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const CLI = new URL('../../bin/neuma', import.meta.url).pathname;
const LANE_ID = 'neuma-review-command-proof';
const REFUSED = "This being's identity could not be loaded";
let root;
let workspacesRoot;
let ground;
let previousRoot;
let env;

const git = (...args) => execFileSync('git', args, {
  cwd: ground,
  encoding: 'utf8',
  env: {
    ...process.env,
    GIT_AUTHOR_NAME: 'Review Test', GIT_AUTHOR_EMAIL: 'review@test.invalid',
    GIT_COMMITTER_NAME: 'Review Test', GIT_COMMITTER_EMAIL: 'review@test.invalid',
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
  },
});

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-review-cmd-'));
  workspacesRoot = path.join(root, 'workspaces');
  ground = path.join(root, 'ground');
  await fs.mkdir(ground);
  previousRoot = getWorkspacesRoot();
  setWorkspacesRoot(workspacesRoot);
  await neumaWorkspace.create(LANE_ID);
  const operator = Wallet.createRandom();
  await fs.writeFile(path.join(workspacesRoot, LANE_ID, 'owner.json'), `${JSON.stringify({
    wallet: operator.address, claimedAt: new Date().toISOString(),
  }, null, 2)}\n`);
  const walletEnv = path.join(root, 'operator.env');
  await fs.writeFile(walletEnv, `OPERATOR_WALLET_PRIVATE_KEY=${operator.privateKey}\n`, { mode: 0o600 });

  git('init', '-q', '-b', 'main');
  await fs.writeFile(path.join(ground, 'math.js'), 'export const half = (n) => n / 2;\n');
  git('add', 'math.js');
  git('commit', '-q', '-m', 'first: half');

  env = {
    ...process.env,
    NODE_ENV: 'test',
    AUTH_SECRET: 'cli-review-command-proof-secret',
    DNA_ENCRYPTION_KEY: 'cli-review-command-proof-key-material',
    LLM_PROVIDER: 'lm-studio',
    LLM_MODEL: 'offline-neuma-proof',
    LM_STUDIO_URL: 'http://127.0.0.1:1/v1',
    NEUMA_WEB_ACCESS: '0',
    NEUMA_WALLET_ENV: walletEnv,
    WORKSPACES_ROOT: workspacesRoot,
    WITNESSES_ROOT: path.join(root, 'witnesses'),
    AI_WITNESSES_ROOT: path.join(root, 'ai-witnesses'),
    NEUMA_DATA_ROOT: path.join(root, 'data'),
    NEUMA_REALM_ROOT: path.join(root, 'realm'),
    NEUMA_VAULT_ROOT: path.join(root, 'vault'),
    NEUMA_BACKUPS_ROOT: path.join(root, 'backups'),
    NEUMA_ROOT_LOCK_PATH: path.join(root, 'root-lock.json'),
    PLATFORM_DB_PATH: path.join(root, 'platform', 'platform.db'),
  };
});

afterEach(async () => {
  setWorkspacesRoot(previousRoot);
  await fs.rm(root, { recursive: true, force: true });
});

const neuma = (args, cwd = ground) => spawnSync('node', [CLI, ...args, '--workspace', LANE_ID], {
  cwd, env, encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
});
const receiptAt = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));

describe('neuma review — the scripted review', () => {
  test('a clean tree has nothing to review and exits 0 without opening a sitting', async () => {
    const run = neuma(['review']);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('nothing has changed — there is nothing to review');
    expect(run.stdout + run.stderr).not.toContain(REFUSED);
    expect(await fs.readdir(path.join(workspacesRoot, LANE_ID, 'sessions')).catch(() => [])).toEqual([]);
  }, 90_000);

  test('bad usage and an unknown ref are refused in plain words, exit 1', () => {
    const usage = neuma(['review', 'everything']);
    expect(usage.status).toBe(1);
    expect(usage.stderr).toContain('usage: neuma review  ·  neuma review commit <ref>  ·  neuma review base <branch>');

    // Anything after a bare -- is refused outright; it never reaches git as an option.
    expect(neuma(['review', 'commit', '--', '--output=/tmp/x']).status).toBe(1);
    const shaped = neuma(['review', 'commit', 'a;b']);
    expect(shaped.status).toBe(1);
    expect(shaped.stderr).toContain('not a git ref: a;b');

    const unknown = neuma(['review', 'commit', 'no-such-ref']);
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain('neuma review: git could not read that');
  }, 90_000);

  test('outside a repository it says so', () => {
    const run = neuma(['review', '--ground', root]);
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/git could not read that — .*not a git repository/i);
  }, 90_000);

  test('a standing change opens a real sitting with the hands held, and leaves the tree as it was', async () => {
    await fs.writeFile(path.join(ground, 'math.js'), 'export const half = (n) => n / 0;\n');
    const receipt = path.join(root, 'review-receipt.json');
    const run = neuma(['review', '--receipt', receipt]);
    // The DNA-less lane is refused by the real identity gate: the sitting was opened.
    expect(run.stdout + run.stderr).toContain(REFUSED);
    expect(run.status).toBe(1);
    const written = await receiptAt(receipt);
    expect(written.readOnly).toBe(true);
    expect(written.laneId).toBe(LANE_ID);
    expect(await fs.readFile(path.join(ground, 'math.js'), 'utf8')).toBe('export const half = (n) => n / 0;\n');
    expect(git('status', '--porcelain').trim()).toBe('M math.js');
  }, 90_000);

  test('commit and base targets reach the sitting too, from a subfolder as well', async () => {
    git('checkout', '-q', '-b', 'work');
    await fs.mkdir(path.join(ground, 'deep'));
    await fs.writeFile(path.join(ground, 'deep', 'third.js'), 'export const third = (n) => n / 3;\n');
    git('add', '.');
    git('commit', '-q', '-m', 'second: third');

    const commit = neuma(['review', 'commit', 'HEAD']);
    expect(commit.stdout + commit.stderr).toContain(REFUSED);
    const base = neuma(['review', 'base', 'main', '--ground', ground], path.join(ground, 'deep'));
    expect(base.stdout + base.stderr).toContain(REFUSED);
    // Same branch against itself: nothing differs, no sitting.
    const same = neuma(['review', 'base', 'work']);
    expect(same.status, same.stderr).toBe(0);
    expect(same.stdout).toContain('nothing has changed');
  }, 120_000);
});

describe('neuma agent --read-only', () => {
  test('the receipt says the hands were held; without the flag it does not', async () => {
    const held = path.join(root, 'held.json');
    const free = path.join(root, 'free.json');
    neuma(['agent', 'read math.js and tell me what it does', '--read-only', '--receipt', held]);
    neuma(['agent', 'read math.js and tell me what it does', '--receipt', free]);
    expect((await receiptAt(held)).readOnly).toBe(true);
    expect(await receiptAt(free)).not.toHaveProperty('readOnly');
  }, 120_000);
});
