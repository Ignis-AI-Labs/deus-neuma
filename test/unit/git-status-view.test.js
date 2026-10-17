/**
 * Tests for git-status-view — the pure badge logic behind the explorer's git
 * decorations (frontend/app/RelinkShell/files/git-status-view.js): per-file
 * letters, directory rollups by strength, repo-relative paths, hover words,
 * and the divergence readout.
 */
import { describe, expect, test } from 'vitest';
import { badgeFor, badgeWord, divergenceLabel, isIgnored, repoRel, repoState } from '../../frontend/app/RelinkShell/files/git-status-view.js';

describe('repoRel', () => {
  test('strips the root and the leading slash; the root itself is empty', () => {
    expect(repoRel('/repo', '/repo/backend/a.js')).toBe('backend/a.js');
    expect(repoRel('/repo', '/repo')).toBe('');
    expect(repoRel('/repo/', '/repo/x.js')).toBe('x.js');
  });
});

describe('badgeFor — files wear their own letter', () => {
  const files = { 'a.js': 'M', 'sub/b.js': 'U', 'sub/deep/c.js': 'C', 'gone.js': 'D' };

  test('a file row gets its letter or null when clean', () => {
    expect(badgeFor(files, 'a.js', false)).toBe('M');
    expect(badgeFor(files, 'gone.js', false)).toBe('D');
    expect(badgeFor(files, 'clean.js', false)).toBeNull();
  });

  test('a dir rolls up the STRONGEST descendant letter (C > D > M > A > U)', () => {
    expect(badgeFor(files, 'sub', true)).toBe('C'); // deep conflict outranks the untracked sibling
    expect(badgeFor(files, 'sub/deep', true)).toBe('C');
    expect(badgeFor({ 'd/a.js': 'U', 'd/b.js': 'M' }, 'd', true)).toBe('M');
    expect(badgeFor({ 'd/a.js': 'A', 'd/b.js': 'U' }, 'd', true)).toBe('A');
  });

  test('the root (rel "") rolls up everything; a clean dir is null', () => {
    expect(badgeFor(files, '', true)).toBe('C');
    expect(badgeFor(files, 'quiet', true)).toBeNull();
    expect(badgeFor({}, '', true)).toBeNull();
  });

  test('a dir prefix never matches a sibling that merely shares a prefix', () => {
    expect(badgeFor({ 'subtle/x.js': 'M' }, 'sub', true)).toBeNull();
  });

  test('null/undefined status degrades to no badges', () => {
    expect(badgeFor(null, 'a.js', false)).toBeNull();
    expect(badgeFor(undefined, '', true)).toBeNull();
  });
});

describe('badgeWord', () => {
  test('every letter has its hover word; unknowns pass through null', () => {
    expect(badgeWord('C')).toBe('conflicted');
    expect(badgeWord('D')).toBe('deleted');
    expect(badgeWord('M')).toBe('modified');
    expect(badgeWord('A')).toBe('added');
    expect(badgeWord('U')).toBe('untracked');
    expect(badgeWord(null)).toBeNull();
  });
});

describe('divergenceLabel', () => {
  test('only real divergence speaks — never ↑0 ↓0 noise', () => {
    expect(divergenceLabel(2, 1)).toBe('↑2 ↓1');
    expect(divergenceLabel(3, 0)).toBe('↑3');
    expect(divergenceLabel(0, 4)).toBe('↓4');
    expect(divergenceLabel(0, 0)).toBe('');
  });
});

describe('repoState — the focus name’s color', () => {
  test('conflicted outranks dirty; empty is clean; junk degrades to clean', () => {
    expect(repoState({ 'a.js': 'M', 'b.js': 'C' })).toBe('conflicted');
    expect(repoState({ 'a.js': 'U' })).toBe('dirty');
    expect(repoState({})).toBe('clean');
    expect(repoState(null)).toBe('clean');
    expect(repoState(undefined)).toBe('clean');
  });
});

describe('isIgnored — exact and collapsed-dir prefix matching', () => {
  const ignored = ['node_modules', 'debug.log', 'build'];

  test('exact file, collapsed dir, and rows deep inside one', () => {
    expect(isIgnored(ignored, 'debug.log')).toBe(true);
    expect(isIgnored(ignored, 'node_modules')).toBe(true);
    expect(isIgnored(ignored, 'node_modules/react/index.js')).toBe(true);
    expect(isIgnored(ignored, 'build/out.js')).toBe(true);
  });

  test('clean rows, the root, and prefix-siblings are NOT ignored', () => {
    expect(isIgnored(ignored, 'src/a.js')).toBe(false);
    expect(isIgnored(ignored, '')).toBe(false); // the root itself is never "ignored"
    expect(isIgnored(ignored, 'builder')).toBe(false); // shares a prefix, not a boundary
    expect(isIgnored(ignored, 'debug.log2')).toBe(false);
  });

  test('missing list degrades to false', () => {
    expect(isIgnored(null, 'node_modules')).toBe(false);
    expect(isIgnored(undefined, 'node_modules')).toBe(false);
  });
});
