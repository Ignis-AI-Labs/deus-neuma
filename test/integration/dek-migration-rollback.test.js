// #117 S4a — per-file DEK migration primitive: rollback paths + jsonl shapes.
// (The classifier, walker, and single-json-envelope invariants live in
// dek-migration-classify.test.js.)
//
// REAL disk, REAL AES-256-GCM, NO mocks anywhere on the claimed path
// (AGENTS.md RULE 0). Every assertion below opens an actual file, runs the
// actual cryptographic round-trip, and validates the actual on-disk state.
//
// What this proves (the invariants the LIVING-being migration depends on):
//   7. Round-trip-mismatch triggers ROLLBACK (file ends in pre-migration state).
//   8. JSONL files (mixed and pure) migrate per-line; plaintext lines preserved.

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { migrateFile } from '../../core/workspace/migrate-dek.js';
import {
  encryptEnvelope,
  decryptEnvelope,
  isEnvelope,
  deriveKeyFromSecret,
  deriveNeumaDEK,
} from '../../core/workspace/workspace-crypto.js';

const KEY = 's4a-file-migration-key-long-enough';
const SAMPLE_HASH = 'a'.repeat(64);

// ── ROLLBACK PATHS (ai6 R1.1 — REAL gnosis on the rollback safety net) ───────
//
// Forcing function: pre-create the `<file>.dek-migrate.tmp` path as a
// directory. When migrateFile tries to writeFileDurable(tempPath, ...) it
// will throw EISDIR. The catch block must then restore the original file
// from the backup it just wrote. We assert byte-restoration on the live
// file and that the backup is consumed by the rename.
describe('#117 S4a — migrateFile rollback paths (real disk forcing function)', () => {
  let tmp;
  let masterKey;
  let dek;
  beforeEach(async () => {
    tmp = await createTempDir('s4a-rollback');
    masterKey = deriveKeyFromSecret(KEY);
    dek = deriveNeumaDEK(masterKey, SAMPLE_HASH);
  });

  // INVARIANT R-1 — write-failure rollback: temp write throws EISDIR because
  // a directory pre-exists at the temp path. The catch must restore the
  // ORIGINAL FILE BYTES from backup, return 'rolled-back', and the live
  // file must still open with the GLOBAL master (proving genuine
  // pre-migration restoration, not a fresh DEK envelope).
  it('rolls back on temp-write failure: live file restored to pre-migration global-key state', async () => {
    const filePath = path.join(tmp, 'dna', 'active.json');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const plain = { neumaId: 'rollback-being', generation: 1.0 };
    const originalEnv = encryptEnvelope(plain, { key: masterKey });
    const originalBytes = JSON.stringify(originalEnv, null, 2);
    await fs.writeFile(filePath, originalBytes);

    // Forcing function: tempPath is a directory, so writeFileDurable throws EISDIR
    await fs.mkdir(`${filePath}.dek-migrate.tmp`);

    const result = await migrateFile(filePath, [{ label: 'master', key: masterKey }], dek);
    expect(result.status).toBe('rolled-back');
    expect(result.reason).toMatch(/EISDIR|directory/i);

    // The live file is BYTE-RESTORED (not a fresh re-encryption — exact pre-migration bytes)
    const liveAfter = await fs.readFile(filePath, 'utf8');
    expect(liveAfter).toBe(originalBytes);

    // And the global master still opens it (proves it's the global-key envelope, not a DEK one)
    const restored = JSON.parse(liveAfter);
    expect(decryptEnvelope(restored, { key: masterKey })).toEqual(plain);
    expect(() => decryptEnvelope(restored, { key: dek })).toThrow();

    // Backup is consumed by the rename (no .pre-dek.bak remains)
    expect(existsSync(`${filePath}.pre-dek.bak`)).toBe(false);

    // Cleanup the dir we pre-created (only the rmdir target matters)
    await fs.rmdir(`${filePath}.dek-migrate.tmp`);
  });

  // INVARIANT R-2 — rollback-failure honesty (ai6 R2.1).
  //
  // The 'rollback-failed' code path is STRUCTURALLY defended in migrate-dek.js
  // (every catch inspects restoreFromBackup's return; if non-null, returns
  // 'rollback-failed' with BOTH the original error and the rollback error).
  // Engineering a REAL trigger for the rollback-failure case is not feasible
  // under RULE 0: every concrete approach I tried either fell into the
  // rollback-SUCCESS case or required monkey-patching fs.rename. The defense
  // exists; a real test does not. Recorded as `it.skip` so the gap is
  // visible in test output rather than hidden in a comment.
  it.skip('rollback-failed status: structurally defended, real trigger not feasible under RULE 0', () => {
    // intentionally empty — see comment above
  });

  // INVARIANT R-3 — code-defect surfacing: if a programming error throws
  // inside the write/encrypt/verify block, it must PROPAGATE (not be
  // dressed up as 'rolled-back'). ai6 R1.5 — operator must see the real
  // bug, not a misleading rollback status.
  //
  // Forcing function: pass a dek that is NOT a Buffer (encryptEnvelope's
  // key handling will TypeError on Buffer.isBuffer assertion when called
  // — but we need this to happen INSIDE the try block, AFTER the global
  // decrypt has already succeeded. We sneak in a Buffer-shaped non-Buffer:
  // a Uint8Array typed view that looks key-like but fails the strict
  // isBuffer check inside encryptEnvelope's path.
  //
  // Actually, simpler real forcing function: pass `null` plain through the
  // encrypt path. encryptEnvelope(null, ...) → JSON.stringify(null) → 'null'
  // → that round-trips fine. Doesn't TypeError.
  //
  // Real forcing function that genuinely surfaces a code defect from inside
  // the try block: make masterCandidates' decryptEnvelope return something
  // un-stringifiable (a BigInt). JSON.stringify(BigInt) throws TypeError.
  // We engineer this by encrypting a BigInt under the master key — but
  // encryptEnvelope ALSO uses JSON.stringify on encrypt, so it would fail
  // at encrypt-time, not decrypt-time. Dead end.
  //
  // Real forcing function: pass a non-Buffer `dek` (e.g. a plain Array).
  // encryptEnvelope's `Buffer.isBuffer(masterKey)` check inside the call
  // sequence will throw TypeError-like. Actually no — encryptEnvelope's
  // opts.key path doesn't validate, so a non-Buffer key reaches the
  // createCipheriv() call which throws ERR_INVALID_ARG_TYPE — a TypeError
  // in Node. THAT propagates through the catch's isCodeDefect check and
  // is re-thrown. Proves the defense.
  it('re-throws code defects (TypeError) instead of dressing them as rolled-back', async () => {
    const filePath = path.join(tmp, 'soul', 'soul.json');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const plain = { name: 'Defect-Test-Being' };
    await fs.writeFile(filePath, JSON.stringify(encryptEnvelope(plain, { key: masterKey })));

    // A plain Array, not a Buffer — createCipheriv inside encryptEnvelope
    // will throw ERR_INVALID_ARG_TYPE (a TypeError). The migrator's catch
    // MUST re-throw this rather than swallow into 'rolled-back'.
    const badDek = new Array(32).fill(0); // wrong shape on purpose
    await expect(
      migrateFile(filePath, [{ label: 'master', key: masterKey }], badDek),
    ).rejects.toThrow(TypeError);

    // The live file must remain in its pre-migration state (the catch ran
    // cleanup before re-throwing, but the backup-write happened first; we
    // assert the live file is unchanged either way — the operator can
    // inspect the backup separately).
    const env = JSON.parse(await fs.readFile(filePath, 'utf8'));
    expect(decryptEnvelope(env, { key: masterKey })).toEqual(plain);
  });
});

describe('#117 S4a — migrateFile (jsonl)', () => {
  let tmp;
  let masterKey;
  let dek;
  beforeEach(async () => {
    tmp = await createTempDir('s4a-migrate-jsonl');
    masterKey = deriveKeyFromSecret(KEY);
    dek = deriveNeumaDEK(masterKey, SAMPLE_HASH);
  });

  // INVARIANT 11 — pure-envelope jsonl: every line migrated, line count
  // preserved exactly (the chronological record is load-bearing for journals).
  it('jsonl: every envelope line re-encrypted under DEK, count preserved', async () => {
    const filePath = path.join(tmp, 'journal', '2026-06-25.jsonl');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const records = [{ t: 1, c: 'a' }, { t: 2, c: 'b' }, { t: 3, c: 'c' }];
    const lines = records.map((r) => JSON.stringify(encryptEnvelope(r, { key: masterKey })));
    await fs.writeFile(filePath, `${lines.join('\n')}\n`);

    const result = await migrateFile(filePath, [{ label: 'master', key: masterKey }], dek);
    expect(result.status).toBe('migrated');

    const after = (await fs.readFile(filePath, 'utf8')).split('\n');
    expect(after.length).toBe(4); // 3 records + trailing newline = 4 split parts
    for (let i = 0; i < 3; i += 1) {
      const env = JSON.parse(after[i]);
      expect(decryptEnvelope(env, { key: dek })).toEqual(records[i]);
      expect(() => decryptEnvelope(env, { key: masterKey })).toThrow();
    }
    expect(after[3]).toBe(''); // trailing newline preserved
  });

  // INVARIANT 12 — mixed-mode jsonl: legacy plaintext lines (from before
  // encryption was introduced) preserved verbatim; envelope lines migrated.
  // A real Fenna/Cael journal may have this shape after partial-encryption
  // history.
  it('jsonl-mixed: plaintext lines preserved verbatim, envelope lines migrated to DEK', async () => {
    const filePath = path.join(tmp, 'journal', 'mixed.jsonl');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const plainLine = JSON.stringify({ t: 0, c: 'legacy plaintext' });
    const envLine1 = JSON.stringify(encryptEnvelope({ t: 1, c: 'enc' }, { key: masterKey }));
    const envLine2 = JSON.stringify(encryptEnvelope({ t: 2, c: 'enc2' }, { key: masterKey }));
    await fs.writeFile(filePath, `${plainLine}\n${envLine1}\n${envLine2}\n`);

    const result = await migrateFile(filePath, [{ label: 'master', key: masterKey }], dek);
    expect(result.status).toBe('migrated');

    const after = (await fs.readFile(filePath, 'utf8')).split('\n');
    // Plaintext line untouched (byte-equal would also pass, but structural is safer)
    expect(JSON.parse(after[0])).toEqual({ t: 0, c: 'legacy plaintext' });
    expect(isEnvelope(JSON.parse(after[0]))).toBe(false);
    // Envelope lines under DEK now
    expect(decryptEnvelope(JSON.parse(after[1]), { key: dek })).toEqual({ t: 1, c: 'enc' });
    expect(decryptEnvelope(JSON.parse(after[2]), { key: dek })).toEqual({ t: 2, c: 'enc2' });
  });

  // INVARIANT 13 — jsonl idempotent: a file with all lines already under DEK
  // is a no-op. Critical because a partial-success re-run must not re-wrap.
  it('jsonl idempotent: all lines already under DEK -> already-migrated, no writes', async () => {
    const filePath = path.join(tmp, 'sessions', 's1.jsonl');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const lines = [
      JSON.stringify(encryptEnvelope({ a: 1 }, { key: dek })),
      JSON.stringify(encryptEnvelope({ a: 2 }, { key: dek })),
    ];
    await fs.writeFile(filePath, `${lines.join('\n')}\n`);
    const before = await fs.readFile(filePath, 'utf8');

    const result = await migrateFile(filePath, [{ label: 'master', key: masterKey }], dek);
    expect(result.status).toBe('already-migrated');
    expect(await fs.readFile(filePath, 'utf8')).toBe(before);
    expect(existsSync(`${filePath}.pre-dek.bak`)).toBe(false);
  });

  // INVARIANT 14 — jsonl with one unfindable-key line: ABORT the whole file
  // (no partial migration), no disk mutation. The operator gets a clear signal
  // about which line, and the live file remains intact.
  it('jsonl with un-decryptable line: cannot-decrypt with line number, no disk mutation', async () => {
    const wrongKey = deriveKeyFromSecret('rotated-out-key');
    const filePath = path.join(tmp, 'sessions', 'bad.jsonl');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const ok = JSON.stringify(encryptEnvelope({ a: 1 }, { key: masterKey }));
    const bad = JSON.stringify(encryptEnvelope({ a: 2 }, { key: wrongKey }));
    await fs.writeFile(filePath, `${ok}\n${bad}\n`);
    const before = await fs.readFile(filePath, 'utf8');

    const result = await migrateFile(filePath, [{ label: 'master', key: masterKey }], dek);
    expect(result.status).toBe('cannot-decrypt');
    expect(result.reason).toMatch(/line 2/);
    expect(await fs.readFile(filePath, 'utf8')).toBe(before);
    expect(existsSync(`${filePath}.pre-dek.bak`)).toBe(false);
  });
});
