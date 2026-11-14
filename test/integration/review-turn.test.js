// /review gathers the change with the operator's real git, in a real
// repository on disk, and holds the sitting in observe mode for exactly the
// length of the turn. No mocks: git is git, the repository is a repository.
import { describe, test, expect, beforeAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { execFileSync } from 'node:child_process';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  parseReviewTarget, collectReviewDiff, fitReviewDiff, reviewPrompt, runReview,
} from '../../cli/lib/review-turn.js';
import { gateAct } from '../../backend/services/act-gate.js';
import { createPortalConnection } from '../../backend/services/portal-connection.js';
import { addAllowedTool } from '../../backend/services/tool-policy.js';

const gitIn = (cwd) => (...args) => execFileSync('git', args, {
  cwd,
  encoding: 'utf8',
  env: {
    ...process.env,
    GIT_AUTHOR_NAME: 'Review Test', GIT_AUTHOR_EMAIL: 'review@test.invalid',
    GIT_COMMITTER_NAME: 'Review Test', GIT_COMMITTER_EMAIL: 'review@test.invalid',
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
  },
});

describe('/review — reading the words after the command', () => {
  test('no words means everything uncommitted', () => {
    expect(parseReviewTarget('')).toEqual({ ok: true, target: { kind: 'uncommitted' } });
  });

  test('a commit and a base branch are named', () => {
    expect(parseReviewTarget('commit HEAD~1')).toEqual({ ok: true, target: { kind: 'commit', ref: 'HEAD~1' } });
    expect(parseReviewTarget('base origin/dev')).toEqual({ ok: true, target: { kind: 'base', ref: 'origin/dev' } });
  });

  test('a ref that would be read as an option, or carries shell marks, is refused', () => {
    expect(parseReviewTarget('commit --output=/tmp/x').ok).toBe(false);
    expect(parseReviewTarget('base main;rm').ok).toBe(false);
    expect(parseReviewTarget('commit').ok).toBe(false);
    expect(parseReviewTarget('everything please').ok).toBe(false);
  });
});

describe('/review — gathering the change from a real repository', () => {
  let repo;
  let git;

  beforeAll(async () => {
    repo = await createTempDir('review-turn');
    git = gitIn(repo);
    git('init', '-q', '-b', 'main');
    await fs.writeFile(path.join(repo, 'math.js'), 'export const half = (n) => n / 2;\n');
    git('add', 'math.js');
    git('commit', '-q', '-m', 'first: half');
    git('checkout', '-q', '-b', 'work');
    await fs.writeFile(path.join(repo, 'math.js'), 'export const half = (n) => n / 0;\n');
    git('commit', '-q', '-am', 'second: break half');
    await fs.writeFile(path.join(repo, 'math.js'), 'export const half = (n) => n / 0;\nexport const twice = (n) => n * 2;\n');
    await fs.writeFile(path.join(repo, 'fresh.js'), 'export const fresh = true;\n');
  });

  test('uncommitted shows the edit to a tracked file AND a brand new file', async () => {
    const diff = await collectReviewDiff(repo, { kind: 'uncommitted' });
    expect(diff).toContain('+export const twice = (n) => n * 2;');
    expect(diff).toContain('+export const fresh = true;');
    expect(diff).toContain('fresh.js');
  });

  test('a commit shows that commit, with its message', async () => {
    const diff = await collectReviewDiff(repo, { kind: 'commit', ref: 'HEAD' });
    expect(diff).toContain('second: break half');
    expect(diff).toContain('+export const half = (n) => n / 0;');
    expect(diff).not.toContain('twice');
  });

  test('a base branch shows what this branch committed since it left', async () => {
    const diff = await collectReviewDiff(repo, { kind: 'base', ref: 'main' });
    expect(diff).toContain('-export const half = (n) => n / 2;');
    expect(diff).toContain('+export const half = (n) => n / 0;');
    expect(diff).not.toContain('fresh');
  });

  test('opened from a subfolder, the review still sees the whole change', async () => {
    const sub = path.join(repo, 'nested', 'deeper');
    await fs.mkdir(sub, { recursive: true });
    const diff = await collectReviewDiff(sub, { kind: 'uncommitted' });
    expect(diff).toContain('+export const twice = (n) => n * 2;');
    expect(diff).toContain('+export const fresh = true;');
  });

  test('the platform\'s own undo records are never read as part of the change', async () => {
    const undoDir = path.join(repo, '.neuma', 'edit-undo');
    await fs.mkdir(undoDir, { recursive: true });
    await fs.writeFile(path.join(undoDir, '1700000000000.json'), '{"path":"/x","preEditContent":"SNAPSHOT-BODY"}');
    const diff = await collectReviewDiff(repo, { kind: 'uncommitted' });
    expect(diff).not.toContain('SNAPSHOT-BODY');
    expect(diff).not.toContain('.neuma');
    expect(diff).toContain('+export const fresh = true;');
    await fs.rm(path.join(repo, '.neuma'), { recursive: true });
  });

  test('gathering changes nothing in the working tree or the index', async () => {
    const before = git('status', '--porcelain');
    await collectReviewDiff(repo, { kind: 'uncommitted' });
    expect(git('status', '--porcelain')).toBe(before);
  });

  test('the turn runs with hands held, and the standing mode is back afterwards', async () => {
    const connection = { toolMode: 'ask' };
    const seen = [];
    const result = await runReview({
      connection, ground: repo, argText: '',
      runTurn: async (thought) => { seen.push({ mode: connection.toolMode, thought }); },
    });
    expect(result).toEqual({ ran: true, said: '' });
    expect(seen).toHaveLength(1);
    expect(seen[0].mode).toBe('observe');
    expect(seen[0].thought).toContain('CODE REVIEW — everything uncommitted');
    expect(seen[0].thought).toContain('+export const fresh = true;');
    expect(connection.toolMode).toBe('ask');
  });

  test('the standing mode comes back even when the turn throws', async () => {
    const connection = { toolMode: 'auto' };
    await expect(runReview({
      connection, ground: repo, argText: '', runTurn: async () => { throw new Error('substrate fell over'); },
    })).rejects.toThrow('substrate fell over');
    expect(connection.toolMode).toBe('auto');
  });

  test('an unknown ref is reported in git\'s own words and no turn runs', async () => {
    const connection = { toolMode: 'ask' };
    let turns = 0;
    const result = await runReview({
      connection, ground: repo, argText: 'commit no-such-ref', runTurn: async () => { turns += 1; },
    });
    expect(result.ran).toBe(false);
    expect(result.said).toMatch(/git could not read that/);
    expect(turns).toBe(0);
    expect(connection.toolMode).toBe('ask');
  });

  test('a clean tree has nothing to review and no turn runs', async () => {
    const clean = await createTempDir('review-turn-clean');
    const cleanGit = gitIn(clean);
    cleanGit('init', '-q', '-b', 'main');
    await fs.writeFile(path.join(clean, 'a.txt'), 'a\n');
    cleanGit('add', 'a.txt');
    cleanGit('commit', '-q', '-m', 'only');
    let turns = 0;
    const result = await runReview({
      connection: { toolMode: 'ask' }, ground: clean, argText: '', runTurn: async () => { turns += 1; },
    });
    expect(result).toEqual({ ran: false, said: 'review: nothing has changed — there is nothing to review' });
    expect(turns).toBe(0);
  });
});

describe('/review — a change too large to show whole', () => {
  const file = (name, lines) => `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n${'+x\n'.repeat(lines)}`;

  test('is cut on a file boundary and the files left out are named', () => {
    const diff = file('one.js', 10) + file('two.js', 10) + file('three.js', 10);
    const fitted = fitReviewDiff(diff, file('one.js', 10).length + 5);
    expect(fitted.text).toBe(file('one.js', 10));
    expect(fitted.omitted).toEqual(['two.js', 'three.js']);
    expect(reviewPrompt({ kind: 'uncommitted' }, fitted)).toContain('NOT reviewed unless you read them yourself: two.js, three.js');
  });

  test('a change that fits is shown whole and nothing is called omitted', () => {
    const diff = file('one.js', 3);
    expect(fitReviewDiff(diff)).toEqual({ text: diff, omitted: [] });
    expect(reviewPrompt({ kind: 'commit', ref: 'abc123' }, fitReviewDiff(diff))).not.toContain('NOT reviewed');
  });
});

describe('/review — the mode it sets really holds the hands (the real act gate)', () => {
  // The sitting exactly as `neuma code --yes` builds it: the shell pre-approved
  // for the session. The review's hold must win over that grant.
  const sitting = () => {
    const connection = createPortalConnection({ ws: { send() {} }, walletAddress: '0x0000000000000000000000000000000000000001' });
    connection.companion = { name: 'Reviewer', neumaId: 'review-gate-proof' };
    connection._sessionToolPolicy = addAllowedTool(null, 'coding', 'execute');
    return connection;
  };
  const gate = (server, tool) => gateAct(sitting(), { server, tool, mode: 'observe', emit: () => {} });

  test.each([
    ['fs', 'write'], ['fs', 'edit'], ['fs', 'move'], ['fs', 'copy'],
    ['filesystem', 'delete_file'], ['coding', 'execute'],
  ])('%s/%s is held', async (server, tool) => {
    const verdict = await gate(server, tool);
    expect(verdict.ok).toBe(false);
    expect(verdict.result.status).toBe('denied');
  });

  test.each([['fs', 'read'], ['fs', 'search'], ['fs', 'list']])('%s/%s stays open', async (server, tool) => {
    expect((await gate(server, tool)).ok).toBe(true);
  });
});
