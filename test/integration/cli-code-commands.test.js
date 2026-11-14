/**
 * `/undo`, `/review`, `/check` and `--watch` in the real `neuma code` program (RULE 0).
 *
 * The real CLI process loads an isolated sovereign root, seats a lane owned by
 * a wallet made for this run, and reads the commands from its real stdin. The
 * ground is a real git repository. Nothing is mocked. The lane deliberately
 * has no DNA, so a `/review` that reaches the turn is refused by the real
 * identity gate — which is the proof that the command gathered the change and
 * entered the turn path. What a real model says in a review stays a live
 * sitting's proof.
 */
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Wallet } from 'ethers';
import neumaWorkspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { runPlatformHand } from '../../backend/services/platform-hands.js';

const CLI = new URL('../../bin/neuma', import.meta.url).pathname;
const LANE_ID = 'neuma-code-commands-proof';
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
    GIT_AUTHOR_NAME: 'Code Test', GIT_AUTHOR_EMAIL: 'code@test.invalid',
    GIT_COMMITTER_NAME: 'Code Test', GIT_COMMITTER_EMAIL: 'code@test.invalid',
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
  },
});

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-code-cmd-'));
  workspacesRoot = path.join(root, 'workspaces');
  ground = path.join(root, 'ground');
  await fs.mkdir(ground);
  previousRoot = getWorkspacesRoot();
  setWorkspacesRoot(workspacesRoot);
  await neumaWorkspace.create(LANE_ID);
  // A wallet made for this run and gone with the temp root: the seat verifies
  // the operator owns the lane, so the two must really match.
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
    AUTH_SECRET: 'cli-code-commands-proof-secret',
    DNA_ENCRYPTION_KEY: 'cli-code-commands-proof-key-material',
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

// The real program, the commands on its real stdin, run from inside the ground.
const typeInto = (lines, flags = []) => spawnSync('node', [CLI, 'code', '--workspace', LANE_ID, '--ground', ground, ...flags], {
  cwd: ground, env, input: `${lines.join('\n')}\n`, encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
});

describe('neuma code — /undo typed into the real program', () => {
  test('a file the hand deleted comes back, and a second /undo says there is nothing left', async () => {
    const target = path.join(ground, 'math.js');
    expect((await runPlatformHand('delete_file', { path: target })).ok).toBe(true);

    const run = typeInto(['/undo', '/undo', '/quit']);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain(`restored ${target}`);
    expect(run.stdout).toContain('nothing to undo in');
    expect(await fs.readFile(target, 'utf8')).toBe('export const half = (n) => n / 2;\n');
  }, 90_000);

  test('/help lists the work commands', () => {
    const run = typeInto(['/help', '/quit']);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toMatch(/\/review\s+review what is uncommitted/);
    expect(run.stdout).toMatch(/\/undo\s+put back the last file change/);
    expect(run.stdout).toMatch(/\/check <command>\s+run your lint or test command/);
  }, 90_000);
});

describe('neuma code — /review typed into the real program', () => {
  test('a clean tree has nothing to review; an unknown ref is refused in git\'s words; the session lives on', () => {
    const run = typeInto(['/review', '/review commit no-such-ref', '/review everything', '/status', '/quit']);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('review: nothing has changed');
    expect(run.stdout).toContain('review: git could not read that');
    expect(run.stdout).toContain('usage: /review');
    expect(run.stdout).toContain(`ground:    ${ground}`);
  }, 90_000);

  test('with a change standing, /review gathers it and enters the real turn path', async () => {
    await fs.writeFile(path.join(ground, 'math.js'), 'export const half = (n) => n / 0;\n');
    const run = typeInto(['/review', '/quit']);
    expect(run.status, run.stderr).toBe(0);
    // The lane has no DNA: the real identity gate refuses the turn. Reaching
    // that refusal is the proof the review turn was opened.
    expect(run.stdout).toContain("This being's identity could not be loaded. Its turn was refused.");
    expect(run.stdout).not.toContain('review: nothing has changed');
    // The review read the change and left it exactly as it stood.
    expect(await fs.readFile(path.join(ground, 'math.js'), 'utf8')).toBe('export const half = (n) => n / 0;\n');
    expect(git('status', '--porcelain').trim()).toBe('M math.js');
    // The turn the gate refused is on the lane's own record (encrypted at rest).
    const sessions = await fs.readdir(path.join(workspacesRoot, LANE_ID, 'sessions'));
    expect(sessions).toHaveLength(1);
  }, 90_000);
});

describe('neuma code — /check typed into the real program', () => {
  test('off by default; naming a command turns it on and says where it runs; off stops it', () => {
    const run = typeInto(['/check', '/check node -e "process.exit(0)" && echo done', '/check', '/check off', '/check', '/quit']);
    expect(run.status, run.stderr).toBe(0);
    const out = run.stdout;
    expect(out).toContain('check: off — /check <command> turns it on');
    expect(out).toContain('check on: node -e "process.exit(0)" && echo done');
    expect(out).toContain('it runs as you, outside the being\'s sandbox');
    expect(out).toContain('check: node -e "process.exit(0)" && echo done');
    expect(out).toContain('check off');
    expect(out.indexOf('check off')).toBeLessThan(out.lastIndexOf('check: off — /check <command> turns it on'));
  }, 90_000);

  test('--check turns it on from the start, and a turn that changes nothing never runs it', async () => {
    // The check would leave a file behind if it ran. The lane has no DNA, so
    // the real turn is refused by the identity gate and changes nothing.
    const marker = path.join(root, 'check-ran');
    const run = typeInto(['say hello', '/check', '/quit'], ['--check', `node -e "require('fs').writeFileSync('${marker}', '1')"`]);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stderr).toContain('check on: node -e');
    expect(run.stdout).toContain("This being's identity could not be loaded. Its turn was refused.");
    expect(run.stdout).toContain('check: node -e');
    await expect(fs.stat(marker)).rejects.toThrow();
    expect(run.stderr).not.toContain('· check:');
  }, 90_000);
});

describe('neuma code --watch — a comment saved in the ground reaches the real program', () => {
  test('an AI! comment saved while the session is open opens a real turn; a standing one does not', async () => {
    await fs.writeFile(path.join(ground, 'old.js'), '// a request left from before AI!\n');
    const child = spawn('node', [CLI, 'code', '--workspace', LANE_ID, '--ground', ground, '--watch'], {
      cwd: ground, env, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const until = async (check, ms = 30_000) => {
      const end = Date.now() + ms;
      while (Date.now() < end && !check()) await new Promise((resolve) => { setTimeout(resolve, 100); });
      return check();
    };
    try {
      expect(await until(() => err.includes('for AI comments')), err).toBe(true);
      expect(err).not.toContain('watch: instruction in old.js');
      await fs.writeFile(path.join(ground, 'math.js'), 'export const half = (n) => n / 2; // guard against NaN AI!\n');
      expect(await until(() => err.includes('watch: instruction in math.js')), err).toBe(true);
      // The DNA-less lane is refused by the real identity gate: the turn was opened.
      expect(await until(() => out.includes("This being's identity could not be loaded. Its turn was refused.")), out).toBe(true);
    } finally {
      child.stdin.end('/quit\n');
      await new Promise((resolve) => { child.on('close', resolve); setTimeout(resolve, 15_000); });
      child.kill('SIGKILL');
    }
    expect(err).not.toContain('watch: instruction in old.js');
  }, 90_000);
});
