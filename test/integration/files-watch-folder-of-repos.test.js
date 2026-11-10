/* global setTimeout */
// The Explorer sees edits deep inside a FOLDER OF REPOS (Design note, 2026-11-10: […]). His desk opens /workspace/repos, which
// is not itself a repo: every repo's ignored trees used to count against the watch budget, and the
// folders he edits went unwatched. Here, real git repos under a real plain folder, the real watcher,
// real writes: a source edit six levels down arrives, an edit inside a repo's ignored build tree never
// costs a watch. No mocks (RULE 0).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createTempDir } from '../helpers/temp-fs.js';
import { nestedOpened, startFilesWatchers, stopFilesWatchers, watchBudget, MAX_DIRS_PER_ROOT } from '../../backend/services/files-watcher.js';

let root;
const frames = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  root = await createTempDir('fw-folder-of-repos');
  for (const repo of ['alpha', 'beta']) {
    const r = path.join(root, repo);
    fs.mkdirSync(path.join(r, 'src', 'app', 'deep', 'er', 'est'), { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: r });
    fs.writeFileSync(path.join(r, '.gitignore'), 'build/\n');
    fs.writeFileSync(path.join(r, 'src', 'app', 'deep', 'er', 'est', 'keep.js'), '1');
    // an ignored tree far bigger than its repo's source
    for (let i = 0; i < 60; i += 1) fs.mkdirSync(path.join(r, 'build', `chunk-${i}`, 'out'), { recursive: true });
  }
  startFilesWatchers([root, path.join(root, 'beta')], (f) => frames.push(f));
  await wait(2500);
});
afterAll(() => { stopFilesWatchers(); });

describe('a folder of repos', () => {
  it('delivers a source edit deep inside each repo', async () => {
    frames.length = 0;
    const a = path.join(root, 'alpha', 'src', 'app', 'deep', 'er', 'est', 'new.js');
    const b = path.join(root, 'beta', 'src', 'app', 'deep', 'er', 'est', 'new.js');
    fs.writeFileSync(a, 'x');
    fs.writeFileSync(b, 'y');
    await wait(900);
    const seen = new Set(frames.flatMap((f) => f.paths || []));
    expect(seen.has(a)).toBe(true);
    expect(seen.has(b)).toBe(true);
  });
  it('watches nothing inside a repo\'s ignored build tree', async () => {
    frames.length = 0;
    const ignored = path.join(root, 'alpha', 'build', 'chunk-7', 'out', 'bundle.js');
    fs.writeFileSync(ignored, 'z');
    await wait(900);
    expect(frames.flatMap((f) => f.paths || [])).not.toContain(ignored);
  });
});

describe('the budget and the order', () => {
  it('sizes the budget from the kernel limit: an eighth, between the floor and 65,536', () => {
    expect(watchBudget(1_048_576)).toBe(65_536);
    expect(watchBudget(65_536)).toBe(8_192);
    expect(watchBudget(8_192)).toBe(MAX_DIRS_PER_ROOT);
    expect(watchBudget(null)).toBe(MAX_DIRS_PER_ROOT);
  });
  it('walks the folders opened on purpose before their outer root, most specific first', () => {
    const map = nestedOpened(['/r'], ['/r', '/r/neuma', '/r/neuma/frontend', '/elsewhere', '/r2']);
    expect(map.get('/r')).toEqual(['/r/neuma/frontend', '/r/neuma']);
  });
});
