// serving-source-authority.test.js — Founder's law 2026-08-16: the repository
// workspace is NOT a gate. Refinement's cleanliness law governs datasets, not
// the git tree; the daily serving boot and every authority consumer resolve
// the commit-pinned identity over a dirty checkout. Real git, no mocks.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveCleanTrackedSource } from '../../backend/services/tracked-source-freshness.js';
import {
  openRefinementSourceAuthority,
  assertRefinementSourceAuthority,
  projectRefinementSourceResolver,
} from '../../backend/services/refinement-source-authority.js';
import { createRefinementProcessOperation } from '../../backend/services/refinement-process-operation.js';

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

const makeDirtyRepo = () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-src-id-')));
  git(dir, ['init', '-q']);
  git(dir, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'root']);
  fs.writeFileSync(path.join(dir, 'tracked.txt'), 'v1\n');
  git(dir, ['add', 'tracked.txt']);
  git(dir, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'tracked']);
  // The dirt: one tracked modification and one untracked file.
  fs.writeFileSync(path.join(dir, 'tracked.txt'), 'v2 — uncommitted\n');
  fs.writeFileSync(path.join(dir, 'scratch.md'), 'an open ledger\n');
  return dir;
};

describe('resolveCleanTrackedSource — commit-pinned identity, never a workspace gate', () => {
  let dir;
  beforeEach(() => { dir = makeDirtyRepo(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('resolves the commit identity over a DIRTY tree — dirt never holds a boot hostage', async () => {
    const id = await resolveCleanTrackedSource({ sourceRoot: dir });
    expect(id.sourceCommit).toBe(git(dir, ['rev-parse', 'HEAD']));
    expect(id.rootTreeId).toBe(git(dir, ['rev-parse', 'HEAD^{tree}']));
  });

  it('honors a declared commit, matching or not', async () => {
    const head = git(dir, ['rev-parse', 'HEAD']);
    await expect(resolveCleanTrackedSource({ sourceRoot: dir, declaredCommit: head }))
      .resolves.toMatchObject({ sourceCommit: head });
    await expect(
      resolveCleanTrackedSource({ sourceRoot: dir, declaredCommit: '0'.repeat(40) }),
    ).rejects.toMatchObject({ code: 'SOURCE_FRESHNESS_UNAVAILABLE' });
  });

  it('refuses a non-repository root', async () => {
    const empty = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-src-id-none-')));
    try {
      await expect(resolveCleanTrackedSource({ sourceRoot: empty })).rejects.toThrow();
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('openRefinementSourceAuthority', () => {
  it('opens a branded authority over the real project root, dirty ledger files and all', async () => {
    const root = fs.realpathSync(path.resolve(import.meta.dirname, '../..'));
    const operation = createRefinementProcessOperation({ timeoutMs: 120_000 });
    const authority = await openRefinementSourceAuthority({ operation });
    expect(authority.sourceCommit).toBe(git(root, ['rev-parse', 'HEAD']));
    expect(authority.rootTreeId).toBe(git(root, ['rev-parse', 'HEAD^{tree}']));
    // The brand holds: the same asserts the lineage-config read relies on.
    expect(assertRefinementSourceAuthority(authority, operation)).toBe(authority);
    const resolver = projectRefinementSourceResolver(authority, operation);
    expect(resolver.sourceCommit).toBe(authority.sourceCommit);
    // …and the brand still binds: a foreign operation may not wield it.
    const other = createRefinementProcessOperation({ timeoutMs: 120_000 });
    expect(() => assertRefinementSourceAuthority(authority, other)).toThrow(/not bound/);
  });
});
