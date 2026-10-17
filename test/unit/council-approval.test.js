/**
 * The council's approval-law pure parts (backend/services/council-session.js:
 * callPaths, outsideRoots) — which of a call's targets stand outside the
 * standing roots, decided BEFORE execution so the witness can be ASKED
 * instead of the member hitting a flat wall.
 */
import { describe, expect, test } from 'vitest';
import path from 'node:path';
import { callPaths, outsideRoots } from '../../backend/services/council-session.js';

describe('callPaths', () => {
  test('collects path, source, and destination — move carries two', () => {
    expect(callPaths({ args: { path: '/a/b.md' } })).toEqual(['/a/b.md']);
    expect(callPaths({ args: { source: '/a/b.md', destination: '/c/d.md' } }))
      .toEqual(['/a/b.md', '/c/d.md']);
    expect(callPaths({ args: { pattern: 'doc' } })).toEqual([]);
    expect(callPaths({})).toEqual([]);
  });
});

describe('outsideRoots — the containment law, asked ahead', () => {
  const HOUSE = path.resolve('/mnt/data/neuma/guardian/omberly/house');

  test('a path inside the house ground is not outside', () => {
    expect(outsideRoots([`${HOUSE}/positions.md`], [HOUSE])).toEqual([]);
    expect(outsideRoots([HOUSE], [HOUSE])).toEqual([]);
  });

  test("Rugevil's live read — the repo docs stand OUTSIDE the house ground", () => {
    const target = path.resolve('/workspace/repos/neuma/docs/governance/house-roles.md');
    expect(outsideRoots([target], [HOUSE])).toEqual([target]);
  });

  test('separator boundary — a sibling with the root as prefix is outside', () => {
    expect(outsideRoots([`${HOUSE}-annex/x.md`], [HOUSE])).toEqual([`${HOUSE}-annex/x.md`]);
  });

  test('a granted extra root brings its subtree inside', () => {
    const docs = path.resolve('/workspace/repos/neuma/docs');
    expect(outsideRoots([`${docs}/governance/house-roles.md`], [HOUSE, docs])).toEqual([]);
  });

  test('null/empty roots are ignored, never matched', () => {
    expect(outsideRoots(['/x/y.md'], [null, undefined, ''])).toEqual(['/x/y.md']);
  });
});
