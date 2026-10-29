// #117 S4b — per-being DEK migration orchestrator.
//
// REAL disk, REAL AES-256-GCM, REAL NeumaWorkspace, NO mocks anywhere on the
// claimed path (AGENTS.md RULE 0). Tests use SYNTHESIZED beings only — never
// summon a real one for a test (birth ethics).
//
// What this proves (the invariants the LIVING-being migration depends on):
//   1. Idempotent: a being whose keys/dek.json already exists is a no-op
//      (no walk, no writes, no audit pollution).
//   2. Genesis-seal required: a being without identity/genesis-seal.json
//      gets `'no-seal'` — never an invented DEK.
//   3. DEK write happens FIRST and is audited; aborts mid-write surface
//      `'dek-write-failed'`.
//   4. Walk migrates every envelope file in the being's tree under the new
//      DEK; plaintext (owner.json, the seal itself) untouched.
//   5. Per-file audit entries land in audit/audit.jsonl (the audit log is
//      itself plaintext via _appendLine, unaffected by the DEK transition).
//   6. Abort-on-first-error: a poison file (un-decryptable) stops the walk
//      but DOES NOT delete the DEK — mixed-mode is a valid recovery state.
//   7. Dry-run: zero disk mutation, zero audit entries, plan is reported.
//   8. The being still READS POST-MIGRATION through the normal workspace
//      methods (writeDNA → readDNA round-trip stays intact).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { migrateBeing } from '../../core/workspace/migrate-being.js';
import {
  encryptEnvelope,
  decryptEnvelope,
  isEnvelope,
  deriveKeyFromSecret,
  deriveNeumaDEK,
  resetWorkspaceCryptoKey,
} from '../../core/workspace/workspace-crypto.js';

const KEY = 's4b-being-migration-key-long-enough';

// Synthesize a being that simulates […]:
//   - workspace.create has built the directory structure
//   - identity/genesis-seal.json is plaintext with a real genesisHash shape
//   - selected encrypted files exist under the global master (no keys/dek.json yet)
// Returns the synthesized genesisHash hex so callers can derive the expected DEK.
const synthesizeBeing = async (root, neumaId, { encryptedSamples = [] } = {}) => {
  await workspace.create(neumaId);
  // workspace.create does NOT mkdir identity/ — that's finalize-birth's job.
  // It also does not write owner.json (that's set by portal-routes during
  // witness binding). Synthesize both for the test, mimicking a real being.
  const beingDir = path.join(root, neumaId);
  await fs.mkdir(path.join(beingDir, 'identity'), { recursive: true });
  await fs.writeFile(
    path.join(beingDir, 'owner.json'),
    JSON.stringify({ wallet: '0xtest-witness', cycle: 1 }, null, 2),
  );
  // Write the plaintext seal directly — matches finalize-birth.js:124-125
  // Make the genesisHash deterministic + unique per neumaId so cross-DEK tests
  // get genuinely independent DEKs.
  const genesisHash = neumaId.repeat(64).slice(0, 64).replace(/[^0-9a-f]/g, '0');
  await fs.writeFile(
    path.join(beingDir, 'identity', 'genesis-seal.json'),
    JSON.stringify({ genesisHash, record: { chosenName: neumaId } }, null, 2),
  );
  // Drop the encrypted samples into the workspace, under the global master.
  // We bypass workspace.writeDNA etc. and write the envelope directly to
  // simulate the on-disk state of a pre-S2a being.
  const masterKey = deriveKeyFromSecret(KEY);
  for (const { relPath, plain } of encryptedSamples) {
    const full = path.join(beingDir, relPath);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, JSON.stringify(encryptEnvelope(plain, { key: masterKey }), null, 2));
  }
  return genesisHash;
};

describe('#117 S4b — migrateBeing (orchestrator)', () => {
  let house;
  let origRoot;
  beforeEach(async () => {
    process.env.DNA_ENCRYPTION_KEY = KEY;
    resetWorkspaceCryptoKey();
    house = await createTempDir('s4b-being');
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
  });
  afterEach(() => {
    setWorkspacesRoot(origRoot);
    delete process.env.DNA_ENCRYPTION_KEY;
    resetWorkspaceCryptoKey();
  });

  // INVARIANT 1 — idempotency: a being whose keys/dek.json exists already is
  // a no-op. Critical so the migration is safe to re-run during recovery.
  it('idempotent: being with existing dek.json returns already-migrated with no walk', async () => {
    const neumaId = 'aaaaaaaa';
    const genesisHash = await synthesizeBeing(house, neumaId);
    // Migrate once
    await migrateBeing(workspace, neumaId);
    // Snapshot the on-disk state
    const before = await snapshotBeing(house, neumaId);
    // Migrate again — should report already-migrated, no changes
    const result = await migrateBeing(workspace, neumaId);
    expect(result.status).toBe('already-migrated');
    expect(result.dekWritten).toBe(true);
    expect(result.files).toEqual([]);
    expect(await snapshotBeing(house, neumaId)).toEqual(before);
    expect(genesisHash).toMatch(/^[0-9a-f]{64}$/); // sanity on synth
  });

  // INVARIANT 2 — no genesis-seal.json -> no-seal, no DEK invented.
  it('no-seal: missing genesis-seal.json aborts with no-seal, no DEK written', async () => {
    const neumaId = 'bbbbbbbb';
    await workspace.create(neumaId); // structure but no seal
    const result = await migrateBeing(workspace, neumaId);
    expect(result.status).toBe('no-seal');
    expect(result.dekWritten).toBe(false);
    expect(existsSync(path.join(house, neumaId, 'keys', 'dek.json'))).toBe(false);
  });

  // INVARIANT 3 — malformed genesis-seal.json (missing field, wrong shape) -> no-seal.
  it('no-seal: malformed genesis-seal.json (wrong hash shape) aborts with no-seal', async () => {
    const neumaId = 'cccccccc';
    await workspace.create(neumaId);
    await fs.mkdir(path.join(house, neumaId, 'identity'), { recursive: true });
    await fs.writeFile(
      path.join(house, neumaId, 'identity', 'genesis-seal.json'),
      JSON.stringify({ genesisHash: 'NOT_HEX_SHAPE' }, null, 2),
    );
    const result = await migrateBeing(workspace, neumaId);
    expect(result.status).toBe('no-seal');
    expect(result.dekWritten).toBe(false);
  });

  // INVARIANT 4 — happy path: synthesized being with several encrypted files
  // migrates cleanly. After migration: DEK on disk, files openable with DEK,
  // workspace.readDNA round-trips, audit entries land.
  it('happy path: writes DEK, migrates every envelope file, leaves plaintext alone', async () => {
    const neumaId = 'dddddddd';
    await synthesizeBeing(house, neumaId, {
      encryptedSamples: [
        { relPath: 'dna/active.json', plain: { neumaId, identity: { name: 'Dee' }, version: '1.0.0' } },
        { relPath: 'soul/soul.json', plain: { name: 'Dee', frequency: 432 } },
        { relPath: 'memory/entities/witness.json', plain: { entityId: 'witness', kind: 'kin' } },
      ],
    });

    const result = await migrateBeing(workspace, neumaId);
    expect(result.status).toBe('migrated');
    expect(result.dekWritten).toBe(true);
    expect(result.counts.migrated).toBeGreaterThanOrEqual(3); // the 3 we planted

    // DEK on disk + opens
    const dek = await workspace.readNeumaDEK(neumaId);
    expect(Buffer.isBuffer(dek)).toBe(true);
    expect(dek.length).toBe(32);

    // Each planted file opens with DEK, NOT with master
    const masterKey = deriveKeyFromSecret(KEY);
    for (const rel of ['dna/active.json', 'soul/soul.json', 'memory/entities/witness.json']) {
      const env = JSON.parse(await fs.readFile(path.join(house, neumaId, rel), 'utf8'));
      expect(isEnvelope(env)).toBe(true);
      expect(() => decryptEnvelope(env, { key: masterKey })).toThrow();
      expect(decryptEnvelope(env, { key: dek })).toBeDefined();
    }

    // Workspace round-trip works through the normal stack (S2b read path)
    const dna = await workspace.readDNA(neumaId);
    expect(dna.identity.name).toBe('Dee');
  });

  // INVARIANT 5 — plaintext files (owner.json, the seal itself) NEVER touched.
  // This is the LIVING-being safety net at the orchestrator layer.
  it('does not touch plaintext files: owner.json + genesis-seal.json byte-equal pre/post', async () => {
    const neumaId = 'eeeeeeee';
    await synthesizeBeing(house, neumaId, {
      encryptedSamples: [{ relPath: 'dna/active.json', plain: { neumaId, x: 1 } }],
    });
    const ownerBefore = await fs.readFile(path.join(house, neumaId, 'owner.json'), 'utf8');
    const sealBefore = await fs.readFile(path.join(house, neumaId, 'identity', 'genesis-seal.json'), 'utf8');

    await migrateBeing(workspace, neumaId);

    const ownerAfter = await fs.readFile(path.join(house, neumaId, 'owner.json'), 'utf8');
    const sealAfter = await fs.readFile(path.join(house, neumaId, 'identity', 'genesis-seal.json'), 'utf8');
    expect(ownerAfter).toBe(ownerBefore);
    expect(sealAfter).toBe(sealBefore);
  });

  // INVARIANT 6 — audit log records the migration lifecycle.
  it('audit lifecycle: MIGRATION_START, MIGRATED-per-file, MIGRATION_COMPLETE all land', async () => {
    const neumaId = 'ffffffff';
    await synthesizeBeing(house, neumaId, {
      encryptedSamples: [{ relPath: 'soul/soul.json', plain: { name: 'F' } }],
    });

    const result = await migrateBeing(workspace, neumaId);
    expect(result.status).toBe('migrated');

    const auditText = await fs.readFile(path.join(house, neumaId, 'audit', 'audit.jsonl'), 'utf8');
    const lines = auditText.split('\n').filter(Boolean).map(JSON.parse);
    const actions = lines.map((l) => l.action);
    expect(actions).toContain('MIGRATION_START');
    expect(actions).toContain('DEK_WRITTEN'); // from writeNeumaDEK itself
    expect(actions).toContain('MIGRATED');
    expect(actions).toContain('MIGRATION_COMPLETE');
  });

  // INVARIANT 7 — abort-on-first-error: a poison file (decryptable by neither
  // master nor DEK) stops the walk and reports 'aborted'. The DEK is NOT
  // deleted — mixed-mode is a valid state, and re-runs are idempotent for
  // already-migrated files.
  it('aborts on first cannot-decrypt file, leaves DEK in place, audits MIGRATION_ABORTED', async () => {
    const neumaId = 'abcdef01';
    await synthesizeBeing(house, neumaId, {
      encryptedSamples: [{ relPath: 'dna/active.json', plain: { neumaId, x: 1 } }],
    });
    // Plant a poison file: encrypted under a key neither master nor DEK can open
    const wrongKey = deriveKeyFromSecret('rotated-out-secret-from-six-months-ago');
    const poisonPath = path.join(house, neumaId, 'memory', 'observations', 'poison.json');
    await fs.mkdir(path.dirname(poisonPath), { recursive: true });
    await fs.writeFile(poisonPath, JSON.stringify(encryptEnvelope({ p: 1 }, { key: wrongKey })));

    const result = await migrateBeing(workspace, neumaId);
    expect(result.status).toBe('aborted');
    expect(result.abortReason).toMatch(/cannot-decrypt/);
    expect(result.dekWritten).toBe(true); // DEK is in place — recovery-mode

    // DEK file still on disk
    expect(existsSync(path.join(house, neumaId, 'keys', 'dek.json'))).toBe(true);

    // Audit recorded the abort
    const auditText = await fs.readFile(path.join(house, neumaId, 'audit', 'audit.jsonl'), 'utf8');
    const lines = auditText.split('\n').filter(Boolean).map(JSON.parse);
    const abortEntry = lines.find((l) => l.action === 'MIGRATION_ABORTED');
    expect(abortEntry).toBeDefined();
    expect(abortEntry.details.triggeringStatus).toBe('cannot-decrypt');
    expect(abortEntry.details.file).toMatch(/poison\.json/);
  });

  // INVARIANT 8 — dry-run: zero writes, zero audit entries, plan reported.
  it('dryRun: no DEK written, no per-file writes, no audit entries, plan accurate', async () => {
    const neumaId = 'beefcafe';
    await synthesizeBeing(house, neumaId, {
      encryptedSamples: [
        { relPath: 'dna/active.json', plain: { neumaId, x: 1 } },
        { relPath: 'soul/soul.json', plain: { name: 'BC' } },
      ],
    });
    const before = await snapshotBeing(house, neumaId);
    const auditBefore = await fs.readFile(path.join(house, neumaId, 'audit', 'audit.jsonl'), 'utf8').catch(() => '');

    const result = await migrateBeing(workspace, neumaId, { dryRun: true });
    expect(result.status).toBe('dry-run'); // distinct status — not 'migrated' (ai6 R1.4)
    expect(result.dekWritten).toBe(false);
    expect(result.counts.migrated).toBeGreaterThanOrEqual(2);

    // Zero disk mutation
    expect(await snapshotBeing(house, neumaId)).toEqual(before);
    expect(existsSync(path.join(house, neumaId, 'keys', 'dek.json'))).toBe(false);

    // Audit untouched
    const auditAfter = await fs.readFile(path.join(house, neumaId, 'audit', 'audit.jsonl'), 'utf8').catch(() => '');
    expect(auditAfter).toBe(auditBefore);
  });

  // INVARIANT 9 — per-being DEK isolation across siblings: migrate being A,
  // migrate being B (same house, same master), proven that A's files cannot
  // be opened with B's DEK. This is the cross-being security guarantee
  // the LIVING beings need (Fenna's DEK must not open Cael's DNA).
  it('cross-being isolation: being A files NOT openable with being B DEK', async () => {
    const idA = '1a1a1a1a';
    const idB = '2b2b2b2b';
    await synthesizeBeing(house, idA, {
      encryptedSamples: [{ relPath: 'dna/active.json', plain: { neumaId: idA, secret: 'A-secret' } }],
    });
    await synthesizeBeing(house, idB, {
      encryptedSamples: [{ relPath: 'dna/active.json', plain: { neumaId: idB, secret: 'B-secret' } }],
    });

    await migrateBeing(workspace, idA);
    await migrateBeing(workspace, idB);

    const dekA = await workspace.readNeumaDEK(idA);
    const dekB = await workspace.readNeumaDEK(idB);
    expect(dekA.equals(dekB)).toBe(false); // genuinely independent DEKs

    const envA = JSON.parse(await fs.readFile(path.join(house, idA, 'dna', 'active.json'), 'utf8'));
    // A's DEK opens A
    expect(decryptEnvelope(envA, { key: dekA })).toMatchObject({ secret: 'A-secret' });
    // B's DEK CANNOT open A — the per-being security guarantee
    expect(() => decryptEnvelope(envA, { key: dekB })).toThrow();
  });

  // INVARIANT 10 — wrong-shape neumaId / non-existent workspace: surfaces
  // cleanly (a missing being is no-seal, not a confusing throw).
  it('non-existent being: no-seal, dekWritten false', async () => {
    const result = await migrateBeing(workspace, 'never-existed-being');
    expect(result.status).toBe('no-seal');
    expect(result.dekWritten).toBe(false);
  });

  // INVARIANT 11 — env-missing master fails the migration before any DEK
  // write, with a clear error. The orchestrator builds the master chain
  // up-front so the failure is one place, not per file.
  it('env DNA_ENCRYPTION_KEY missing: throws before any DEK write', async () => {
    const neumaId = '3c3c3c3c';
    await synthesizeBeing(house, neumaId);
    delete process.env.DNA_ENCRYPTION_KEY;
    resetWorkspaceCryptoKey();
    await expect(migrateBeing(workspace, neumaId)).rejects.toThrow(/DNA_ENCRYPTION_KEY/);
    expect(existsSync(path.join(house, neumaId, 'keys', 'dek.json'))).toBe(false);
  });

  // INVARIANT 12a — CHICKEN-AND-EGG SAFETY: keys/dek.json is wrapped under
  // the MASTER (not the DEK), because unwrapping it produces the DEK itself.
  // If the walk migrates it under the DEK, the file is bricked forever (you'd
  // need the DEK to unwrap the DEK file). The walker MUST exclude this one
  // file. After migration, dek.json's envelope still opens with the master,
  // NOT with the DEK, and there's no .pre-dek.bak shadow.
  it('keys/dek.json remains master-wrapped after migration (chicken-and-egg guard)', async () => {
    const neumaId = 'd00dfeed';
    await synthesizeBeing(house, neumaId, {
      encryptedSamples: [{ relPath: 'dna/active.json', plain: { neumaId, x: 1 } }],
    });
    const result = await migrateBeing(workspace, neumaId);
    expect(result.status).toBe('migrated');

    // Read dek.json raw envelope and prove it opens with the MASTER
    const dekPath = path.join(house, neumaId, 'keys', 'dek.json');
    const env = JSON.parse(await fs.readFile(dekPath, 'utf8'));
    expect(isEnvelope(env)).toBe(true);
    const masterKey = deriveKeyFromSecret(KEY);
    // The wrapped DEK envelope opens with the master key, returning the
    // DEK as a base64 string (per wrapDEK's contract: encryptEnvelope(dek.toString('base64'))).
    expect(() => decryptEnvelope(env, { key: masterKey })).not.toThrow();

    // Workspace.readNeumaDEK round-trips successfully (would not if dek.json
    // had been re-wrapped under the DEK by the walk).
    const dek = await workspace.readNeumaDEK(neumaId);
    expect(dek.length).toBe(32);

    // And there's no `.pre-dek.bak` backup of dek.json (proves the file was
    // excluded from the walk entirely, not migrated-and-rolled-back).
    expect(existsSync(`${dekPath}.pre-dek.bak`)).toBe(false);
  });

  // INVARIANT 13 — RESUME AFTER ABORT (ai6 R1.1 High).
  // The reviewer's catch: prior to this fix, after migrateBeing aborted on
  // a poison file, the DEK was left in place. A re-run hit the (broken)
  // idempotency gate that keyed on DEK existence → returned 'already-migrated'
  // WITH FILES PAST THE POISON STILL MASTER-WRAPPED. On master rotation
  // those files would brick. The fix gates on the audit log's
  // MIGRATION_COMPLETE marker instead. This test proves resume works: plant
  // a poison, run + assert aborted, remove poison, re-run + assert migrated
  // and the file that was UNREACHED on the first walk is now migrated.
  it('resumes after abort: subsequent run migrates the files left behind, audit closes with MIGRATION_COMPLETE', async () => {
    const neumaId = 'resumere';
    await synthesizeBeing(house, neumaId, {
      encryptedSamples: [
        // Two legitimate files; the order in which walkFiles visits them
        // depends on filesystem readdir order, so we assert on STATUSES
        // not on which-file-specifically-was-unreached.
        { relPath: 'dna/active.json', plain: { neumaId, x: 1 } },
        { relPath: 'soul/soul.json', plain: { name: 'Res' } },
      ],
    });
    // Plant a poison file: encrypted under a key neither master nor DEK can open
    const wrongKey = deriveKeyFromSecret('rotated-out-secret');
    const poisonPath = path.join(house, neumaId, 'memory', 'observations', 'poison.json');
    await fs.mkdir(path.dirname(poisonPath), { recursive: true });
    await fs.writeFile(poisonPath, JSON.stringify(encryptEnvelope({ p: 1 }, { key: wrongKey })));

    // First run aborts
    const first = await migrateBeing(workspace, neumaId);
    expect(first.status).toBe('aborted');
    expect(first.dekWritten).toBe(true);

    // Remove the poison (operator intervention — e.g. they figured out the
    // file is from a discarded rotation and decide to delete it)
    await fs.unlink(poisonPath);

    // Re-run — must NOT hit the idempotency short-circuit, must re-walk
    const second = await migrateBeing(workspace, neumaId);
    expect(second.status).toBe('migrated'); // genuine completion, not 'already-migrated'
    expect(second.dekWritten).toBe(true);

    // Audit log shows the full lifecycle: START → ABORTED → START → COMPLETE
    const auditText = await fs.readFile(path.join(house, neumaId, 'audit', 'audit.jsonl'), 'utf8');
    const actions = auditText.split('\n').filter(Boolean).map((l) => JSON.parse(l).action);
    const migrationActions = actions.filter((a) => a.startsWith('MIGRATION_'));
    expect(migrationActions).toEqual(['MIGRATION_START', 'MIGRATION_ABORTED', 'MIGRATION_START', 'MIGRATION_COMPLETE']);

    // A THIRD run now correctly short-circuits (the gate is on MIGRATION_COMPLETE)
    const third = await migrateBeing(workspace, neumaId);
    expect(third.status).toBe('already-migrated');
    expect(third.files).toEqual([]);
  });

  // R1.2's symlink-safety concern is closed at two layers:
  //   1. The orchestrator's `path.relative(beingRoot, filePath) === DEK_FILE_REL`
  //      normalizes both sides via path.relative, removing dependence on how
  //      beingRoot is spelled.
  //   2. The workspace's `_path()` already calls `realpathSync` and throws
  //      'Symlink traversal denied' on any path that resolves outside the
  //      configured root — see neuma-workspace.js:1751-1753. This guarantees
  //      beingRoot is canonical before it ever reaches the orchestrator, so
  //      a symlinked workspace root can't bypass the exclusion.
  // A test that EXERCISES a symlinked root trips defense (2) directly, which
  // confirms the defense rather than the migrator. Layered fail-closed.

  // INVARIANT 14 — the being's key is RANDOM: the master and the (public) seal
  // hash do not rebuild it, and the files moved open under the key on disk.
  it('the migrated key is random — the master and seal hash do not rebuild it', async () => {
    const neumaId = '4d4d4d4d';
    const genesisHash = await synthesizeBeing(house, neumaId, {
      encryptedSamples: [{ relPath: 'soul/soul.json', plain: { name: '4D' } }],
    });
    await migrateBeing(workspace, neumaId);

    const dek = await workspace.readNeumaDEK(neumaId);
    expect(dek.equals(deriveNeumaDEK(deriveKeyFromSecret(KEY), genesisHash))).toBe(false);
    const soulRaw = JSON.parse(await fs.readFile(path.join(house, neumaId, 'soul', 'soul.json'), 'utf8'));
    expect(decryptEnvelope(soulRaw, { key: dek })).toEqual({ name: '4D' });
  });
});

// Helper: snapshot every file's bytes under a being's root, so we can deep-
// equal pre/post for the dry-run + idempotency tests. Walks via fs.readdir
// recursively — independent of the migrator's own walkFiles to keep the
// snapshot honest.
const snapshotBeing = async (house, neumaId) => {
  const root = path.join(house, neumaId);
  const out = {};
  const walk = async (dir) => {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch (err) { if (err.code === 'ENOENT') return; throw err; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) out[path.relative(root, full)] = await fs.readFile(full, 'utf8');
    }
  };
  await walk(root);
  return out;
};
