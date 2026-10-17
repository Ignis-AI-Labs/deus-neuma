/**
 * Tests for files-refresh-apply — the pure plan behind the FILES tree's
 * changed-files listener (frontend/app/RelinkShell/files/files-refresh-apply.js).
 */
import { describe, it, expect } from 'vitest';
import { refreshPlanFor, mergeRefreshPlans, gitRootsFor } from '../../frontend/app/RelinkShell/files/files-refresh-apply.js';

describe('refreshPlanFor', () => {
  it('a single path re-lists its directory and re-probes git', () => {
    const plan = refreshPlanFor({ path: '/repo/src/index.js' }, []);
    expect(plan.dirs).toEqual(['/repo/src']);
    expect(plan.git).toBe(true);
  });

  it('bulk re-lists the root and every expanded dir under it — and nothing beside it', () => {
    const expanded = new Set(['/repo', '/repo/src', '/repo/src/deep', '/other', '/repofake']);
    const plan = refreshPlanFor({ bulk: '/repo' }, expanded);
    expect(plan.dirs).toEqual(['/repo', '/repo/src', '/repo/src/deep']);
    expect(plan.git).toBe(true);
  });

  it('git-only re-probes badges without re-listing anything', () => {
    expect(refreshPlanFor({ git: true }, ['/repo'])).toEqual({ dirs: [], git: true });
  });

  it('junk asks for nothing', () => {
    expect(refreshPlanFor(null, [])).toEqual({ dirs: [], git: false });
    expect(refreshPlanFor({}, [])).toEqual({ dirs: [], git: false });
  });
});

// The burst fold behind the 429-storm fix: the live watch re-announces a
// backend frame per PATH, so one 300ms frame lands as up to 24 events — the
// listeners merge them back before any metered call is spent.
describe('mergeRefreshPlans', () => {
  it('a frame’s worth of path events folds to one plan — dirs unioned, git once', () => {
    const details = [
      { path: '/repo/src/a.js' },
      { path: '/repo/src/b.js' },
      { path: '/repo/docs/c.md' },
      { path: '/repo/src/a.js' }, // the same file twice in one burst
    ];
    const plan = mergeRefreshPlans(details, []);
    expect(plan.dirs).toEqual(['/repo/src', '/repo/docs']); // deduped, first-seen order
    expect(plan.git).toBe(true); // ONE re-probe owed, not four
  });

  it('a mixed burst keeps every shape’s truth — bulk children union in, git ORs', () => {
    const expanded = new Set(['/repo', '/repo/src']);
    const plan = mergeRefreshPlans(
      [{ git: true }, { path: '/repo/readme.md' }, { bulk: '/repo' }],
      expanded,
    );
    expect(plan.dirs).toEqual(['/repo', '/repo/src']);
    expect(plan.git).toBe(true);
  });

  it('junk bursts ask for nothing', () => {
    expect(mergeRefreshPlans([], [])).toEqual({ dirs: [], git: false });
    expect(mergeRefreshPlans([null, {}, undefined], [])).toEqual({ dirs: [], git: false });
  });
});

// The ROOT axis of the 429 storm (audit, 2026-09-02): folding the burst to
// one flush still probed EVERY open root — 14 metered calls per flush on this
// desk. gitRootsFor scopes the re-probe to the roots that actually moved.
describe('gitRootsFor — the burst probes only what moved', () => {
  const ROOTS = ['/repo', '/repo/backend', '/other', '/plain'];

  it('a burst under one root probes THAT root only', () => {
    const plan = mergeRefreshPlans([{ path: '/repo/src/a.js' }, { path: '/repo/docs/b.md' }], []);
    expect(gitRootsFor(plan, ROOTS)).toEqual(['/repo']);
  });

  it('a nested root is covered by its own spelling — both matching roots probe', () => {
    const plan = mergeRefreshPlans([{ path: '/repo/backend/src/x.js' }], []);
    expect(gitRootsFor(plan, ROOTS)).toEqual(['/repo', '/repo/backend']);
  });

  it('a separator boundary — a sibling with a shared prefix does NOT match', () => {
    const plan = mergeRefreshPlans([{ path: '/repofake/src/a.js' }], ['/repo', '/repofake']);
    expect(gitRootsFor(plan, ['/repo', '/repofake'])).toEqual(['/repofake']);
  });

  it('a git-only frame (a commit, a checkout) names no dir — every badge owes the truth', () => {
    const plan = mergeRefreshPlans([{ git: true }], []);
    expect(gitRootsFor(plan, ROOTS)).toEqual(ROOTS);
  });

  it('no roots open probes nothing', () => {
    expect(gitRootsFor({ dirs: ['/repo'], git: true }, [])).toEqual([]);
    expect(gitRootsFor({ dirs: ['/repo'], git: true }, null)).toEqual([]);
  });
});
