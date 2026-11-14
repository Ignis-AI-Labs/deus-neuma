/**
 * `neuma code --commit` / `/commit on` (RULE 0, nothing mocked): a real git
 * repository, the being's real file hands (platform-hands.js — the same calls
 * a being's edit, new file and delete make, each leaving its undo record),
 * the real commit module, and the real `neuma code` program reading typed
 * commands. Under proof: a request's commit holds exactly the files the being
 * changed — never the operator's other dirty or staged work; a file the
 * operator had already changed is said so in the message; nothing changed,
 * nothing committed; an undo is committed as its own commit; a folder that is
 * not a repository says so.
 */
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Wallet } from 'ethers';
import neumaWorkspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { runPlatformHand } from '../../backend/services/platform-hands.js';
import { committedTurn } from '../../cli/lib/turn-commits.js';

const CLI = new URL('../../bin/neuma', import.meta.url).pathname;
const LANE_ID = 'neuma-commit-proof';
const GIT_ENV = {
  GIT_AUTHOR_NAME: 'Commit Test', GIT_AUTHOR_EMAIL: 'commit@test.invalid',
  GIT_COMMITTER_NAME: 'Commit Test', GIT_COMMITTER_EMAIL: 'commit@test.invalid',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
};
const SAVED = Object.fromEntries(Object.keys(GIT_ENV).map((k) => [k, process.env[k]]));
let root; let ground; let workspacesRoot; let previousRoot; let env;

const git = (...args) => execFileSync('git', args, { cwd: ground, encoding: 'utf8' });

beforeEach(async () => {
  // The commit module runs git in this process: it commits as the test's identity, never the machine's.
  Object.assign(process.env, GIT_ENV);
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-commit-'));
  ground = path.join(root, 'ground');
  workspacesRoot = path.join(root, 'workspaces');
  await fs.mkdir(ground);
  git('init', '-q', '-b', 'main');
  await fs.writeFile(path.join(ground, 'math.js'), 'export const half = (n) => n / 2;\n');
  await fs.writeFile(path.join(ground, 'notes.md'), '# notes\n');
  await fs.writeFile(path.join(ground, 'plan.md'), '# plan\n');
  git('add', '.');
  git('commit', '-q', '-m', 'first');
  previousRoot = getWorkspacesRoot();
  setWorkspacesRoot(workspacesRoot);
  await neumaWorkspace.create(LANE_ID);
  const operator = Wallet.createRandom();
  await fs.writeFile(path.join(workspacesRoot, LANE_ID, 'owner.json'), JSON.stringify({ wallet: operator.address, claimedAt: new Date().toISOString() }));
  const walletEnv = path.join(root, 'operator.env');
  await fs.writeFile(walletEnv, `OPERATOR_WALLET_PRIVATE_KEY=${operator.privateKey}\n`, { mode: 0o600 });
  env = {
    ...process.env, NODE_ENV: 'test', AUTH_SECRET: 'turn-commits-proof-secret', DNA_ENCRYPTION_KEY: 'turn-commits-proof-key-material',
    LLM_PROVIDER: 'lm-studio', LLM_MODEL: 'offline-neuma-proof', LM_STUDIO_URL: 'http://127.0.0.1:1/v1', NEUMA_WEB_ACCESS: '0',
    NEUMA_WALLET_ENV: walletEnv, WORKSPACES_ROOT: workspacesRoot, WITNESSES_ROOT: path.join(root, 'witnesses'),
    AI_WITNESSES_ROOT: path.join(root, 'ai-witnesses'), NEUMA_DATA_ROOT: path.join(root, 'data'), NEUMA_REALM_ROOT: path.join(root, 'realm'),
    NEUMA_VAULT_ROOT: path.join(root, 'vault'), NEUMA_BACKUPS_ROOT: path.join(root, 'backups'),
    NEUMA_ROOT_LOCK_PATH: path.join(root, 'root-lock.json'), PLATFORM_DB_PATH: path.join(root, 'platform', 'platform.db'),
  };
});

afterEach(async () => {
  for (const [k, v] of Object.entries(SAVED)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  setWorkspacesRoot(previousRoot);
  await fs.rm(root, { recursive: true, force: true });
});

const typeInto = (lines, flags = [], where = ground) => spawnSync('node', [CLI, 'code', '--workspace', LANE_ID, '--ground', where, ...flags], {
  cwd: where, env, input: `${lines.join('\n')}\n`, encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
});

describe('a request\'s commit — exactly the being\'s files', () => {
  test('the being\'s edit and new file go in; the operator\'s dirty and staged work stays out', async () => {
    await fs.writeFile(path.join(ground, 'notes.md'), '# notes\nmy own thought\n');
    await fs.writeFile(path.join(ground, 'plan.md'), '# plan\nstaged by me\n');
    git('add', 'plan.md');
    const said = [];
    const result = await committedTurn({
      root: ground, request: 'Make half handle strings and add a test', being: 'Fenna', say: (s) => said.push(s),
      run: async () => {
        expect((await runPlatformHand('edit_file', { path: path.join(ground, 'math.js'), edits: [{ oldText: 'n / 2', newText: 'Number(n) / 2' }] })).ok).toBe(true);
        expect((await runPlatformHand('write_file', { path: path.join(ground, 'math.test.js'), content: 'import { half } from "./math.js";\n' })).ok).toBe(true);
        return { checks: 0 };
      },
    });
    expect(result).toEqual({ checks: 0 });
    expect(said[0]).toMatch(/^ {2}committed [0-9a-f]{7,} — math.js, math.test.js$/);
    expect(git('show', '--name-only', '--format=', 'HEAD').trim().split('\n')).toEqual(['math.js', 'math.test.js']);
    const message = git('log', '-1', '--format=%B');
    expect(message).toMatch(/^Make half handle strings and add a test\n\n- math.js\n- math.test.js\n\nMade by Fenna, a neuma, in neuma code.\nAssisted-by: AI/);
    // The operator's own work, untouched: notes.md still dirty, plan.md still staged and uncommitted.
    expect(git('status', '--porcelain', '--', 'notes.md', 'plan.md').split('\n').filter(Boolean)).toEqual([' M notes.md', 'M  plan.md']);
  });

  test('a file the operator had already changed is committed whole, and the message says so; nothing changed, nothing committed', async () => {
    await fs.writeFile(path.join(ground, 'math.js'), 'export const half = (n) => n / 2; // mine\n');
    const before = git('rev-parse', 'HEAD');
    await committedTurn({ root: ground, request: 'Only think', being: 'Fenna', say: () => {}, run: async () => ({ checks: 0 }) });
    expect(git('rev-parse', 'HEAD')).toBe(before);
    await committedTurn({
      root: ground, request: 'Double instead', being: 'Fenna', say: () => {},
      run: async () => (await runPlatformHand('edit_file', { path: path.join(ground, 'math.js'), edits: [{ oldText: 'n / 2', newText: 'n * 2' }] })),
    });
    expect(git('log', '-1', '--format=%B')).toContain('- math.js (also held changes made before this request)');
  });
});

describe('neuma code — /commit typed into the real program', () => {
  test('off by default; on in a repository; /undo is committed as its own commit; off stops it', async () => {
    const target = path.join(ground, 'math.js');
    expect((await runPlatformHand('delete_file', { path: target })).ok).toBe(true);
    git('add', '-A');
    git('commit', '-q', '-m', 'the delete');
    const run = typeInto(['/commit', '/commit maybe', '/commit on', '/undo', '/commit off', '/commit', '/quit']);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('commit: off — /commit on turns it on');
    expect(run.stdout).toContain('commit is /commit on, /commit off, or /commit to see it');
    expect(run.stdout).toContain(`commit on: each request's changes to files in ${ground} are committed to git`);
    expect(run.stdout).toMatch(/committed [0-9a-f]{7,} — math\.js/);
    expect(run.stdout).toContain('commit off');
    expect(await fs.readFile(target, 'utf8')).toBe('export const half = (n) => n / 2;\n');
    expect(git('log', '-1', '--format=%s').trim()).toBe('undo: restored math.js (it was gone; it is back)');
    expect(git('status', '--porcelain', '--', 'math.js')).toBe('');
  }, 90_000);

  test('--commit says it is on; a folder that is not a repository says it cannot be', async () => {
    expect(typeInto(['/quit'], ['--commit']).stderr).toContain(`commit on: each request's changes to files in ${ground}`);
    const plain = path.join(root, 'plain');
    await fs.mkdir(plain);
    const run = typeInto(['/commit on', '/quit'], [], plain);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain(`commit: ${plain} is not a git repository — nothing can be committed there`);
  }, 90_000);
});
