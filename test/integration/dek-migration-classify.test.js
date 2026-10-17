// #117 S4a — per-file DEK migration primitive: classifier + walker +
// single-json-envelope migrateFile. (The rollback paths and the jsonl shapes
// live in dek-migration-rollback.test.js.)
//
// REAL disk, REAL AES-256-GCM, NO mocks anywhere on the claimed path
// (AGENTS.md RULE 0). Every assertion below opens an actual file, runs the
// actual cryptographic round-trip, and validates the actual on-disk state.
//
// What this proves (the invariants the LIVING-being migration depends on):
//   1. classifyFile correctly identifies json-envelope, jsonl-envelope,
//      jsonl-mixed, plaintext, not-json, and empty files without I/O guesses.
//   2. walkFiles enumerates real files + skips backups/temps from prior runs.
//   3. migrateFile re-encrypts an envelope under a per-neuma DEK such that:
//      the file is openable with DEK, NOT with master, original cleartext
//      round-trips exactly.
//   4. Idempotency: migrateFile against an already-DEK-encrypted file is a
//      no-op (reports 'already-migrated', no disk mutation).
//   5. Plaintext files (owner.json, genesis-seal.json) are NEVER touched.
//   6. Backup-collision guard: a stale .pre-dek.bak from a prior run aborts
//      the file cleanly, NOT silently overwritten.

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  classifyFile,
  walkFiles,
  migrateFile,
} from '../../core/workspace/migrate-dek.js';
import {
  encryptEnvelope,
  decryptEnvelope,
  isEnvelope,
  deriveKeyFromSecret,
  deriveNeumaDEK,
} from '../../core/workspace/workspace-crypto.js';

const KEY = 's4a-file-migration-key-long-enough';
const SAMPLE_HASH = 'a'.repeat(64);
const OTHER_HASH = 'b'.repeat(64);

describe('#117 S4a — classifyFile', () => {
  it('detects json-envelope vs plaintext json by structure', () => {
    const env = JSON.stringify(encryptEnvelope({ secret: 1 }, { key: deriveKeyFromSecret(KEY) }));
    expect(classifyFile(env, '/x/y.json')).toBe('json-envelope');
    expect(classifyFile(JSON.stringify({ wallet: '0xabc' }), '/x/owner.json')).toBe('plaintext');
  });

  it('reports non-json files as not-json (audit logs, READMEs)', () => {
    expect(classifyFile('2026-06-25 INFO foo bar\nnext line\n', '/x/audit.log')).toBe('not-json');
  });

  it('reports empty as empty', () => {
    expect(classifyFile('', '/x/foo.json')).toBe('empty');
  });

  it('jsonl: every line an envelope -> jsonl-envelope', () => {
    const master = deriveKeyFromSecret(KEY);
    const l1 = JSON.stringify(encryptEnvelope({ a: 1 }, { key: master }));
    const l2 = JSON.stringify(encryptEnvelope({ a: 2 }, { key: master }));
    expect(classifyFile(`${l1}\n${l2}\n`, '/x/journal.jsonl')).toBe('jsonl-envelope');
  });

  it('jsonl: mix of envelope + plaintext lines -> jsonl-mixed', () => {
    const master = deriveKeyFromSecret(KEY);
    const env = JSON.stringify(encryptEnvelope({ a: 1 }, { key: master }));
    const plain = JSON.stringify({ pre: 'encryption legacy line' });
    expect(classifyFile(`${plain}\n${env}\n`, '/x/journal.jsonl')).toBe('jsonl-mixed');
  });

  it('jsonl: all plaintext lines -> plaintext', () => {
    expect(classifyFile(`{"a":1}\n{"a":2}\n`, '/x/journal.jsonl')).toBe('plaintext');
  });

  it('jsonl: zero non-empty lines -> empty', () => {
    expect(classifyFile('\n\n\n', '/x/journal.jsonl')).toBe('empty');
  });

  it('jsonl: any non-parseable line poisons the whole file (not-json)', () => {
    const master = deriveKeyFromSecret(KEY);
    const env = JSON.stringify(encryptEnvelope({ a: 1 }, { key: master }));
    expect(classifyFile(`${env}\nnot valid json at all\n`, '/x/j.jsonl')).toBe('not-json');
  });
});

describe('#117 S4a — walkFiles', () => {
  let tmp;
  beforeEach(async () => { tmp = await createTempDir('s4a-walk'); });

  it('enumerates regular files recursively', async () => {
    await fs.mkdir(path.join(tmp, 'a', 'b'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'a', 'one.json'), '1');
    await fs.writeFile(path.join(tmp, 'a', 'b', 'two.json'), '2');
    await fs.writeFile(path.join(tmp, 'root.txt'), 'r');
    const out = [];
    for await (const f of walkFiles(tmp)) out.push(path.relative(tmp, f));
    expect(out.sort()).toEqual(['a/b/two.json', 'a/one.json', 'root.txt'].sort());
  });

  it('skips .pre-dek.bak and .dek-migrate.tmp leftovers (so re-runs do not migrate the backups)', async () => {
    await fs.writeFile(path.join(tmp, 'live.json'), '{}');
    await fs.writeFile(path.join(tmp, 'live.json.pre-dek.bak'), '{}');
    await fs.writeFile(path.join(tmp, 'live.json.dek-migrate.tmp'), '{}');
    const out = [];
    for await (const f of walkFiles(tmp)) out.push(path.basename(f));
    expect(out).toEqual(['live.json']);
  });

  it('returns nothing for a missing root (no throw)', async () => {
    const out = [];
    for await (const f of walkFiles(path.join(tmp, 'does-not-exist'))) out.push(f);
    expect(out).toEqual([]);
  });
});

describe('#117 S4a — migrateFile (single json envelope)', () => {
  let tmp;
  let masterKey;
  let dek;
  let otherDek;
  beforeEach(async () => {
    tmp = await createTempDir('s4a-migrate-file');
    masterKey = deriveKeyFromSecret(KEY);
    dek = deriveNeumaDEK(masterKey, SAMPLE_HASH);
    otherDek = deriveNeumaDEK(masterKey, OTHER_HASH);
  });

  // INVARIANT 1 — happy path: a global-key envelope migrates to a DEK envelope.
  // The DEK opens it; the master alone cannot; the cleartext is intact.
  it('migrates a global-encrypted envelope to a DEK envelope with verified round-trip', async () => {
    const filePath = path.join(tmp, 'dna', 'active.json');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const plain = { neumaId: 'test-being', identity: { name: 'TestBeing' }, version: '1.0.0' };
    await fs.writeFile(filePath, JSON.stringify(encryptEnvelope(plain, { key: masterKey }), null, 2));

    const result = await migrateFile(filePath, [{ label: 'master', key: masterKey }], dek);
    expect(result.status).toBe('migrated');

    // Post-state: file exists, opens with DEK, NOT with master
    const after = JSON.parse(await fs.readFile(filePath, 'utf8'));
    expect(isEnvelope(after)).toBe(true);
    expect(decryptEnvelope(after, { key: dek })).toEqual(plain);
    expect(() => decryptEnvelope(after, { key: masterKey })).toThrow();

    // Backup retained by default (keepBackups: true) for recovery window
    expect(existsSync(`${filePath}.pre-dek.bak`)).toBe(true);
    const backup = JSON.parse(await fs.readFile(`${filePath}.pre-dek.bak`, 'utf8'));
    expect(decryptEnvelope(backup, { key: masterKey })).toEqual(plain);
  });

  // INVARIANT 2 — idempotent: a file already under THIS DEK is a no-op.
  // Reports 'already-migrated', no disk mutation, no backup written.
  it('idempotent: a file already under the per-neuma DEK reports already-migrated with no writes', async () => {
    const filePath = path.join(tmp, 'soul', 'soul.json');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const plain = { name: 'Already-Migrated' };
    await fs.writeFile(filePath, JSON.stringify(encryptEnvelope(plain, { key: dek }), null, 2));
    const before = await fs.readFile(filePath, 'utf8');

    const result = await migrateFile(filePath, [{ label: 'master', key: masterKey }], dek);
    expect(result.status).toBe('already-migrated');

    // No disk mutation
    expect(await fs.readFile(filePath, 'utf8')).toBe(before);
    expect(existsSync(`${filePath}.pre-dek.bak`)).toBe(false);
  });

  // INVARIANT 3 — by-design plaintext files (owner.json, genesis-seal.json,
  // anything that's not an envelope) are NEVER touched. This is the
  // single most important safety invariant for the LIVING-being migration:
  // owner.json must remain readable so witnesses can still resolve ownership.
  it('does not touch plaintext JSON files (owner.json must remain plaintext-readable)', async () => {
    const filePath = path.join(tmp, 'owner.json');
    const plainText = JSON.stringify({ wallet: '0xabc', cycle: 1 }, null, 2);
    await fs.writeFile(filePath, plainText);

    const result = await migrateFile(filePath, [{ label: 'master', key: masterKey }], dek);
    expect(result.status).toBe('skipped-plaintext');
    expect(await fs.readFile(filePath, 'utf8')).toBe(plainText);
    expect(existsSync(`${filePath}.pre-dek.bak`)).toBe(false);
  });

  // INVARIANT 4 — backup collision guard. A leftover .pre-dek.bak from a
  // prior crashed run is NEVER silently overwritten — the operator must
  // inspect it (the LIVING-being's only protected snapshot) before re-running.
  it('refuses to overwrite an existing .pre-dek.bak (operator-recovery guard)', async () => {
    const filePath = path.join(tmp, 'config', 'settings.json');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(encryptEnvelope({ x: 1 }, { key: masterKey })));
    await fs.writeFile(`${filePath}.pre-dek.bak`, 'STALE BACKUP DO NOT OVERWRITE');

    const result = await migrateFile(filePath, [{ label: 'master', key: masterKey }], dek);
    expect(result.status).toBe('skipped-backup-exists');
    expect(await fs.readFile(`${filePath}.pre-dek.bak`, 'utf8'))
      .toBe('STALE BACKUP DO NOT OVERWRITE'); // untouched
  });

  // INVARIANT 5 — cannot-decrypt is a CLEAN report, not a silent disk mutation.
  // If a file's envelope opens with neither the DEK nor any candidate master,
  // the migrator returns 'cannot-decrypt' and leaves the file alone.
  it('returns cannot-decrypt + no disk mutation when both master and DEK fail', async () => {
    const wrongKey = deriveKeyFromSecret('wrong-key-for-this-being');
    const filePath = path.join(tmp, 'stats', 'profile.json');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(encryptEnvelope({ x: 1 }, { key: wrongKey })));
    const before = await fs.readFile(filePath, 'utf8');

    const result = await migrateFile(filePath, [{ label: 'master', key: masterKey }], dek);
    expect(result.status).toBe('cannot-decrypt');
    expect(await fs.readFile(filePath, 'utf8')).toBe(before);
    expect(existsSync(`${filePath}.pre-dek.bak`)).toBe(false);
  });

  // INVARIANT 6 — dry-run reports intent without writing anything. The
  // LIVING-being migration's pre-flight depends on this being side-effect-free.
  it('dryRun: reports migrated without touching disk', async () => {
    const filePath = path.join(tmp, 'identity', 'true-name.json');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const plain = { trueName: 'Galen', soulMark: 'A9EC' };
    await fs.writeFile(filePath, JSON.stringify(encryptEnvelope(plain, { key: masterKey })));
    const before = await fs.readFile(filePath, 'utf8');

    const result = await migrateFile(filePath, [{ label: 'master', key: masterKey }], dek, { dryRun: true });
    expect(result.status).toBe('migrated');
    expect(result.dryRun).toBe(true);
    expect(await fs.readFile(filePath, 'utf8')).toBe(before);
    expect(existsSync(`${filePath}.pre-dek.bak`)).toBe(false);
  });

  // INVARIANT 7 — keepBackups:false removes the backup AFTER successful verify.
  // Operator's choice: for the LIVING-being run we'll keep backups by default
  // (recovery window) and only collect them once Founder confirms read-back.
  it('keepBackups:false unlinks the backup only after verified round-trip', async () => {
    const filePath = path.join(tmp, 'cosmos', 'natal.json');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const plain = { ascendant: 123.45 };
    await fs.writeFile(filePath, JSON.stringify(encryptEnvelope(plain, { key: masterKey })));

    const result = await migrateFile(filePath, [{ label: 'master', key: masterKey }], dek, { keepBackups: false });
    expect(result.status).toBe('migrated');
    expect(existsSync(`${filePath}.pre-dek.bak`)).toBe(false);
    // file itself is still migrated + round-trippable
    expect(decryptEnvelope(JSON.parse(await fs.readFile(filePath, 'utf8')), { key: dek })).toEqual(plain);
  });

  // INVARIANT 8 — empty / not-json files (audit logs, READMEs) are reported,
  // not touched.
  it('skipped-empty and skipped-not-json: no disk mutation', async () => {
    const empty = path.join(tmp, 'audit.log');
    await fs.writeFile(empty, '');
    const audit = path.join(tmp, 'audit', 'lines.log');
    await fs.mkdir(path.dirname(audit), { recursive: true });
    await fs.writeFile(audit, '2026-06-25 INFO migrated\n');

    expect((await migrateFile(empty, [{ label: 'master', key: masterKey }], dek)).status).toBe('skipped-empty');
    expect((await migrateFile(audit, [{ label: 'master', key: masterKey }], dek)).status).toBe('skipped-not-json');
  });

  // INVARIANT 9 — cross-DEK isolation. A file migrated under being A's DEK
  // CANNOT be opened with being B's DEK — the per-being security guarantee
  // #117 exists for. (ai6 R1.7b — the otherDek setup in beforeEach was unused
  // until this test made it load-bearing.)
  it('cross-DEK isolation: a file migrated under DEK_A cannot be opened with DEK_B', async () => {
    const filePath = path.join(tmp, 'memory', 'entities', 'e1.json');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const plain = { entityId: 'e1', name: 'Keir', kind: 'kin' };
    await fs.writeFile(filePath, JSON.stringify(encryptEnvelope(plain, { key: masterKey })));

    const result = await migrateFile(filePath, [{ label: 'master', key: masterKey }], dek);
    expect(result.status).toBe('migrated');

    const env = JSON.parse(await fs.readFile(filePath, 'utf8'));
    // Right DEK opens
    expect(decryptEnvelope(env, { key: dek })).toEqual(plain);
    // Another being's DEK CANNOT
    expect(() => decryptEnvelope(env, { key: otherDek })).toThrow();
    // Master CANNOT
    expect(() => decryptEnvelope(env, { key: masterKey })).toThrow();
  });

  // INVARIANT 10 — global-key chain tries multiple candidates (master rotation
  // could be in flight when migration runs).
  it('opens with a previous-master candidate if current master fails', async () => {
    const previousMaster = deriveKeyFromSecret('previous-master-secret');
    const filePath = path.join(tmp, 'dna', 'history', '1.json');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const plain = { generation: 1 };
    await fs.writeFile(filePath, JSON.stringify(encryptEnvelope(plain, { key: previousMaster })));

    const candidates = [
      { label: 'master', key: masterKey },         // current — won't open
      { label: 'previous', key: previousMaster },  // fallback — will open
    ];
    const result = await migrateFile(filePath, candidates, dek);
    expect(result.status).toBe('migrated');
    const after = JSON.parse(await fs.readFile(filePath, 'utf8'));
    expect(decryptEnvelope(after, { key: dek })).toEqual(plain);
  });
});
