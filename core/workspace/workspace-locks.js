/**
 * Workspace file locks — per-path promise queues
 * (WORKSPACE-CONCURRENCY-001 + #121 + #120).
 *
 * Extracted from neuma-workspace.js (SIZE-025 #372) with the discipline
 * verbatim. Exactly ONE instance exists: the NeumaWorkspace facade constructor
 * creates it and hands it to every domain factory as deps.locks. A second
 * instance would split the queue and reintroduce the same-file races the lock
 * exists to prevent — two locks over one file is no lock at all.
 *
 * One queue per absolute file path serializes every operation on that path:
 * line-appends, atomic read-modify-write, temp-rename compaction. Different
 * paths still run in parallel.
 *
 * Why per-FILE (not per-workspace): a neuma's audit log and session can be
 * written concurrently without contention; only same-file races corrupt.
 *
 * Why one queue covers append AND read-modify-write: a compactSession that
 * temp-writes and renames a session.jsonl MUST exclude appendLines to that
 * same file during its window, or the rename clobbers an append.
 */

import fs from 'fs/promises';
import path from 'path';
import { SOVEREIGN_DIR_MODE } from './sovereign-directory-modes.js';

/**
 * Create the single lock registry for one workspace engine.
 * @returns {Readonly<{
 *   withFileLock: (filePath: string, fn: () => Promise<any>) => Promise<any>,
 *   appendLine: (filePath: string, line: string) => Promise<void>,
 *   nextTmpName: () => number,
 * }>}
 */
export const createFileLocks = () => {
  const fileLocks = new Map(); // filePath -> tail Promise

  // Monotonic per-process suffix for temp names (MEM-008 #195): Date.now()
  // has ms resolution, so two same-ms writes to one path would otherwise
  // share a tmp file — one's rename moves it, the other's throws ENOENT.
  let tmpSeq = 0;

  /**
   * Run `fn` with exclusive access to a single file path. Concurrent callers
   * for the same path queue behind each other in enqueue order; different
   * paths run independently. The chain is poison-free: a thrown fn rejects
   * only the caller that enqueued it, and the next op runs against the
   * settled (rejected) predecessor.
   */
  // impure — mutates fileLocks; whatever fn does happens under the lock
  const withFileLock = (filePath, fn) => {
    const prev = fileLocks.get(filePath) || Promise.resolve();
    const run = prev.catch(() => {}).then(fn);
    fileLocks.set(filePath, run);
    // Once this settles AS the tail, drop it so the map can't grow unbounded.
    run.catch(() => {}).finally(() => {
      if (fileLocks.get(filePath) === run) fileLocks.delete(filePath);
    });
    return run;
  };

  /**
   * Append a single line to a file, serialized per filePath. Layered on
   * withFileLock so appends and atomic read-modify-writes coordinate through
   * the same queue — a compactSession on the same path will block parallel
   * appends until it completes, and vice versa.
   * @param {string} filePath - absolute file path
   * @param {string} line - the exact bytes to append (caller includes the '\n')
   */
  const appendLine = (filePath, line) =>
    withFileLock(filePath, async () => {
      // Self-create the lane dir INSIDE the serialized chain. Doing this in the
      // caller (a pre-append `await mkdir`) would let the mkdir race decide who
      // reaches the queue first — scrambling order. Here it stays idempotent and
      // ordered, and callers enqueue synchronously in call order.
      await fs.mkdir(path.dirname(filePath), { recursive: true, mode: SOVEREIGN_DIR_MODE });
      return fs.appendFile(filePath, line);
    });

  /** Next monotonic temp-name suffix (see tmpSeq note above). */
  const nextTmpName = () => ++tmpSeq;

  return Object.freeze({ withFileLock, appendLine, nextTmpName });
};
