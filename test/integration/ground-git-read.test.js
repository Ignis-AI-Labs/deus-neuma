/**
 * THE BRANCH A WITNESS REPORTS — real git, real disk, real shells (RULE 0).
 *
 * On 2026-07-29 a sealed witness reported the operator's repository as being on
 * `master` while `/workspace/repos/project-nuniver` was on `main` — it was reading a
 * copy-era baseline repo's own branch and could not tell. The overlay shell
 * ended the ambiguity by construction: the ground's `.git` is masked from the
 * shell's view, so in-shell git sees NO repository, and `ground_git` is the
 * one read of the live branch.
 *
 * Two properties must hold TOGETHER, which is why they are proven in one file:
 *   - in-shell git cannot answer branch questions at all (no second identity), and
 *   - the ground's real branch is readable without `.git` ever crossing over.
 * No mock appears anywhere: these are real repositories on real disk, read by
 * the real functions the witness tool calls.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import workspace, { getWitnessesRoot, setWitnessesRoot } from '../../core/workspace/neuma-workspace.js';
import { readGroundGit, formatGroundGit } from '../../backend/services/ground-git.js';
import {
  ensureWitnessCodingSandbox, runWitnessCommand,
} from '../../backend/services/witness-coding-sandbox.js';

const execFileAsync = promisify(execFile);

const LANE = 'witness-test-GroundRead';
const AUTHOR = ['-c', 'user.name=Ground Test', '-c', 'user.email=ground@localhost'];

let root;
let ground;
let savedRoot;

// impure — drive real git in a real directory.
const git = (cwd, args) => execFileAsync('git', args, { cwd });

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ground-git-'));
  savedRoot = getWitnessesRoot();
  setWitnessesRoot(path.join(root, 'witnesses'));
  await workspace.create(LANE);

  // A ground shaped like the operator's real checkout: a branch that is NOT any
  // git default, tracking a real remote, with a real dirty file.
  ground = path.join(root, 'repos', 'umbrae');
  await fs.mkdir(ground, { recursive: true });
  await git(ground, ['init', '--quiet', '--initial-branch', 'main']);
  await fs.writeFile(path.join(ground, 'README.md'), '# umbrae\n');
  await git(ground, ['add', 'README.md']);
  await git(ground, [...AUTHOR, 'commit', '--quiet', '-m', 'first']);

  const remote = path.join(root, 'remote.git');
  await git(root, ['init', '--quiet', '--bare', remote]);
  await git(ground, ['remote', 'add', 'origin', remote]);
  await git(ground, ['push', '--quiet', '-u', 'origin', 'main']);

  await fs.writeFile(path.join(ground, 'untracked.md'), 'not added\n');
}, 60_000);

afterAll(async () => {
  setWitnessesRoot(savedRoot);
  await fs.rm(root, { recursive: true, force: true });
});

describe('the ground\'s real branch is readable', () => {
  test('reports the live branch — this is the fact the witness could not get', async () => {
    const state = await readGroundGit(ground);
    expect(state.isRepository).toBe(true);
    expect(state.branch).toBe('main');
    expect(state.branch).not.toBe('master');
  });

  test('reports the real HEAD sha of the ground, not of any copy', async () => {
    const state = await readGroundGit(ground);
    const { stdout } = await git(ground, ['rev-parse', 'HEAD']);
    expect(state.head).toBe(stdout.trim().slice(0, 12));
  });

  test('reports upstream tracking and divergence', async () => {
    const state = await readGroundGit(ground);
    expect(state.upstream).toBe('origin/main');
    expect(state).toMatchObject({ ahead: 0, behind: 0 });
  });

  test('counts the real dirty working tree', async () => {
    const state = await readGroundGit(ground);
    expect(state.untracked).toBe(1);
    expect(state.modified).toBe(0);
  });

  test('divergence tracks real commits made after the push', async () => {
    await fs.writeFile(path.join(ground, 'README.md'), '# umbrae\nmore\n');
    await git(ground, ['add', 'README.md']);
    await git(ground, [...AUTHOR, 'commit', '--quiet', '-m', 'second']);
    const state = await readGroundGit(ground);
    expect(state).toMatchObject({ ahead: 1, behind: 0 });
    await git(ground, [...AUTHOR, 'reset', '--quiet', '--hard', 'HEAD~1']);
  });
});

describe('what must never cross over', () => {
  test('no remote URL appears in the rendered text — a URL can carry a token', async () => {
    const text = formatGroundGit(await readGroundGit(ground));
    expect(text).not.toContain(path.join(root, 'remote.git'));
    expect(text).not.toMatch(/https?:\/\/|git@|ssh:\/\//);
  });

  // A plain `git status` REFRESHES and rewrites `.git/index` when a tracked
  // file's stat data is stale, which would race the operator's own git commands
  // in the checkout they are actively working in. Touching README first makes
  // the index stale on purpose, so this asserts `--no-optional-locks` rather
  // than merely observing that nothing needed writing.
  test('reading the ground never writes to the ground, even with a stale index', async () => {
    const readme = path.join(ground, 'README.md');
    const future = new Date(Date.now() + 10_000);
    await fs.utimes(readme, future, future);

    const indexPath = path.join(ground, '.git', 'index');
    const before = await fs.stat(indexPath);
    await readGroundGit(ground);
    const after = await fs.stat(indexPath);
    expect(after.mtimeMs).toBe(before.mtimeMs);

    // Prove the touch really would have provoked a rewrite without the guard.
    await execFileAsync('git', ['status'], { cwd: ground });
    const provoked = await fs.stat(indexPath);
    expect(provoked.mtimeMs).not.toBe(before.mtimeMs);
  });
});

describe('the shell can no longer be mistaken for the ground', () => {
  test('in-shell git sees no repository at all — there is no second identity to misread', async () => {
    const sandbox = await ensureWitnessCodingSandbox(LANE, ground);
    const result = await runWitnessCommand({
      ...sandbox, mode: 'inspect', command: 'git rev-parse --abbrev-ref HEAD',
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).not.toContain('main');
    expect(result.stdout).not.toContain('master');
    // ...while the honest hand reads the live branch, same ground, same moment.
    expect((await readGroundGit(ground)).branch).toBe('main');
  }, 60_000);
});

describe('grounds that are not ordinary repositories', () => {
  test('a plain directory is reported as not a repository, with no invented branch', async () => {
    const plain = path.join(root, 'plain');
    await fs.mkdir(plain, { recursive: true });
    const state = await readGroundGit(plain);
    expect(state.isRepository).toBe(false);
    expect(state.branch).toBeUndefined();
    expect(formatGroundGit(state)).toContain('(not a git repository)');
  });

  test('a detached HEAD is reported as a state, not as a branch named HEAD', async () => {
    const detached = path.join(root, 'detached');
    await fs.mkdir(detached, { recursive: true });
    await git(detached, ['init', '--quiet', '--initial-branch', 'main']);
    await fs.writeFile(path.join(detached, 'a.txt'), 'a\n');
    await git(detached, ['add', 'a.txt']);
    await git(detached, [...AUTHOR, 'commit', '--quiet', '-m', 'one']);
    const { stdout } = await git(detached, ['rev-parse', 'HEAD']);
    await git(detached, ['checkout', '--quiet', '--detach', stdout.trim()]);

    const state = await readGroundGit(detached);
    expect(state.branch).toBe('(detached HEAD)');
    expect(state.upstream).toBeNull();
  }, 60_000);
});
