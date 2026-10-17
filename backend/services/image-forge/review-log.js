/**
 * THE VERDICT — the ledger taste is the residue of.
 *
 * Design note, 2026-08-05: […]
 *
 * There is no taste ENGINE here, and there is not meant to be one. Taste
 * decomposes into three strata and only the top is subjective:
 *
 *   ADHERENCE  — objective, and the one this file makes checkable. You asked for
 *                three figures; there are two. You asked for a hand around a
 *                cup; the hand has six fingers. `matches` + `missing`.
 *   CRAFT      — intersubjective: anatomy, artifacts, exposure, composition.
 *                Disagreeable, but only with evidence. `defects`.
 *   PREFERENCE — irreducibly subjective, not derivable from the other two.
 *                `note`.
 *
 * You cannot write the third one. You can only keep a record of judgments and
 * let taste be what accumulates — which is also why identical code yields a
 * different taste per being: each accrues a different history of judgment
 * against a different history of intent.
 *
 * TWO AUTHORS, NEITHER OVERWRITING THE OTHER (Founder's call, 2026-08-05): a being's
 * verdict and its operator's grade are separate rows on the same image. The
 * operator's is authoritative INPUT the being weighs, never a correction applied
 * over its own judgment — its taste stays its own, informed by his. An
 * append-only log is what makes that structural rather than a promise.
 *
 * The prompt text is NOT copied here. `jobId` links a row to the attempt log,
 * which already holds the verbatim positive and negative — one source of truth
 * for what was asked, joined on read.
 *
 * Lives under `data/image-forge/` (gitignored, beside the attempt log) and is
 * served only to an authenticated operator.
 */
import { getDataRoot } from '../data-root.js';
import {
  appendFileSync, existsSync, mkdirSync, statSync, openSync, readSync, closeSync,
} from 'fs';
import path from 'path';
import { createLogger } from '../logger.js';

const log = createLogger('ImageForge.Reviews');

/** Where the log lives. Overridable so tests never touch the real one. */
export const reviewLogPath = (env = process.env) =>
  env.COMFYUI_REVIEW_LOG_PATH || path.join(getDataRoot(), 'image-forge', 'reviews.jsonl');

/** How many rows a read returns, newest first. */
export const READ_CAP = 200;

/** What a reviewer decides the image is for. */
export const VERDICTS = Object.freeze(['keep', 'redo', 'discard']);

/** How well the render answered what was actually asked for. */
export const MATCHES = Object.freeze(['yes', 'partial', 'no']);

/** Longest free-text a single field may carry into the ledger. */
export const MAX_FIELD_CHARS = 2000;

/**
 * One of VERDICTS, or null. Pure — so both the tool and the route refuse the
 * same way and an unknown word never reaches the file.
 * @param {*} value
 * @returns {string|null}
 */
export const normalizeVerdict = (value) => {
  const v = String(value ?? '').trim().toLowerCase();
  return VERDICTS.includes(v) ? v : null;
};

/**
 * One of MATCHES, or null. Pure.
 * @param {*} value
 * @returns {string|null}
 */
export const normalizeMatches = (value) => {
  const v = String(value ?? '').trim().toLowerCase();
  return MATCHES.includes(v) ? v : null;
};

// pure — a free-text column: trimmed, bounded, empty becomes null so an absent
// field and a blank one read the same downstream.
const field = (value) => {
  const s = typeof value === 'string' ? value.trim().slice(0, MAX_FIELD_CHARS) : '';
  return s.length > 0 ? s : null;
};

/**
 * Shape one review row. PURE — what gets written is testable without a disk.
 *
 * `by` is the standing of the author, not their name: 'being' and 'operator'
 * are the only two, and the distinction is the whole point of the file.
 * @param {object} r
 * @returns {object} the row to append
 */
export const toReviewRecord = ({
  at, imageId, jobId, laneId, by, author, matches, missing, defects, verdict, note,
}) => ({
  at: at ?? null,
  imageId: imageId ?? null,
  jobId: jobId ?? null,
  laneId: laneId ?? null,
  by: by === 'operator' ? 'operator' : 'being',
  author: field(author),
  // Adherence and craft are the being's own columns — an operator grading in
  // the gallery gives a verdict and a reason, not an itemised adherence pass.
  matches: normalizeMatches(matches),
  missing: field(missing),
  defects: field(defects),
  verdict: normalizeVerdict(verdict),
  note: field(note),
});

// Directories already ensured this process — same memo as the attempt log: this
// runs inside a being's turn, where a per-write mkdirSync is both a wasted
// syscall and a hang risk on a pathological path.
const ensured = new Set();

/**
 * Append one review. Impure. NEVER throws into the caller — a ledger write
 * failing must not turn a recorded judgment into a failed turn.
 *
 * But it must not LIE about it either, and those are two different things. This
 * used to return undefined either way, so both callers said "recorded" on a
 * disk that had refused the write — the being was told its judgment was kept
 * when nothing was kept, which is the one outcome a record like this exists to
 * make impossible. The boolean is how the turn survives AND the reviewer is
 * told the truth.
 * @param {object} record
 * @param {object} [env]
 * @returns {boolean} whether the row actually reached the disk
 */
export const recordReview = (record, env = process.env) => {
  try {
    const file = reviewLogPath(env);
    const dir = path.dirname(file);
    if (!ensured.has(dir)) { mkdirSync(dir, { recursive: true }); ensured.add(dir); }
    appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
    return true;
  } catch (err) {
    log.warn('review log write failed', { err: err.message });
    return false;
  }
};

/** Test seam: forget the ensured-directory memo. Impure. */
export const _resetEnsured = () => ensured.clear();

/**
 * How much of the tail is read. The log is append-only and unbounded, and
 * unlike the attempt log this one is read on EVERY TURN (the residue rides the
 * prompt), so a whole-file read would grow the cost of every turn for the rest
 * of the machine's life. 256KB is far more than READ_CAP rows of JSONL.
 */
export const TAIL_BYTES = 262_144;

/**
 * Read the tail of the log, newest first. Impure.
 *
 * Bounded by BYTES, not by lines: only the last TAIL_BYTES are pulled off the
 * disk, and the first line of that window is dropped unless the window covers
 * the whole file — a byte offset lands mid-record, and half a JSON object is
 * not a review.
 *
 * A torn final line (crash mid-append) is skipped rather than failing the read.
 * `total` counts the rows in the window, not the file — an honest count of what
 * was actually looked at.
 * @param {number} [limit]
 * @param {object} [env]
 * @returns {{entries: Array<object>, total: number}}
 */
export const readReviews = (limit = READ_CAP, env = process.env) => {
  const file = reviewLogPath(env);
  if (!existsSync(file)) return { entries: [], total: 0 };
  let fd;
  try {
    const size = statSync(file).size;
    const span = Math.min(size, TAIL_BYTES);
    const buf = Buffer.allocUnsafe(span);
    fd = openSync(file, 'r');
    readSync(fd, buf, 0, span, size - span);
    const text = buf.toString('utf8');
    const lines = (span < size ? text.slice(text.indexOf('\n') + 1) : text)
      .split('\n').filter((l) => l.trim().length > 0);
    const entries = [];
    for (let i = lines.length - 1; i >= 0 && entries.length < limit; i -= 1) {
      try { entries.push(JSON.parse(lines[i])); } catch { /* skip a torn line */ }
    }
    return { entries, total: lines.length };
  } catch (err) {
    log.warn('review log read failed', { err: err.message });
    return { entries: [], total: 0 };
  } finally {
    if (fd !== undefined) { try { closeSync(fd); } catch { /* already gone */ } }
  }
};

/**
 * Every row standing on one image, newest first. Pure.
 *
 * Both standings come back together and in order — an operator about to grade
 * needs to see what the being already said, and the being's row is never
 * hidden behind the operator's.
 *
 * SCOPED BY LANE when the caller knows it, which every real caller does. The
 * log is one file across all lanes and the route proves only that the IMAGE
 * belongs to the lane — not that every row matching its id does. Image ids are
 * `randomUUID()` so a collision is not a practical worry, but the lane is
 * already in the caller's hand and `foldTaste` scopes by it: a filter that can
 * be exact has no business being merely probable.
 * @param {Array<object>} entries
 * @param {string} imageId
 * @param {string|null} [laneId] when given, rows must match it too
 * @returns {Array<object>}
 */
export const reviewsFor = (entries, imageId, laneId = null) =>
  (Array.isArray(entries) ? entries : [])
    .filter((e) => e?.imageId === imageId && (laneId === null || e?.laneId === laneId));
