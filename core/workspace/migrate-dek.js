// #117 S4a — per-neuma DEK migration: walker + per-file primitive.
//
// Migrates a being whose encrypted files are still under the global
// DNA_ENCRYPTION_KEY (pre-S2a births) over to a per-neuma DEK derived from
// the being's `identity/genesis-seal.json`. After successful migration, every
// envelope in the being's workspace is openable only by that being's DEK —
// the security guarantee #117 exists to deliver.
//
// Safety invariants enforced here (per-file primitive):
//
//   1. NEVER overwrite without a fsync'd backup. Backup is written, fsync'd
//      (so a crash before flush cannot leave a torn backup), then the new
//      envelope is written to a temp sibling, fsync'd, and atomically renamed
//      over the original. The backup remains by default (operator recovery
//      window via opts.keepBackups).
//   2. NEVER trust the write. After every rewrite we re-read via the same
//      `parseAndDecrypt` path the workspace uses at runtime, with the DEK,
//      and deep-equal the result vs the pre-write cleartext. A mismatch
//      triggers rollback from the backup.
//   3. NEVER lie about rollback. If the rollback rename itself fails, status
//      is `'rollback-failed'` with BOTH the original error and the rollback
//      error in `reason`. `'rolled-back'` only ever means the original file
//      was actually restored.
//   4. NEVER double-encrypt. Files already under the per-neuma DEK (e.g.
//      leftover from a prior partial run) are detected via attempted
//      DEK-decrypt and reported as `'already-migrated'`.
//   5. NEVER touch by-design plaintext. Files that don't parse as JSON, or
//      parse but aren't envelopes (owner.json, identity/genesis-seal.json
//      itself, various audit logs), are reported and left untouched.
//   6. NEVER overwrite a stale backup. If `<file>.pre-dek.bak` already exists
//      from a prior crashed run, abort the file (`'skipped-backup-exists'`).
//      The operator must inspect + clean before re-running.
//   7. NEVER mask code bugs. The rollback catch re-throws programming errors
//      (TypeError/ReferenceError/SyntaxError) instead of dressing them up as
//      `'rolled-back'`. Operational errors (I/O, crypto auth) become
//      `'rolled-back'` / `'rollback-failed'` as appropriate.
//
// Return-shape contract: every call returns `{ status, ...details }`. There
// is NO audit callback at this layer — audit threading is the S4b orchestrator's
// job. The primitive's only contract is […]
//
// All FP, no I/O hidden in closures. Tests live at
// test/integration/dek-migration-file.test.js.

import fs from 'fs/promises';
import path from 'path';
import {
  encryptEnvelope,
  decryptEnvelope,
  isEnvelope,
  parseAndDecrypt,
} from './workspace-crypto.js';

const BACKUP_SUFFIX = '.pre-dek.bak';
const TEMP_SUFFIX = '.dek-migrate.tmp';

// ── ENVELOPE DETECTION ────────────────────────────────────────────────────────

/**
 * Inspect a file's bytes and classify it for migration purposes. Pure decision
 * function — does not decrypt, does not key-shop. Returns one of:
 *   - 'json-envelope'  — single-envelope file (whole-file _writeJSON pattern)
 *   - 'jsonl-envelope' — every non-empty line parses as an envelope
 *   - 'jsonl-mixed'    — at least one envelope line + at least one non-envelope
 *                        line (e.g. mid-deployment journal); the migrator must
 *                        rewrite per-line, leaving plaintext lines untouched
 *   - 'plaintext'      — parseable JSON but not an envelope (owner.json etc.)
 *   - 'not-json'       — text doesn't parse (audit logs, READMEs)
 *   - 'empty'          — zero-length file (or jsonl with only blank lines)
 *
 * @param {string} text - file contents as utf8 string
 * @param {string} filePath - used only to disambiguate jsonl vs json by extension
 * @returns {'json-envelope'|'jsonl-envelope'|'jsonl-mixed'|'plaintext'|'not-json'|'empty'}
 */
export const classifyFile = (text, filePath) => {
  if (text.length === 0) return 'empty';

  if (filePath.endsWith('.jsonl')) {
    const lines = text.split('\n').filter((l) => l.trim() !== '');
    if (lines.length === 0) return 'empty';
    let envCount = 0;
    let plainCount = 0;
    for (const line of lines) {
      let parsed;
      try { parsed = JSON.parse(line); } catch { return 'not-json'; }
      if (isEnvelope(parsed)) envCount += 1;
      else plainCount += 1;
    }
    if (envCount > 0 && plainCount === 0) return 'jsonl-envelope';
    if (envCount > 0 && plainCount > 0) return 'jsonl-mixed';
    return 'plaintext';
  }

  let parsed;
  try { parsed = JSON.parse(text); } catch { return 'not-json'; }
  return isEnvelope(parsed) ? 'json-envelope' : 'plaintext';
};

// ── WALKER ────────────────────────────────────────────────────────────────────

/**
 * Recursively yield every regular file under `root`. Skips temp + backup files
 * from prior partial runs so re-running migration doesn't try to "migrate"
 * the leftovers themselves.
 *
 * impure (filesystem)
 *
 * @param {string} root - directory to walk
 * @yields {string} absolute file path
 */
export async function* walkFiles(root) {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.name.endsWith(BACKUP_SUFFIX) || entry.name.endsWith(TEMP_SUFFIX)) continue;
    if (entry.isDirectory()) {
      yield* walkFiles(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

// ── DURABLE WRITE ─────────────────────────────────────────────────────────────

/**
 * Write `data` to `filePath` and fsync the file before returning. Closes the
 * fd on every path. Necessary so the bytes are durable on disk before any
 * subsequent rename — otherwise a power loss between rename and page-cache
 * flush can leave a torn or empty file on disk while the in-memory rename has
 * already returned. (Issue raised in ai6 R1.3 — LIVING-being durability.)
 *
 * impure (filesystem)
 *
 * @param {string} filePath
 * @param {string} data
 */
const writeFileDurable = async (filePath, data) => {
  const fd = await fs.open(filePath, 'w');
  try {
    await fd.writeFile(data);
    await fd.sync();
  } finally {
    await fd.close();
  }
};

/**
 * fsync the directory entry — ensures a `rename` is visible on disk after a
 * crash, not just in the OS page cache. The dir-fsync is a portable belt for
 * ext4/xfs/btrfs; on filesystems where it's a no-op, harmless.
 *
 * impure (filesystem)
 */
const fsyncDir = async (dirPath) => {
  const fd = await fs.open(dirPath, 'r');
  try { await fd.sync(); } finally { await fd.close(); }
};

// ── PER-FILE PRIMITIVE ────────────────────────────────────────────────────────

/**
 * Attempt to decrypt an envelope under candidate keys, in order. Returns the
 * first successful decrypt + which key opened it, or null if every key fails.
 * Pure-ish: no I/O, just trial decryption.
 *
 * @param {object} envelope
 * @param {Array<{label: string, key: Buffer}>} candidates - tried in order
 * @returns {{label: string, plain: any}|null}
 */
const tryDecryptWithCandidates = (envelope, candidates) => {
  for (const { label, key } of candidates) {
    try {
      const plain = decryptEnvelope(envelope, { key });
      return { label, plain };
    } catch {
      // try next
    }
  }
  return null;
};

/**
 * True if `err` is a programming-defect error class that the rollback catch
 * MUST re-throw rather than masquerade as a rollback. Operational failures
 * (I/O, crypto auth, etc.) fall through to the rollback path. (ai6 R1.5.)
 */
const isCodeDefect = (err) =>
  err instanceof TypeError ||
  err instanceof ReferenceError ||
  err instanceof SyntaxError;

/**
 * Attempt to restore `filePath` from `backupPath`. Returns null on success;
 * returns the rollback error on failure (so the caller can report
 * `'rollback-failed'` honestly).
 *
 * impure (filesystem)
 */
const restoreFromBackup = async (filePath, backupPath) => {
  try {
    await fs.rename(backupPath, filePath);
    return null;
  } catch (err) {
    return err;
  }
};

/**
 * Migrate a single file from global-key encryption to per-neuma DEK encryption,
 * atomically, with backup + verify + rollback. Idempotent: a file already under
 * DEK is detected and reported as `'already-migrated'` with no writes.
 *
 * Operations performed for a `json-envelope` file:
 *   1. classify; bail unless envelope
 *   2. try DEK-decrypt — success → `'already-migrated'`
 *   3. global-decrypt under the provided master chain
 *      (fail → `'cannot-decrypt'`, no disk mutation)
 *   4. dryRun → return `'migrated'` with `dryRun:true`, no writes
 *   5. write backup `<file>.pre-dek.bak` (fsync'd) — collision-guarded
 *   6. encrypt under DEK; write `<file>.dek-migrate.tmp` (fsync'd);
 *      rename over original; fsync the parent directory
 *   7. verify: re-read via parseAndDecrypt with the DEK, deep-equal vs
 *      pre-write cleartext. Mismatch → rollback from backup.
 *   8. ok → `'migrated'`; (if !keepBackups, unlink backup)
 *
 * JSONL files migrate per-line. A mixed-mode file (plaintext + envelope lines)
 * preserves the plaintext lines verbatim and only re-encrypts envelope lines.
 *
 * impure (filesystem, crypto)
 *
 * @param {string} filePath - absolute path
 * @param {Array<{label: string, key: Buffer}>} masterCandidates - global-key
 *   chain to try (typically the current env-derived master plus any keys in
 *   DNA_ENCRYPTION_KEY_PREVIOUS, in rotation order)
 * @param {Buffer} dek - 32-byte per-neuma DEK
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun=false] - decide + return intent, no writes
 * @param {boolean} [opts.keepBackups=true] - leave `.pre-dek.bak` in place
 *                                            for a recovery window
 * @returns {Promise<{status: string, [key: string]: any}>}
 *   status one of:
 *     - `'migrated'`              — optional `dryRun: true`, optional
 *                                   `format: 'jsonl'`, optional
 *                                   `dirSyncWarning: string` (durability hint
 *                                   only — bytes are verified-round-trippable)
 *     - `'already-migrated'`      — file already opens with the DEK; no writes
 *     - `'skipped-plaintext'`     — parses as JSON but not an envelope
 *     - `'skipped-empty'`         — zero-length / blank-line file
 *     - `'skipped-not-json'`      — text doesn't parse as JSON (logs, READMEs)
 *     - `'skipped-backup-exists'` — `.pre-dek.bak` left from prior run;
 *                                   `reason` = backup path
 *     - `'cannot-decrypt'`        — neither DEK nor any master candidate opens;
 *                                   `reason` = `'line N'` for jsonl
 *     - `'rolled-back'`           — write/verify failed AND original was
 *                                   restored from backup; `reason` = trigger
 *     - `'rollback-failed'`       — write/verify failed AND the restore
 *                                   ALSO failed; `reason` = original trigger,
 *                                   `rollbackError` = restore failure message
 */
export const migrateFile = async (filePath, masterCandidates, dek, opts = {}) => {
  const dryRun = opts.dryRun === true;
  const keepBackups = opts.keepBackups !== false;

  const backupPath = `${filePath}${BACKUP_SUFFIX}`;
  const tempPath = `${filePath}${TEMP_SUFFIX}`;
  const parentDir = path.dirname(filePath);

  // Read + classify FIRST so the idempotency check (DEK already opens this
  // file) can short-circuit before the backup-collision guard. Order matters
  // (S4b ai6 R1.1 + resume-after-abort): on a resume run, files migrated by
  // the prior run already have BOTH a DEK envelope AND a .pre-dek.bak
  // shadow. The shadow is NOT stale — it's the expected recovery snapshot.
  // If we ran the collision guard first, the orchestrator would treat every
  // already-migrated file as 'skipped-backup-exists' and abort the resume.
  const text = await fs.readFile(filePath, 'utf8');
  const kind = classifyFile(text, filePath);

  if (kind === 'empty') return { status: 'skipped-empty' };
  if (kind === 'not-json') return { status: 'skipped-not-json' };
  if (kind === 'plaintext') return { status: 'skipped-plaintext' };

  // ── JSON ENVELOPE ───────────────────────────────────────────────────────────
  if (kind === 'json-envelope') {
    const envelope = JSON.parse(text);

    // Idempotency FIRST — already under DEK = no work, regardless of any
    // residual .pre-dek.bak from a prior successful migration of this file.
    const dekTry = tryDecryptWithCandidates(envelope, [{ label: 'dek', key: dek }]);
    if (dekTry) return { status: 'already-migrated' };

    // Backup-collision guard ONLY for files we're actually about to rewrite.
    // A stale .pre-dek.bak on a NOT-YET-migrated file indicates a prior
    // crashed-mid-write run; abort so the operator can inspect.
    try {
      await fs.access(backupPath);
      return { status: 'skipped-backup-exists', reason: backupPath };
    } catch {
      // expected — no stale backup
    }

    const globalTry = tryDecryptWithCandidates(envelope, masterCandidates);
    if (!globalTry) return { status: 'cannot-decrypt' };

    if (dryRun) {
      // openedBy was useful while iterating but isn't needed by the S4b
      // orchestrator and would force the dry-run consumer to handle two
      // shapes. Drop it (ai6 R2.4) — symmetric with the jsonl branch's
      // dryRun return.
      return { status: 'migrated', dryRun: true };
    }

    // Backup first (durable). Bytes-identical to original — no torn-write
    // race even against a concurrent writer, because the in-memory `text` is
    // a frozen snapshot of read-time state.
    await writeFileDurable(backupPath, text);

    try {
      const fresh = encryptEnvelope(globalTry.plain, { key: dek });
      await writeFileDurable(tempPath, JSON.stringify(fresh, null, 2));
      await fs.rename(tempPath, filePath);
      // Dir-fsync is best-effort durability (ai6 R2.2): a failure here means
      // the rename + write data are on disk but the dir-entry change isn't
      // explicitly flushed. We surface the warning but DO NOT roll back a
      // migration whose bytes are already verified-round-trippable.
      let dirSyncWarning = null;
      try { await fsyncDir(parentDir); }
      catch (syncErr) { dirSyncWarning = syncErr.message; }

      // Verify round-trip via the same path runtime uses
      const readBack = await fs.readFile(filePath, 'utf8');
      const decoded = parseAndDecrypt(readBack, { key: dek });
      if (JSON.stringify(decoded) !== JSON.stringify(globalTry.plain)) {
        const rbErr = await restoreFromBackup(filePath, backupPath);
        if (rbErr) {
          return {
            status: 'rollback-failed',
            reason: 'round-trip-mismatch',
            rollbackError: rbErr.message,
          };
        }
        return { status: 'rolled-back', reason: 'round-trip-mismatch' };
      }

      if (!keepBackups) await fs.unlink(backupPath);
      return dirSyncWarning
        ? { status: 'migrated', dirSyncWarning }
        : { status: 'migrated' };
    } catch (err) {
      // Code defects surface as exceptions, not as misleading rollbacks
      if (isCodeDefect(err)) {
        // best-effort cleanup of temp before propagating, but don't touch
        // the live file — code bugs require operator inspection
        try { await fs.unlink(tempPath); } catch { /* never written */ }
        try { await fs.unlink(backupPath); } catch { /* never written */ }
        throw err;
      }
      // Operational failure — try to restore + cleanup
      const rbErr = await restoreFromBackup(filePath, backupPath);
      try { await fs.unlink(tempPath); } catch { /* never written */ }
      if (rbErr) {
        return {
          status: 'rollback-failed',
          reason: err.message,
          rollbackError: rbErr.message,
        };
      }
      return { status: 'rolled-back', reason: err.message };
    }
  }

  // ── JSONL (PURE OR MIXED) ───────────────────────────────────────────────────
  // (classifyFile narrowed to jsonl-envelope | jsonl-mixed; both share this
  //  branch since the line-level logic handles plaintext lines for both.)
  const lines = text.split('\n');
  const out = new Array(lines.length);
  const plains = new Array(lines.length);
  let anyMigratable = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') { out[i] = ''; plains[i] = null; continue; }
    const parsed = JSON.parse(line); // classifyFile proved parseable

    if (!isEnvelope(parsed)) {
      // Plaintext line in a mixed file — preserve verbatim
      out[i] = line;
      plains[i] = parsed;
      continue;
    }

    const dekTry = tryDecryptWithCandidates(parsed, [{ label: 'dek', key: dek }]);
    if (dekTry) {
      out[i] = line;
      plains[i] = dekTry.plain;
      continue;
    }

    const globalTry = tryDecryptWithCandidates(parsed, masterCandidates);
    if (!globalTry) {
      return { status: 'cannot-decrypt', reason: `line ${i + 1}` };
    }
    anyMigratable = true;
    const fresh = encryptEnvelope(globalTry.plain, { key: dek });
    out[i] = JSON.stringify(fresh);
    plains[i] = globalTry.plain;
  }

  if (!anyMigratable) return { status: 'already-migrated' };
  if (dryRun) return { status: 'migrated', dryRun: true, format: 'jsonl' };

  // Backup-collision guard for the write path (same logic as json-envelope:
  // only fires when we're actually about to rewrite — idempotent and dry-run
  // paths short-circuited above).
  try {
    await fs.access(backupPath);
    return { status: 'skipped-backup-exists', reason: backupPath };
  } catch {
    // expected — no stale backup
  }

  await writeFileDurable(backupPath, text);
  try {
    await writeFileDurable(tempPath, out.join('\n'));
    await fs.rename(tempPath, filePath);
    // Best-effort durability (ai6 R2.2 — see json-envelope branch)
    let dirSyncWarning = null;
    try { await fsyncDir(parentDir); }
    catch (syncErr) { dirSyncWarning = syncErr.message; }

    const readBack = await fs.readFile(filePath, 'utf8');
    const verifyLines = readBack.split('\n');
    if (verifyLines.length !== lines.length) {
      const rbErr = await restoreFromBackup(filePath, backupPath);
      if (rbErr) {
        return {
          status: 'rollback-failed',
          reason: 'line-count-mismatch',
          rollbackError: rbErr.message,
        };
      }
      return { status: 'rolled-back', reason: 'line-count-mismatch' };
    }
    for (let i = 0; i < verifyLines.length; i += 1) {
      const vLine = verifyLines[i];
      if (vLine.trim() === '') continue;
      // ai6 R1.2 — must NOT call parseAndDecrypt on plaintext lines (which
      // would either silently bypass via parseAndDecrypt's isEnvelope check
      // or throw, depending on shape). Split here: plaintext lines go through
      // structural equality, envelope lines through parseAndDecrypt + DEK.
      const parsed = JSON.parse(vLine);
      let decoded;
      if (isEnvelope(parsed)) {
        decoded = decryptEnvelope(parsed, { key: dek });
      } else {
        decoded = parsed;
      }
      if (JSON.stringify(decoded) !== JSON.stringify(plains[i])) {
        const rbErr = await restoreFromBackup(filePath, backupPath);
        if (rbErr) {
          return {
            status: 'rollback-failed',
            reason: `line ${i + 1} round-trip mismatch`,
            rollbackError: rbErr.message,
          };
        }
        return { status: 'rolled-back', reason: `line ${i + 1} round-trip mismatch` };
      }
    }

    if (!keepBackups) await fs.unlink(backupPath);
    return dirSyncWarning
      ? { status: 'migrated', dirSyncWarning }
      : { status: 'migrated' };
  } catch (err) {
    if (isCodeDefect(err)) {
      try { await fs.unlink(tempPath); } catch { /* */ }
      try { await fs.unlink(backupPath); } catch { /* */ }
      throw err;
    }
    const rbErr = await restoreFromBackup(filePath, backupPath);
    try { await fs.unlink(tempPath); } catch { /* */ }
    if (rbErr) {
      return {
        status: 'rollback-failed',
        reason: err.message,
        rollbackError: rbErr.message,
      };
    }
    return { status: 'rolled-back', reason: err.message };
  }
};
