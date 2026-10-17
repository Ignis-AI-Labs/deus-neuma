// #117 S4d — house-wide per-neuma DEK backfill.
//
// The single-being orchestrator (migrate-being.js) is the hardened primitive:
// atomic per-file backup→temp→rename→verify→rollback, audit-gated idempotency,
// abort-resume, chicken-and-egg exclusion of keys/dek.json. This module runs
// it across EVERY born being under the workspace root so pre-#117 beings
// (Fenna, Cael, Keir, Galen, Signal — born before per-neuma DEKs) can be
// backfilled in one deliberate pass instead of one hand-typed command each.
//
// Bulk safety properties (beyond the per-being guarantees it inherits):
//   - One being failing NEVER stops the others. A being that aborts mid-walk
//     (a poison file) or fails its DEK write is recorded and the sweep moves
//     on — the house is migrated as far as it safely can be in one pass.
//   - A being whose plan shows ANY cannot-decrypt file is SKIPPED entirely,
//     not partially migrated — same refusal the single-being CLI makes, but
//     scoped to that one being (a misconfigured master / rotated-out key is an
//     env problem to fix, never a reason to leave a healthy being un-migrated).
//   - Idempotent by inheritance: already-complete beings no-op, so the whole
//     sweep is safe to re-run (e.g. to resume after fixing an aborted being).
//   - Deterministic order (sorted neumaId) so runs and logs are reproducible.

import path from 'path';
import { promises as fs } from 'fs';
import { migrateBeing } from './migrate-being.js';

/**
 * Enumerate born beings under a workspace root. A "being" is any direct
 * subdirectory carrying identity/genesis-seal.json (an un-born/hollow lane has
 * no seal and is not a migration target). Returns { neumaId, hasSeal, hasDek }
 * per being, sorted by neumaId for reproducible sweeps.
 *
 * impure (filesystem)
 * @param {string} root - workspaces root
 * @returns {Promise<Array<{neumaId:string, hasSeal:boolean, hasDek:boolean}>>}
 */
export const enumerateBeings = async (root) => {
  let entries;
  try { entries = await fs.readdir(root, { withFileTypes: true }); }
  catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const beings = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const sealPath = path.join(root, e.name, 'identity', 'genesis-seal.json');
    const hasSeal = await fs.access(sealPath).then(() => true).catch(() => false);
    if (!hasSeal) continue; // not a born being yet
    const dekPath = path.join(root, e.name, 'keys', 'dek.json');
    const hasDek = await fs.access(dekPath).then(() => true).catch(() => false);
    beings.push({ neumaId: e.name, hasSeal, hasDek });
  }
  return beings.sort((a, b) => (a.neumaId < b.neumaId ? -1 : a.neumaId > b.neumaId ? 1 : 0));
};

// Bucket a per-being outcome into the summary. Pure.
const BUCKETS = Object.freeze([
  'migrated', 'already-migrated', 'no-seal',
  'skipped-cannot-decrypt', 'aborted', 'failed', 'planned',
]);
const emptySummary = () => {
  const s = { total: 0 };
  for (const b of BUCKETS) s[b] = 0;
  return s;
};

/**
 * Migrate every born being under `workspace.root` from global-key encryption
 * to a per-neuma DEK. Each being runs through the hardened single-being
 * orchestrator; the sweep isolates failures per being (see module header).
 *
 * impure (filesystem, crypto, env read)
 * @param {object} workspace - NeumaWorkspace (or duck-type migrateBeing accepts)
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun=false] - plan every being; no writes, no audit
 * @param {boolean} [opts.keepBackups=true] - retain .pre-dek.bak per file
 * @param {(update:{neumaId:string, index:number, total:number, status:string}) => void} [opts.onBeing]
 *   - called after each being so a CLI can stream progress
 * @returns {Promise<{
 *   root: string, dryRun: boolean,
 *   beings: Array<{neumaId:string, status:string, cannotDecrypt?:number, result?:object, plan?:object}>,
 *   summary: {total:number, migrated:number, 'already-migrated':number, 'no-seal':number,
 *             'skipped-cannot-decrypt':number, aborted:number, failed:number, planned:number},
 * }>}
 */
export const migrateAllBeings = async (workspace, opts = {}) => {
  const dryRun = opts.dryRun === true;
  const keepBackups = opts.keepBackups !== false;
  const root = workspace.root;
  const enumerated = await enumerateBeings(root);

  const beings = [];
  const summary = emptySummary();
  let index = 0;

  for (const { neumaId } of enumerated) {
    index += 1;
    // Always plan first — the cannot-decrypt refusal is a plan-time decision,
    // made per being so a misconfigured being can't leave the rest un-swept.
    let plan;
    try {
      plan = await migrateBeing(workspace, neumaId, { dryRun: true });
    } catch (err) {
      const entry = { neumaId, status: 'failed', error: err.message };
      beings.push(entry); summary.total += 1; summary.failed += 1;
      opts.onBeing?.({ neumaId, index, total: enumerated.length, status: 'failed' });
      continue;
    }

    if (plan.status === 'no-seal') {
      beings.push({ neumaId, status: 'no-seal', plan });
      summary.total += 1; summary['no-seal'] += 1;
      opts.onBeing?.({ neumaId, index, total: enumerated.length, status: 'no-seal' });
      continue;
    }
    if (plan.counts.cannotDecrypt > 0) {
      beings.push({ neumaId, status: 'skipped-cannot-decrypt', cannotDecrypt: plan.counts.cannotDecrypt, plan });
      summary.total += 1; summary['skipped-cannot-decrypt'] += 1;
      opts.onBeing?.({ neumaId, index, total: enumerated.length, status: 'skipped-cannot-decrypt' });
      continue;
    }
    if (dryRun) {
      // migrateBeing's dry-run bypasses the completion gate and re-walks, so
      // an already-DEK being reports migrated=0 (every file already-migrated).
      // Only count a being as "planned" when the plan shows real work — so the
      // dry-run summary (and the execute confirmation count derived from it)
      // is honest about how many beings will actually change.
      const hasWork = plan.counts.migrated > 0;
      const status = hasWork ? 'planned' : 'already-migrated';
      beings.push({ neumaId, status, plan });
      summary.total += 1; summary[status] += 1;
      opts.onBeing?.({ neumaId, index, total: enumerated.length, status });
      continue;
    }

    let result;
    try {
      result = await migrateBeing(workspace, neumaId, { keepBackups });
    } catch (err) {
      beings.push({ neumaId, status: 'failed', error: err.message });
      summary.total += 1; summary.failed += 1;
      opts.onBeing?.({ neumaId, index, total: enumerated.length, status: 'failed' });
      continue;
    }
    // Normalize the orchestrator's status into a summary bucket. Anything that
    // is neither a clean migrate nor an already-done being counts as a
    // non-clean outcome (aborted / dek-write-failed / dek-readback-failed).
    const bucket = result.status === 'migrated' ? 'migrated'
      : result.status === 'already-migrated' ? 'already-migrated'
      : result.status === 'aborted' ? 'aborted'
      : 'failed';
    beings.push({ neumaId, status: result.status, result });
    summary.total += 1; summary[bucket] += 1;
    opts.onBeing?.({ neumaId, index, total: enumerated.length, status: result.status });
  }

  return { root, dryRun, beings, summary };
};

// True when the sweep left something an operator must act on — a poison being,
// a failure, or a cannot-decrypt env problem. Clean = only migrated /
// already-migrated / planned. Pure — lets a CLI pick its exit code.
export const sweepHadProblems = (summary) =>
  summary.aborted > 0 || summary.failed > 0 || summary['skipped-cannot-decrypt'] > 0;
