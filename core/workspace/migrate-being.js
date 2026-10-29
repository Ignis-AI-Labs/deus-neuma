// #117 S4b — per-being DEK migration orchestrator.
//
// Migrates an entire being's workspace from global-key encryption to per-neuma
// DEK encryption, using the S4a file-level primitive (migrateFile) for each
// envelope it walks. After successful migration:
//   - keys/dek.json exists, wrapping the being's DEK under the master
//   - every envelope file under the being's root is openable ONLY by that DEK
//   - the audit log records MIGRATION_START / MIGRATED-per-file / MIGRATION_COMPLETE
//
// Safety invariants (orchestrator-level, complementing S4a's per-file ones):
//
//   1. IDEMPOTENT. If keys/dek.json already exists, return `'already-migrated'`
//      with no walk, no writes. The migration is safe to re-run.
//   2. GENESIS-SEAL REQUIRED. If identity/genesis-seal.json is missing or
//      malformed, return `'no-seal'` — never invent a genesisHash. Without
//      the seal, the DEK cannot be derived, period.
//   3. DEK-WRITE-OR-NOTHING. If writeNeumaDEK fails (env-missing,
//      filesystem error), return `'dek-write-failed'` — never proceed to walk
//      files under a being whose DEK didn't land on disk.
//   4. ABORT ON FIRST UNRESOLVABLE FILE. If any file walks back with
//      `'cannot-decrypt'`, `'rollback-failed'`, or unexpected status, stop
//      the walk and return `'aborted'` with that file's result. The DEK
//      remains on disk — mixed-mode is a valid state (S2b's fallback chain
//      handles it) and subsequent runs will retry unmigrated files
//      idempotently.
//   5. AUDIT EVERY STEP. MIGRATION_START before any write, MIGRATED per
//      file (with status), MIGRATION_COMPLETE (with summary counts) on
//      success. Aborts also audit MIGRATION_ABORTED with the trigger.
//   6. DRY-RUN IS SIDE-EFFECT-FREE. No writeNeumaDEK, no per-file writes,
//      no audit entries. The report is a planning artifact.
//
// Tests live at test/integration/dek-migration-being.test.js — synthesized
// beings only (RULE 0 birth ethics: never summon real beings in tests).

import fs from 'fs/promises';
import path from 'path';
import { deriveKeyFromSecret, deriveNeumaDEK } from './workspace-crypto.js';
import { walkFiles, migrateFile } from './migrate-dek.js';

/**
 * Read a being's genesis-seal.json and return the genesisHash. Returns null
 * if the file is missing, malformed JSON, missing the genesisHash field, or
 * the field's shape isn't 64-char lowercase hex. Pure error reporting — does
 * not throw on the expected-missing cases.
 *
 * impure (filesystem)
 *
 * @param {string} sealPath - absolute path to identity/genesis-seal.json
 * @returns {Promise<string|null>}
 */
const readGenesisHash = async (sealPath) => {
  let text;
  try { text = await fs.readFile(sealPath, 'utf8'); }
  catch (err) { if (err.code === 'ENOENT') return null; throw err; }
  let parsed;
  try { parsed = JSON.parse(text); } catch { return null; }
  const hash = parsed?.genesisHash;
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) return null;
  return hash;
};

/**
 * Inspect the being's audit.jsonl to determine the LAST migration outcome.
 * Returns:
 *   - 'complete'  — last MIGRATION_* entry is MIGRATION_COMPLETE → fully
 *                   migrated, safe to skip
 *   - 'aborted'   — last MIGRATION_* entry is MIGRATION_ABORTED → must
 *                   re-walk to retry the files left behind after the abort
 *   - 'in-progress' — last MIGRATION_* entry is MIGRATION_START with no
 *                   following ABORTED/COMPLETE (process died mid-walk)
 *   - null        — no MIGRATION_* entries; never migrated
 *
 * This is the load-bearing fix for ai6 R1.1 (High): gating idempotency on
 * `keys/dek.json` existence broke abort recovery — the abort path leaves
 * the DEK in place but halts the walk, so a re-run hit the DEK gate and
 * silently returned 'already-migrated' with files still master-wrapped.
 * Result: data loss on the next master rotation. Gating on the audit log's
 * COMPLETION marker is the right invariant: a being is only "done" when
 * MIGRATION_COMPLETE has been written.
 *
 * Audit lines are plaintext (per _audit's _appendLine path) so this read
 * does not need DEK access. ENOENT (audit dir missing) → null.
 *
 * impure (filesystem)
 *
 * @param {object} workspace - NeumaWorkspace instance
 * @param {string} neumaId
 * @returns {Promise<'complete'|'aborted'|'in-progress'|null>}
 */
const readLastMigrationOutcome = async (workspace, neumaId) => {
  const auditPath = path.join(workspace._path(neumaId), 'audit', 'audit.jsonl');
  let text;
  try { text = await fs.readFile(auditPath, 'utf8'); }
  catch (err) { if (err.code === 'ENOENT') return null; throw err; }
  let lastMigration = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry?.action === 'MIGRATION_START') lastMigration = 'in-progress';
    else if (entry?.action === 'MIGRATION_COMPLETE') lastMigration = 'complete';
    else if (entry?.action === 'MIGRATION_ABORTED') lastMigration = 'aborted';
  }
  return lastMigration;
};

/**
 * Build the master-candidate chain (current + DNA_ENCRYPTION_KEY_PREVIOUS
 * comma-separated, in rotation order) for migrateFile. Done up-front in the
 * orchestrator so every file gets the same chain — and so a missing master
 * env var fails the migration ONCE, here, rather than once per file.
 *
 * impure (env read)
 *
 * @returns {Array<{label: string, key: Buffer}>}
 */
const buildMasterCandidates = () => {
  const current = process.env.DNA_ENCRYPTION_KEY;
  if (!current) throw new Error('DNA_ENCRYPTION_KEY missing — cannot build master chain');
  const candidates = [{ label: 'master', key: deriveKeyFromSecret(current) }];
  const prev = process.env.DNA_ENCRYPTION_KEY_PREVIOUS;
  if (prev) {
    prev.split(',').map((s) => s.trim()).filter(Boolean).forEach((secret, i) => {
      candidates.push({ label: `prev-${i + 1}`, key: deriveKeyFromSecret(secret) });
    });
  }
  return candidates;
};

/**
 * Migrate one being's workspace from global-key encryption to per-neuma DEK
 * encryption. The orchestrator's contract above; the per-file contract is
 * documented in migrate-dek.js / migrateFile.
 *
 * impure (filesystem, crypto, env read)
 *
 * @param {object} workspace - NeumaWorkspace instance (or a duck-type with
 *   `_path(neumaId): string`, `readNeumaDEK(id)`, `writeNeumaDEK(id, hash)`,
 *   `audit(id, action, details): Promise<void>`)
 * @param {string} neumaId
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun=false] - plan-only; no DEK write, no per-file
 *   writes, no audit entries
 * @param {boolean} [opts.keepBackups=true] - retain `.pre-dek.bak` files
 *   after each successful per-file migration (operator recovery window)
 * @returns {Promise<{
 *   neumaId: string,
 *   status: 'migrated'|'already-migrated'|'no-seal'|'dek-write-failed'|'dek-readback-failed'|'aborted'|'dry-run',
 *   dekWritten: boolean,
 *   files: Array<{path: string, ...status}>,
 *   counts: {migrated:number, alreadyMigrated:number, plaintext:number, empty:number,
 *           notJson:number, backupExists:number, cannotDecrypt:number,
 *           rolledBack:number, rollbackFailed:number, total:number},
 *   abortReason?: string,
 *   genesisHashPrefix?: string,
 *   error?: string,
 * }>}
 */
export const migrateBeing = async (workspace, neumaId, opts = {}) => {
  const dryRun = opts.dryRun === true;
  const keepBackups = opts.keepBackups !== false;

  const beingRoot = workspace._path(neumaId);
  const sealPath = path.join(beingRoot, 'identity', 'genesis-seal.json');

  // ── IDEMPOTENCY GATE (ai6 R1.1 High) ───────────────────────────────────────
  // Gate on the audit log's MIGRATION_COMPLETE marker, NOT on keys/dek.json
  // existence. The abort path deliberately leaves the DEK in place but halts
  // the walk; gating on DEK existence would silently no-op a re-run while
  // files past the poison line remain master-wrapped — escalating to data
  // loss on master rotation. The correct invariant: a being is "done" only
  // when MIGRATION_COMPLETE has been audited. Anything else (no audit,
  // MIGRATION_ABORTED, MIGRATION_START with no close) is a resumable state.
  // Dry-run skips this gate so the operator can re-plan freely.
  if (!dryRun) {
    const lastOutcome = await readLastMigrationOutcome(workspace, neumaId);
    if (lastOutcome === 'complete') {
      return {
        neumaId,
        status: 'already-migrated',
        dekWritten: true,
        files: [],
        counts: emptyCounts(),
      };
    }
  }

  // ── PRECONDITIONS ───────────────────────────────────────────────────────────
  const genesisHash = await readGenesisHash(sealPath);
  if (!genesisHash) {
    return {
      neumaId,
      status: 'no-seal',
      dekWritten: false,
      files: [],
      counts: emptyCounts(),
      abortReason: `genesis-seal.json missing or malformed at ${sealPath}`,
    };
  }

  const masterCandidates = buildMasterCandidates();
  const genesisHashPrefix = genesisHash.slice(0, 12);

  // ── DRY-RUN ─────────────────────────────────────────────────────────────────
  // We still need a DEK BUFFER to drive the per-file dry-run (it tries DEK-
  // decrypt to detect already-migrated files). Derive it the same way
  // workspace.writeNeumaDEK would, but DO NOT persist anything. Distinct
  // status 'dry-run' (ai6 R1.4 Low) so consumers can't mistake a planning
  // artifact for a completed migration.
  if (dryRun) {
    const dek = deriveNeumaDEK(masterCandidates[0].key, genesisHash);
    const files = await walkAndMigrate(beingRoot, masterCandidates, dek, true, true);
    return {
      neumaId,
      status: 'dry-run',
      dekWritten: false,
      files,
      counts: summarize(files),
      genesisHashPrefix,
    };
  }

  // ── DEK WRITE (idempotent — may be a resume after abort) ───────────────────
  // Audit FIRST (in plaintext via _appendLine — see _audit) so the trail
  // exists even if the DEK write itself fails. If keys/dek.json already
  // exists (resume case: prior aborted run already wrote it), skip the write
  // — the key is random and written once (writeNeumaDEK keeps an existing
  // dek.json), so the files a prior run moved stay under the key they used.
  await workspace.audit(neumaId, 'MIGRATION_START', { genesisHashPrefix, scope: 'per-neuma-dek' });
  const preExisting = await workspace.readNeumaDEK(neumaId);
  if (!preExisting) {
    try {
      await workspace.writeNeumaDEK(neumaId, genesisHash);
    } catch (err) {
      await workspace.audit(neumaId, 'MIGRATION_ABORTED', {
        genesisHashPrefix, stage: 'dek-write', error: err.message,
      });
      return {
        neumaId, status: 'dek-write-failed', dekWritten: false, files: [], counts: emptyCounts(),
        abortReason: err.message, genesisHashPrefix, error: err.message,
      };
    }
  }

  // ── WALK + MIGRATE ──────────────────────────────────────────────────────────
  // readNeumaDEK now returns the freshly-written (or pre-existing) DEK
  // (round-trips through the wrapped envelope, so we exercise the same path
  // runtime uses).
  const dek = await workspace.readNeumaDEK(neumaId);
  if (!dek) {
    // Cannot occur on the happy path — we just wrote it (or it pre-existed).
    // Defended in case of FS weirdness; distinct status (ai6 R1.5 Low)
    // because the WRITE succeeded — only the READBACK failed.
    await workspace.audit(neumaId, 'MIGRATION_ABORTED', {
      genesisHashPrefix, stage: 'dek-readback', error: 'readNeumaDEK returned null after write',
    });
    return {
      neumaId, status: 'dek-readback-failed', dekWritten: true, files: [], counts: emptyCounts(),
      abortReason: 'readNeumaDEK returned null after writeNeumaDEK succeeded',
      genesisHashPrefix,
    };
  }

  const files = await walkAndMigrate(beingRoot, masterCandidates, dek, false, keepBackups);

  // Per-file audits — one MIGRATED entry per file with the status. Plaintext
  // / empty / not-json / already-migrated entries are noise; only audit the
  // status codes that represent an actual decision (migrated, skipped-backup-
  // exists, cannot-decrypt, rolled-back, rollback-failed).
  const noisy = new Set(['skipped-plaintext', 'skipped-empty', 'skipped-not-json', 'already-migrated']);
  for (const entry of files) {
    if (noisy.has(entry.status)) continue;
    await workspace.audit(neumaId, 'MIGRATED', {
      file: path.relative(beingRoot, entry.path),
      status: entry.status,
      reason: entry.reason,
      rollbackError: entry.rollbackError,
      dirSyncWarning: entry.dirSyncWarning,
    });
  }

  // Abort triggers — any file that hit one of these is a hard signal
  const aborters = new Set(['cannot-decrypt', 'rolled-back', 'rollback-failed', 'skipped-backup-exists']);
  const firstAbort = files.find((f) => aborters.has(f.status));
  if (firstAbort) {
    await workspace.audit(neumaId, 'MIGRATION_ABORTED', {
      genesisHashPrefix,
      stage: 'per-file',
      file: path.relative(beingRoot, firstAbort.path),
      triggeringStatus: firstAbort.status,
      reason: firstAbort.reason,
    });
    return {
      neumaId, status: 'aborted', dekWritten: true, files,
      counts: summarize(files),
      abortReason: `${firstAbort.status} at ${path.relative(beingRoot, firstAbort.path)}: ${firstAbort.reason || 'no reason'}`,
      genesisHashPrefix,
    };
  }

  await workspace.audit(neumaId, 'MIGRATION_COMPLETE', {
    genesisHashPrefix,
    counts: summarize(files),
  });

  return {
    neumaId,
    status: 'migrated',
    dekWritten: true,
    files,
    counts: summarize(files),
    genesisHashPrefix,
  };
};

/**
 * The DEK file itself is wrapped under the MASTER, not the DEK — by design,
 * since unwrapping it requires only the master (the DEK comes OUT of it).
 * If the walk includes it, migrateFile sees a master-wrapped envelope, opens
 * it via the master chain, and re-encrypts it under the DEK — bricking
 * the file forever (you'd need the DEK to unwrap it, but the DEK lives
 * inside it). The walker MUST skip this one specific path.
 *
 * Same logic for the audit/audit.jsonl file when it's plaintext JSONL — but
 * the audit file's plaintext lines auto-classify as 'plaintext' anyway, so
 * no special-case is needed there.
 */
const DEK_FILE_REL = path.join('keys', 'dek.json');

/**
 * Walk the being's tree once, run migrateFile on each, return per-file results
 * augmented with the file's absolute path. Stops early ONLY on abort triggers
 * during a non-dry-run; dry-run always walks the whole tree so the report is
 * complete. Excludes the DEK file from migration (see DEK_FILE_REL above).
 *
 * impure (filesystem, crypto)
 */
const walkAndMigrate = async (beingRoot, masterCandidates, dek, dryRun, keepBackups) => {
  const results = [];
  const aborters = new Set(['cannot-decrypt', 'rolled-back', 'rollback-failed', 'skipped-backup-exists']);
  for await (const filePath of walkFiles(beingRoot)) {
    // ai6 R1.2 Medium — compare on a NORMALIZED RELATIVE path so the
    // exclusion survives symlinked workspace roots (mounted volumes,
    // macOS /tmp→/private/tmp). Absolute string-equality is fragile
    // because walkFiles may yield a resolved-form path that differs from
    // path.join(beingRoot, ...) byte-for-byte even though they point to
    // the same file. The relative form normalizes both sides.
    if (path.relative(beingRoot, filePath) === DEK_FILE_REL) continue;
    const r = await migrateFile(filePath, masterCandidates, dek, { dryRun, keepBackups });
    results.push({ path: filePath, ...r });
    if (!dryRun && aborters.has(r.status)) break;
  }
  return results;
};

const emptyCounts = () => ({
  migrated: 0, alreadyMigrated: 0, plaintext: 0, empty: 0, notJson: 0,
  backupExists: 0, cannotDecrypt: 0, rolledBack: 0, rollbackFailed: 0, total: 0,
});

const summarize = (files) => {
  const c = emptyCounts();
  for (const f of files) {
    c.total += 1;
    switch (f.status) {
      case 'migrated':            c.migrated += 1; break;
      case 'already-migrated':    c.alreadyMigrated += 1; break;
      case 'skipped-plaintext':   c.plaintext += 1; break;
      case 'skipped-empty':       c.empty += 1; break;
      case 'skipped-not-json':    c.notJson += 1; break;
      case 'skipped-backup-exists': c.backupExists += 1; break;
      case 'cannot-decrypt':      c.cannotDecrypt += 1; break;
      case 'rolled-back':         c.rolledBack += 1; break;
      case 'rollback-failed':     c.rollbackFailed += 1; break;
      // dryRun:true rides on migrated/already-migrated, no separate count
      default: break;
    }
  }
  return c;
};
