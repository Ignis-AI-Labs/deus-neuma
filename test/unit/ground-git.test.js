/**
 * Ground git metadata — the pure layer.
 *
 * These are pure functions called with real inputs and checked against real
 * outputs: no mock is involved anywhere in the path being claimed (RULE 0).
 * The porcelain and rev-list strings below are verbatim shapes taken from real
 * `git` output on this machine (git 2.54.0), not invented ones.
 */
import { describe, test, expect } from 'vitest';
import {
  parseStatusCounts, parseAheadBehind, formatGroundGit,
} from '../../backend/services/ground-git.js';

describe('parseStatusCounts', () => {
  test('a clean tree counts nothing', () => {
    expect(parseStatusCounts('')).toEqual({ staged: 0, modified: 0, untracked: 0 });
  });

  test('untracked entries are counted apart from tracked changes', () => {
    // Verbatim from `git -C /workspace/repos/project-nuniver status --porcelain=v1`.
    const porcelain = [
      '?? docs/reference/ignis-business-plan-v1.md',
      '?? docs/reference/umbrae-business-plan-v5.md',
      '?? docs/reference/umbrae-rewards-model.md',
      '?? media/',
    ].join('\n');
    expect(parseStatusCounts(porcelain)).toEqual({ staged: 0, modified: 0, untracked: 4 });
  });

  test('the index column and the worktree column are counted independently', () => {
    // ' M' = modified, unstaged. 'M ' = staged. 'MM' = staged AND modified since.
    const porcelain = [' M a.js', 'M  b.js', 'MM c.js', 'A  d.js'].join('\n');
    expect(parseStatusCounts(porcelain)).toEqual({ staged: 3, modified: 2, untracked: 0 });
  });

  test('a trailing newline does not invent a fourth entry', () => {
    expect(parseStatusCounts(' M a.js\n?? b.js\n')).toEqual({ staged: 0, modified: 1, untracked: 1 });
  });
});

describe('parseAheadBehind', () => {
  test('reads the tab-separated pair git actually emits', () => {
    expect(parseAheadBehind('0\t0')).toEqual({ ahead: 0, behind: 0 });
    expect(parseAheadBehind('3\t7\n')).toEqual({ ahead: 3, behind: 7 });
  });

  test('anything that is not two integers is refused rather than guessed', () => {
    expect(parseAheadBehind('')).toBeNull();
    expect(parseAheadBehind('4')).toBeNull();
    expect(parseAheadBehind('fatal: no upstream configured')).toBeNull();
  });
});

describe('formatGroundGit', () => {
  test('a tracked branch reports its divergence', () => {
    const text = formatGroundGit({
      ground: '/workspace/repos/project-nuniver',
      isRepository: true,
      branch: 'main',
      head: '8581bc7336d7',
      upstream: 'origin/main',
      ahead: 0,
      behind: 0,
      staged: 0,
      modified: 0,
      untracked: 4,
    });
    expect(text).toContain('branch:   main');
    expect(text).toContain('upstream: origin/main (ahead 0, behind 0)');
    expect(text).toContain('dirty:    0 staged, 0 modified, 4 untracked');
  });

  test('an untracked branch says so instead of implying a remote', () => {
    const text = formatGroundGit({
      ground: '/tmp/solo',
      isRepository: true,
      branch: 'main',
      head: 'abc123def456',
      upstream: null,
      ahead: 0,
      behind: 0,
      staged: 0,
      modified: 0,
      untracked: 0,
    });
    expect(text).toContain('upstream: (no upstream tracking branch)');
  });

  test('a non-repository is named as one, with no invented branch', () => {
    const text = formatGroundGit({ ground: '/tmp/plain', isRepository: false });
    expect(text).toContain('git:      (not a git repository)');
    expect(text).not.toContain('branch:');
  });

  test('no remote URL can appear — the formatter never reads one', () => {
    const text = formatGroundGit({
      ground: '/tmp/x',
      isRepository: true,
      branch: 'main',
      head: 'abc123def456',
      upstream: 'origin/main',
      ahead: 0,
      behind: 0,
      staged: 0,
      modified: 0,
      untracked: 0,
    });
    expect(text).not.toMatch(/https?:\/\/|git@|ssh:\/\//);
  });
});
