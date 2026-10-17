/**
 * THE ATTEMPT LOG — what was actually asked for, kept so a refusal can be debugged.
 *
 * Design note, 2026-08-01, after a being was wrongly refused and could not reconstruct
 * its own request: […]
 *
 * The being genuinely could not answer. Its crystallized memory held a summary,
 * not the payload; nothing on the platform side retained the text either. So a
 * false refusal — the case that most needs evidence — left none, and the only
 * honest thing the being could say was […]
 *
 * This is the operator's record, on the operator's own machine:
 *   • EVERY attempt is written, and a REFUSED attempt above all — that is the
 *     one someone will come looking for.
 *   • Verbatim positive and negative text. A paraphrase cannot debug a screen
 *     that matches on exact words; the whole failure above was a word in the
 *     NEGATIVE slot, which no summary would have preserved.
 *   • Append-only JSONL beside the law it explains, so it survives a restart.
 *
 * It lives under `data/image-forge/` (gitignored, like the law) and is served
 * only to an authenticated operator. It is a debugging record, not the being's
 * journal — the being's own account of its work stays its own.
 */
import { getDataRoot } from '../data-root.js';
import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { createLogger } from '../logger.js';

const log = createLogger('ImageForge.Attempts');

/** Where the log lives. Overridable so tests never touch the real one. */
export const attemptLogPath = (env = process.env) =>
  env.COMFYUI_ATTEMPT_LOG_PATH || path.join(getDataRoot(), 'image-forge', 'attempts.jsonl');

/** How many lines a read returns, newest first. */
export const READ_CAP = 200;

/**
 * Shape one attempt record. PURE — so what gets written is testable without
 * touching a disk, and the redaction decision is visible in one place.
 *
 * Nothing here is redacted: an operator debugging a false refusal needs the
 * exact words, and a refused prompt that was genuinely prohibited is evidence
 * the operator should be able to see. The protection is that the file never
 * leaves the machine and the route behind it requires auth.
 *
 * @param {object} a
 * @returns {object} the record to append
 */
export const toAttemptRecord = ({
  jobId, laneId, beingName, pipelineId, positive, negative, params, outcome, refusalClass, detail, at,
}) => ({
  at: at ?? null,
  jobId: jobId ?? null,
  laneId: laneId ?? null,
  beingName: beingName ?? null,
  pipelineId: pipelineId ?? null,
  outcome: outcome ?? 'unknown',        // 'ok' | 'refused' | 'error' | 'stopped'
  refusalClass: refusalClass ?? null,
  detail: detail ?? null,
  positive: typeof positive === 'string' ? positive : '',
  negative: typeof negative === 'string' ? negative : '',
  params: params && typeof params === 'object' ? params : {},
});

// Directories already ensured this process. `recordAttempt` runs INSIDE a
// being's turn, so the per-write `mkdirSync` it used to do was both a wasted
// syscall on every render and a hang risk on a pathological path.
const ensured = new Set();

// impure — append one record. NEVER throws into the caller: a logging failure
// must not turn a working render into an error, nor a refusal into a crash.
export const recordAttempt = (record, env = process.env) => {
  try {
    const file = attemptLogPath(env);
    const dir = path.dirname(file);
    if (!ensured.has(dir)) { mkdirSync(dir, { recursive: true }); ensured.add(dir); }
    appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
  } catch (err) {
    log.warn('attempt log write failed', { err: err.message });
  }
};

/** Test seam: forget the ensured-directory memo. Impure. */
export const _resetEnsured = () => ensured.clear();

/**
 * Read the tail of the log, newest first. Impure.
 * A malformed line is skipped rather than failing the whole read — a truncated
 * final line (crash mid-append) must not hide the 199 good records above it.
 * @returns {{entries: Array<object>, total: number}}
 */
export const readAttempts = (limit = READ_CAP, env = process.env) => {
  const file = attemptLogPath(env);
  if (!existsSync(file)) return { entries: [], total: 0 };
  try {
    const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim().length > 0);
    const entries = [];
    for (let i = lines.length - 1; i >= 0 && entries.length < limit; i -= 1) {
      try { entries.push(JSON.parse(lines[i])); } catch { /* skip a torn line */ }
    }
    return { entries, total: lines.length };
  } catch (err) {
    log.warn('attempt log read failed', { err: err.message });
    return { entries: [], total: 0 };
  }
};
