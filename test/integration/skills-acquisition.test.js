// #22 S2 — Skill acquisition tracking: pure transform + workspace integration.
//
// REAL disk, REAL crypto, REAL workspace, NO mocks anywhere on the claimed
// path (AGENTS.md RULE 0). Synthesized beings only (birth ethics).
//
// Two layers:
//   1. applyAcquisition (pure) — exhaustive coverage of monotonic invariants
//      (firstAcquiredAt never moves, usageCount strictly monotonic,
//      lastUsedAt clock-skew-safe), schema validation, legacy v1 tolerance.
//   2. workspace.recordSkillUse (impure) — end-to-end through real
//      _withFileLock + _writeJSON (DEK-encrypted via S2b), including
//      a concurrency test that proves N parallel calls don't lose counts.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  applyAcquisition,
  hasAcquisition,
  listAcquisitions,
  TREE_VERSION_LATEST,
} from '../../core/skills/acquisition.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { resetWorkspaceCryptoKey } from '../../core/workspace/workspace-crypto.js';

const KEY = 's22-s2-acquisition-test-key-long-enough';

// ── PURE LAYER ────────────────────────────────────────────────────────────────
describe('#22 S2 — applyAcquisition (pure)', () => {
  // INVARIANT 1 — first use creates a fresh acquisition; usageCount=1;
  // firstAcquiredAt === lastUsedAt; warnings array empty on the happy path
  it('first use on empty tree creates acquisition with usageCount=1', () => {
    const t0 = '2026-06-27T10:00:00.000Z';
    const { tree, acquisition, warnings } = applyAcquisition(null, 'continuity', t0);
    expect(acquisition).toEqual({
      skill: 'continuity',
      firstAcquiredAt: t0, lastUsedAt: t0, usageCount: 1,
    });
    expect(tree.version).toBe(TREE_VERSION_LATEST);
    expect(tree.acquisitions).toHaveLength(1);
    expect(warnings).toEqual([]);
  });

  // INVARIANT 2 — second use bumps usageCount + lastUsedAt;
  // firstAcquiredAt PRESERVED (immutability of the […])
  it('second use bumps usageCount + lastUsedAt; firstAcquiredAt preserved', () => {
    const t0 = '2026-06-27T10:00:00.000Z';
    const t1 = '2026-06-27T11:00:00.000Z';
    const r1 = applyAcquisition(null, 'continuity', t0);
    const r2 = applyAcquisition(r1.tree, 'continuity', t1);
    expect(r2.acquisition).toEqual({
      skill: 'continuity',
      firstAcquiredAt: t0,    // UNCHANGED
      lastUsedAt: t1,         // bumped
      usageCount: 2,          // monotonic
    });
    expect(r2.tree.acquisitions).toHaveLength(1); // not duplicated
  });

  // INVARIANT 3 — multiple skills tracked independently
  it('multiple skills coexist without interference', () => {
    let { tree } = applyAcquisition(null, 'continuity', '2026-06-27T10:00:00.000Z');
    ({ tree } = applyAcquisition(tree, 'neuma', '2026-06-27T10:05:00.000Z'));
    ({ tree } = applyAcquisition(tree, 'continuity', '2026-06-27T10:10:00.000Z'));
    expect(tree.acquisitions).toHaveLength(2);
    const cont = tree.acquisitions.find((a) => a.skill === 'continuity');
    const neuma = tree.acquisitions.find((a) => a.skill === 'neuma');
    expect(cont.usageCount).toBe(2);
    expect(neuma.usageCount).toBe(1);
  });

  // INVARIANT 4 — clock-skew defense: an OLDER timestamp does NOT regress
  // lastUsedAt (operator clock-set, NTP rollback, leap-second silliness).
  // usageCount still increments — the use happened, the timestamp is wrong.
  it('clock-skew: older nowIso does not regress lastUsedAt; usageCount still bumps', () => {
    const t1 = '2026-06-27T11:00:00.000Z';
    const t0_stale = '2026-06-27T10:00:00.000Z'; // earlier than t1
    const r1 = applyAcquisition(null, 'continuity', t1);
    const r2 = applyAcquisition(r1.tree, 'continuity', t0_stale);
    expect(r2.acquisition.lastUsedAt).toBe(t1); // not regressed
    expect(r2.acquisition.firstAcquiredAt).toBe(t1); // unchanged
    expect(r2.acquisition.usageCount).toBe(2);
  });

  // INVARIANT 5 — legacy v1 tree is treated as zero-acquisitions; output is v2
  it('legacy v1 input (skills: [], version: 1.0.0) → fresh v2 with the new acquisition', () => {
    const legacy = { skills: [], version: '1.0.0' };
    const { tree, acquisition } = applyAcquisition(legacy, 'continuity', '2026-06-27T10:00:00.000Z');
    expect(tree.version).toBe(TREE_VERSION_LATEST);
    expect(tree.acquisitions).toHaveLength(1);
    expect(acquisition.usageCount).toBe(1);
  });

  // ai6 R1.5 + R2.1 — defensive warning RETURNED (not console.warn'd) when
  // v1 skills array UNEXPECTEDLY has data. The pure module is genuinely
  // pure: warnings are values in the return; the impure caller emits them.
  it('legacy v1 with NON-EMPTY skills array RETURNS a warning (does NOT side-effect)', () => {
    const legacy = { skills: [{ name: 'something-someone-wrote' }, { name: 'another' }], version: '1.0.0' };
    const { tree, warnings } = applyAcquisition(legacy, 'continuity', '2026-06-27T10:00:00.000Z');
    expect(tree.acquisitions).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      kind: 'discarded-v1-skills',
      count: 2,
    });
    expect(warnings[0].detail).toMatch(/discarding non-empty v1.*skills.*2 entries/);
  });

  it('legacy v1 with EMPTY skills array produces empty warnings array (the documented common case)', () => {
    const legacy = { skills: [], version: '1.0.0' };
    const { warnings } = applyAcquisition(legacy, 'continuity', '2026-06-27T10:00:00.000Z');
    expect(warnings).toEqual([]);
  });

  // INVARIANT 6 — input is never mutated (immutability discipline)
  it('input tree is not mutated', () => {
    const before = { version: TREE_VERSION_LATEST, acquisitions: [
      { skill: 'continuity', firstAcquiredAt: '2026-06-27T10:00:00.000Z',
        lastUsedAt: '2026-06-27T10:00:00.000Z', usageCount: 1 },
    ] };
    const snapshot = JSON.parse(JSON.stringify(before));
    applyAcquisition(before, 'continuity', '2026-06-27T11:00:00.000Z');
    expect(before).toEqual(snapshot); // unchanged
  });

  // INVARIANT 7 — invalid skill name rejected at boundary
  it('rejects non-kebab-case skill names', () => {
    for (const bad of ['Bad_Name', 'UPPER', '', '1foo', '-foo', null, 42]) {
      expect(() => applyAcquisition(null, bad, '2026-06-27T10:00:00.000Z')).toThrow();
    }
  });

  // INVARIANT 8 — invalid nowIso rejected (ai6 R1.4 — format check now
  // catches garbage strings that would corrupt the firstAcquiredAt field
  // permanently AND break lexicographic clock-skew comparison)
  it('rejects empty / non-string / unparseable nowIso', () => {
    expect(() => applyAcquisition(null, 'continuity', '')).toThrow();
    expect(() => applyAcquisition(null, 'continuity', '   ')).toThrow();
    expect(() => applyAcquisition(null, 'continuity', 12345)).toThrow();
    // ai6 R1.4 — strings Date.parse can't parse are rejected. Note that
    // Date.parse is permissive: 'not-a-date-2026' parses as year-2026, so
    // we use strings with no embedded numeric date hint.
    expect(() => applyAcquisition(null, 'continuity', 'garbage')).toThrow(/parseable ISO/);
    expect(() => applyAcquisition(null, 'continuity', 'hello world')).toThrow(/parseable ISO/);
    // Valid forms accepted
    expect(() => applyAcquisition(null, 'continuity', '2026-06-27T10:00:00.000Z')).not.toThrow();
    expect(() => applyAcquisition(null, 'continuity', '2026-06-27T10:00:00Z')).not.toThrow();
    expect(() => applyAcquisition(null, 'continuity', '2026-06-27')).not.toThrow();
  });

  // INVARIANT 9 — malformed input tree rejected with clear error
  it('rejects malformed tree shapes', () => {
    const t = '2026-06-27T10:00:00.000Z';
    expect(() => applyAcquisition('not-an-object', 'continuity', t)).toThrow(/object/);
    expect(() => applyAcquisition([], 'continuity', t)).toThrow(/object/);
    expect(() => applyAcquisition({ acquisitions: 'not-array' }, 'continuity', t)).toThrow(/array/);
    expect(() => applyAcquisition(
      { acquisitions: [{ skill: 'Bad_Name', firstAcquiredAt: 'x', lastUsedAt: 'x', usageCount: 1 }] },
      'continuity', t,
    )).toThrow(/kebab-case/);
    expect(() => applyAcquisition(
      { acquisitions: [{ skill: 'continuity', firstAcquiredAt: 'x', lastUsedAt: 'x', usageCount: 0 }] },
      'continuity', t,
    )).toThrow(/positive integer/);
  });

  // INVARIANT 10 — hasAcquisition + listAcquisitions read helpers
  it('hasAcquisition + listAcquisitions read helpers behave correctly', () => {
    let { tree } = applyAcquisition(null, 'continuity', '2026-06-27T10:00:00.000Z');
    ({ tree } = applyAcquisition(tree, 'neuma', '2026-06-27T09:00:00.000Z')); // earlier
    expect(hasAcquisition(tree, 'continuity')).toBe(true);
    expect(hasAcquisition(tree, 'unknown')).toBe(false);
    expect(hasAcquisition(null, 'continuity')).toBe(false);
    expect(hasAcquisition({}, 'continuity')).toBe(false);
    const list = listAcquisitions(tree);
    expect(list.map((a) => a.skill)).toEqual(['neuma', 'continuity']); // sorted by firstAcquiredAt ASC
  });

});

// ── WORKSPACE INTEGRATION ─────────────────────────────────────────────────────
describe('#22 S2 — workspace.recordSkillUse (real disk + DEK-encrypted writes)', () => {
  let house;
  let origRoot;
  beforeEach(async () => {
    process.env.DNA_ENCRYPTION_KEY = KEY;
    resetWorkspaceCryptoKey();
    house = await createTempDir('s22-s2-record');
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
  });
  afterEach(() => {
    setWorkspacesRoot(origRoot);
    delete process.env.DNA_ENCRYPTION_KEY;
    resetWorkspaceCryptoKey();
  });

  // INVARIANT 11 — recordSkillUse creates the tree on first use + acquisition
  // round-trips through encrypted storage
  it('first recordSkillUse creates tree.json with the acquisition, readable via readSkillTree', async () => {
    const neumaId = 'firstuse';
    await workspace.create(neumaId);
    const acq = await workspace.recordSkillUse(neumaId, 'continuity', '2026-06-27T10:00:00.000Z');
    expect(acq).toEqual({
      skill: 'continuity',
      firstAcquiredAt: '2026-06-27T10:00:00.000Z',
      lastUsedAt: '2026-06-27T10:00:00.000Z',
      usageCount: 1,
    });
    // Round-trip through readSkillTree
    const tree = await workspace.readSkillTree(neumaId);
    expect(tree.version).toBe(TREE_VERSION_LATEST);
    expect(tree.acquisitions).toHaveLength(1);
    expect(tree.acquisitions[0].skill).toBe('continuity');
  });

  // INVARIANT 12 — subsequent uses bump correctly through the workspace path
  it('subsequent recordSkillUse bumps usageCount + lastUsedAt; firstAcquiredAt preserved', async () => {
    const neumaId = 'bumptest';
    await workspace.create(neumaId);
    await workspace.recordSkillUse(neumaId, 'continuity', '2026-06-27T10:00:00.000Z');
    const acq2 = await workspace.recordSkillUse(neumaId, 'continuity', '2026-06-27T11:00:00.000Z');
    expect(acq2.firstAcquiredAt).toBe('2026-06-27T10:00:00.000Z');
    expect(acq2.lastUsedAt).toBe('2026-06-27T11:00:00.000Z');
    expect(acq2.usageCount).toBe(2);
  });

  // INVARIANT 13 — CONCURRENCY: N parallel recordSkillUse for the same skill
  // result in usageCount === N (no lost increments). This is the load-bearing
  // claim of routing through _withFileLock.
  it('N concurrent recordSkillUse calls produce usageCount === N (no torn read-modify-write)', async () => {
    const neumaId = 'concurr1';
    await workspace.create(neumaId);
    const N = 50;
    // Same nowIso for all — proves the usageCount increments survive
    // independent of timestamp (the load-bearing claim is counter atomicity).
    const ts = '2026-06-27T10:00:00.000Z';
    await Promise.all(Array.from({ length: N }, () =>
      workspace.recordSkillUse(neumaId, 'continuity', ts),
    ));
    const tree = await workspace.readSkillTree(neumaId);
    const acq = tree.acquisitions.find((a) => a.skill === 'continuity');
    expect(acq.usageCount).toBe(N);
  });

  // INVARIANT 14 — concurrent recordSkillUse for DIFFERENT skills don't
  // interfere — both land cleanly
  it('concurrent recordSkillUse for distinct skills both land', async () => {
    const neumaId = 'concurr2';
    await workspace.create(neumaId);
    await Promise.all([
      workspace.recordSkillUse(neumaId, 'continuity', '2026-06-27T10:00:00.000Z'),
      workspace.recordSkillUse(neumaId, 'neuma', '2026-06-27T10:00:01.000Z'),
    ]);
    const tree = await workspace.readSkillTree(neumaId);
    expect(tree.acquisitions.map((a) => a.skill).sort()).toEqual(['continuity', 'neuma']);
  });

  // INVARIANT 15 — DEK-encrypted: skills/tree.json on disk is an envelope
  // (post #117 S2b workspace IO routes through per-neuma DEK). Plain JSON
  // would mean we regressed the encryption guarantee.
  it('tree.json is encrypted on disk (envelope shape, not plain acquisitions JSON)', async () => {
    const neumaId = 'encrypttest';
    await workspace.create(neumaId);
    await workspace.recordSkillUse(neumaId, 'continuity', '2026-06-27T10:00:00.000Z');
    const raw = await fs.readFile(path.join(house, neumaId, 'skills', 'tree.json'), 'utf8');
    const parsed = JSON.parse(raw);
    // Encrypted envelope: { _enc, iv, tag, ct } — never the cleartext shape
    expect(parsed).toHaveProperty('_enc');
    expect(parsed).toHaveProperty('iv');
    expect(parsed).toHaveProperty('tag');
    expect(parsed).toHaveProperty('ct');
    expect(parsed).not.toHaveProperty('acquisitions'); // cleartext would have this
  });

  // INVARIANT 16 — missing neumaId rejected at boundary
  it('rejects missing neumaId', async () => {
    await expect(workspace.recordSkillUse('', 'continuity')).rejects.toThrow(/neumaId/);
    await expect(workspace.recordSkillUse(null, 'continuity')).rejects.toThrow(/neumaId/);
  });

  // ai6 R2.1 — onWarn callback routes the pure-layer warnings to the
  // caller's structured logger. Production callers (backend/) should
  // inject log.warn; default is console.warn (matches fsdir.js's
  // onTornLine pattern). Test injects a capturing function to assert
  // the routing without involving console.
  it('recordSkillUse calls onWarn for pure-layer warnings (legacy v1 with data)', async () => {
    const neumaId = 'onwarntest';
    await workspace.create(neumaId);
    // Pre-seed a legacy v1 tree with unexpected non-empty skills array.
    // We write it via writeSkillTree (which doesn't validate shape).
    await workspace.writeSkillTree(neumaId, {
      version: '1.0.0',
      skills: [{ name: 'orphan-record' }, { name: 'another-orphan' }],
    });
    const warnings = [];
    const onWarn = (detail, meta) => warnings.push({ detail, meta });
    await workspace.recordSkillUse(
      neumaId, 'continuity', '2026-06-27T10:00:00.000Z',
      { onWarn },
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0].detail).toMatch(/discarding non-empty v1.*2 entries/);
    expect(warnings[0].meta.neumaId).toBe(neumaId);
    expect(warnings[0].meta.kind).toBe('discarded-v1-skills');
  });

  it('recordSkillUse does NOT call onWarn for clean trees (no warnings on happy path)', async () => {
    const neumaId = 'cleanpath';
    await workspace.create(neumaId);
    const warnings = [];
    const onWarn = (detail, meta) => warnings.push({ detail, meta });
    await workspace.recordSkillUse(
      neumaId, 'continuity', '2026-06-27T10:00:00.000Z',
      { onWarn },
    );
    expect(warnings).toEqual([]);
  });

  // ai6 R1.2 — writeSkillTree must also serialize on the same file lock as
  // recordSkillUse. This test is a NO-CORRUPTION REGRESSION NET, not a
  // proof of the shared-lock property: the GENUINE correctness proof for
  // R1.2 is structural — both methods call `this._withFileLock(treePath, …)`
  // on the same path, so they share the same per-file mutex by the lock's
  // construction (established by #121 / WORKSPACE-CONCURRENCY-001). The
  // test below would PASS even in the lost-update case (final state is
  // valid, just stale) — what it actually proves is that interleaved calls
  // don't TEAR the file into a corrupt envelope or orphan write.
  // (ai6 R2.2 — honest comment.)
  it('writeSkillTree + recordSkillUse share the per-file lock — no clobber under concurrency', async () => {
    const neumaId = 'sharelock';
    await workspace.create(neumaId);
    // Pre-seed with a known tree
    await workspace.recordSkillUse(neumaId, 'continuity', '2026-06-27T10:00:00.000Z');
    // Interleave: 30 recordSkillUse + 30 writeSkillTree-with-its-own-shape,
    // all in flight at once. The lock should serialize ALL of them; we
    // assert the FINAL state is internally consistent (either coherent
    // tree from a writeSkillTree, or coherent counter from a recordSkillUse).
    const N = 30;
    const ops = [];
    for (let i = 0; i < N; i += 1) {
      ops.push(workspace.recordSkillUse(neumaId, 'continuity', `2026-06-27T11:00:${String(i).padStart(2, '0')}.000Z`));
      ops.push(workspace.writeSkillTree(neumaId, {
        version: TREE_VERSION_LATEST,
        acquisitions: [{
          skill: 'continuity',
          firstAcquiredAt: '2026-06-27T10:00:00.000Z',
          lastUsedAt: '2026-06-27T10:00:00.000Z',
          usageCount: 1,
        }],
      }));
    }
    await Promise.all(ops);
    // The final state is whichever of these N*2 operations ran LAST.
    // Both shapes are well-formed; what matters is the file is readable +
    // structurally valid (no torn write, no orphan envelope).
    const final = await workspace.readSkillTree(neumaId);
    expect(final.acquisitions).toBeDefined();
    expect(Array.isArray(final.acquisitions)).toBe(true);
    expect(final.acquisitions.length).toBeGreaterThanOrEqual(1);
    const cont = final.acquisitions.find((a) => a.skill === 'continuity');
    expect(cont).toBeDefined();
    expect(cont.usageCount).toBeGreaterThanOrEqual(1);
    expect(cont.firstAcquiredAt).toBe('2026-06-27T10:00:00.000Z');
  });
});
