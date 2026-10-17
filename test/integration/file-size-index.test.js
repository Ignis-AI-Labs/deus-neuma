import { afterEach, beforeEach, expect, test } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

let root;
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const write = (name, text) => writeFileSync(path.join(root, name), text);
const lines = (n) => '// content\n'.repeat(n);
const run = (mode) => spawnSync(process.execPath, ['scripts/check-file-size.mjs', mode], { cwd: root, encoding: 'utf8' });

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'neuma-size-index-'));
  mkdirSync(path.join(root, 'scripts/git-hooks'), { recursive: true });
  copyFileSync(fileURLToPath(new URL('../../scripts/check-file-size.mjs', import.meta.url)), path.join(root, 'scripts/check-file-size.mjs'));
  copyFileSync(fileURLToPath(new URL('../../scripts/git-hooks/pre-commit', import.meta.url)), path.join(root, 'scripts/git-hooks/pre-commit'));
  git('init', '-q');
  git('config', 'user.name', 'Local size proof');
  git('config', 'user.email', 'size-proof@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.hooksPath', 'scripts/git-hooks');
  write('scripts/file-size-baseline.json', '{}\n');
  git('add', 'scripts/file-size-baseline.json');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test('oversized staged blob is refused even when disk was shortened', () => {
  write('sample.js', lines(501)); git('add', 'sample.js');
  write('sample.js', lines(1));
  const result = run('--staged');
  expect(result.status, result.stderr).toBe(1);
  expect(result.stdout).toContain('501 lines');
});

test('lawful staged blob passes even when disk grew', () => {
  write('sample.js', lines(1)); git('add', 'sample.js');
  write('sample.js', lines(501));
  expect(run('--staged').status).toBe(0);
});

test('unstaged baseline edits cannot authorize oversized staged content', () => {
  write('sample.js', lines(601)); git('add', 'sample.js');
  write('scripts/file-size-baseline.json', JSON.stringify({ 'sample.js': 601 }));
  expect(run('--staged').status).toBe(1);
});

test('staged baseline and generated exemption are read from the index', () => {
  write('sample.js', lines(601));
  write('scripts/file-size-baseline.json', JSON.stringify({ 'sample.js': 601 }));
  write('generated.js', '// GENERATED FILE\n' + lines(1100));
  git('add', 'sample.js', 'generated.js', 'scripts/file-size-baseline.json');
  write('scripts/file-size-baseline.json', '{}');
  write('generated.js', lines(1101));
  expect(run('--staged').status).toBe(0);
});

test('quoted and newline filenames cannot escape staged scanning', () => {
  const name = 'quote"and\nnewline.js';
  write(name, lines(501)); git('add', '--', name);
  expect(run('--staged').status).toBe(1);
});

test('real pre-commit refuses a staged violation and permits the correction', () => {
  write('sample.js', lines(501)); git('add', 'sample.js');
  write('sample.js', lines(1));
  const refused = spawnSync('git', ['commit', '-m', 'must refuse'], { cwd: root, encoding: 'utf8' });
  expect(refused.status, refused.stdout + refused.stderr).not.toBe(0);
  expect(spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: root }).status).not.toBe(0);
  git('add', 'sample.js');
  git('commit', '-m', 'lawful content');
  expect(git('show', 'HEAD:sample.js')).toBe(lines(1));
});

test('baseline verification still measures disk and never rewrites it', () => {
  write('sample.js', lines(601));
  write('scripts/file-size-baseline.json', JSON.stringify({ 'sample.js': 601 }));
  const before = readFileSync(path.join(root, 'scripts/file-size-baseline.json'));
  expect(run('--verify-baseline').status).toBe(0);
  for (const n of [600, 602]) {
    write('sample.js', lines(n));
    expect(run('--verify-baseline').status).toBe(1);
  }
  rmSync(path.join(root, 'sample.js'));
  expect(run('--verify-baseline').status).toBe(1);
  expect(readFileSync(path.join(root, 'scripts/file-size-baseline.json'))).toEqual(before);
});


test('pathspec commits still execute the hook against their temporary index', () => {
  write('sample.js', lines(1)); git('add', 'sample.js'); git('commit', '-m', 'initial');
  const head = git('rev-parse', 'HEAD');
  write('sample.js', lines(501));
  const result = spawnSync('git', ['commit', '-m', 'must refuse', '--', 'sample.js'], { cwd: root, encoding: 'utf8' });
  expect(result.status, result.stdout + result.stderr).not.toBe(0);
  expect(git('rev-parse', 'HEAD')).toBe(head);
  expect(result.stdout + result.stderr).toContain('501 lines');
});

test('renaming a frozen oversized file cannot evade its new path judgment', () => {
  write('old.js', lines(601));
  write('scripts/file-size-baseline.json', JSON.stringify({ 'old.js': 601 }));
  git('add', 'old.js', 'scripts/file-size-baseline.json'); git('commit', '-m', 'frozen predecessor');
  git('mv', 'old.js', 'new.js');
  const result = run('--staged');
  expect(result.status, result.stderr).toBe(1);
  expect(result.stdout).toContain('new.js: 601 lines');
});
