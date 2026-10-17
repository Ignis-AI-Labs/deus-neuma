/**
 * file-lock — mutual exclusion across PROCESSES, not just across awaits.
 *
 * Several stores in this repo guard a read-modify-write with a module-level
 * promise chain. That is correct for one process and worthless for two, and
 * this box runs two: the dev stack (:3355) and the Electron desk (:47317),
 * same checkout, same `data/settings/*.json`. On 2026-07-27 a two-process race
 * over the campaign queue claimed 298 of 400 entries TWICE — each of which
 * would have been a duplicate public post — and lost 26 writes outright.
 *
 * A tmp-file+rename `save()` prevents a TORN file. It does nothing about a lost
 * update: the whole point is that the read and the write must be one atom, and
 * only something outside both processes can make them one.
 *
 * The lock is an exclusively-created file (`wx`) holding its owner's identity.
 * Exclusive create is the atom — the kernel picks exactly one winner.
 *
 * Two ways a lock like this ruins a system, and what is done about each:
 *
 *   A DEAD HOLDER WEDGES IT FOREVER. A process that is SIGKILLed never unlinks.
 *     So a lock is reaped when its holder is not a live pid, or when it is
 *     older than `staleMs` regardless (pids get reused; a TTL covers that).
 *
 *   A RELEASE FREES SOMEONE ELSE'S LOCK. If our lock is reaped while we still
 *     believe we hold it, a naive `unlink` on release deletes the NEXT holder's
 *     lock and lets a third process in. So release unlinks only after
 *     confirming the file still carries our own token.
 *
 * Failure to acquire is an ERROR, never a silent pass-through. A caller that
 * cannot get the lock has not done the work, and must not report that it did.
 */
import { promises as fs } from 'fs';
import { dirname } from 'path';

/** Thrown-error `code` when acquisition times out — a caller may retry on this. */
export const LOCK_TIMEOUT = 'ELOCKTIMEOUT';
/** A holder older than this is presumed dead even if its pid is alive (pid reuse). */
const DEFAULT_STALE_MS = 30_000;
/** How long to keep trying before giving up. Held sections here are single-digit ms. */
const DEFAULT_TIMEOUT_MS = 10_000;
const RETRY_MS = 4;

let seq = 0;
/** Unique per acquisition, so release can prove the lock on disk is still ours. */
const mintToken = () => `${process.pid}-${++seq}-${process.hrtime.bigint()}`;

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Is this pid a live process? `signal 0` checks existence without signalling.
 * EPERM means it exists and belongs to someone else — still alive. Pure-ish.
 * @param {number} pid
 */
const alive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
};

/**
 * Who holds the lock, and since when.
 *
 * `known: false` means the file is there but its owner cannot be read. Such a
 * lock is reaped ONLY by the TTL, never by the liveness check — we do not know
 * whose it is, and guessing "nobody's" would break the mutex outright. That is
 * not hypothetical: an earlier revision of this file created the lock with
 * `writeFile(..., 'wx')`, which creates and then writes, so a rival could read
 * it EMPTY, fail to parse, score it as pid -1 = dead, and reap a live lock. A
 * 400-entry two-process race caught it on the third consecutive run — one
 * double claim, i.e. one duplicate public post. `link()` below closes the
 * window; this stays as the second line of defence.
 *
 * impure — reads the lock file.
 * @param {string} lockPath
 * @returns {Promise<{pid: number, at: number, token: string, known: boolean}|null>} null = gone
 */
const readHolder = async (lockPath) => {
  let raw;
  try {
    raw = await fs.readFile(lockPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  try {
    const parsed = JSON.parse(raw);
    return {
      pid: Number(parsed.pid), at: Number(parsed.at), token: String(parsed.token || ''), known: true,
    };
  } catch {
    const stat = await fs.stat(lockPath).catch(() => null);
    if (!stat) return null; // vanished under us — free
    return { pid: -1, at: stat.mtimeMs, token: '', known: false };
  }
};

/**
 * Take the lock, or throw after `timeoutMs`.
 * impure — creates the lock file.
 * @param {string} lockPath
 * @param {{staleMs?: number, timeoutMs?: number}} [opts]
 * @returns {Promise<string>} the token to release with
 */
export const acquireFileLock = async (lockPath, opts = {}) => {
  const { staleMs = DEFAULT_STALE_MS, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  const token = mintToken();
  const deadline = Date.now() + timeoutMs;
  await fs.mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });

  for (;;) {
    // The atom: write the payload to a private file, then LINK it into place.
    // link() is atomic and fails EEXIST if the lock is held, so the lock file
    // never exists in a half-written state the way `writeFile(..., 'wx')` let
    // it — there is no instant at which a rival can read it empty.
    const tmp = `${lockPath}.${process.pid}.${seq}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify({ pid: process.pid, at: Date.now(), token }), {
        mode: 0o600,
      });
      await fs.link(tmp, lockPath);
      return token;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    } finally {
      await fs.unlink(tmp).catch(() => {});
    }

    const holder = await readHolder(lockPath);
    if (holder === null) continue; // released while we looked — try again at once

    // An unreadable holder is reaped by the TTL alone; only a KNOWN owner can
    // be declared dead by liveness.
    if ((holder.known && !alive(holder.pid)) || Date.now() - holder.at > staleMs) {
      // Reap. Racy between two reapers, and that is survivable: whoever unlinks
      // first, the `wx` create above still admits only one of them.
      await fs.unlink(lockPath).catch(() => {});
      continue;
    }

    if (Date.now() >= deadline) {
      // Tagged so a caller can tell "busy, try again" apart from […] — collapsing the two would hide real damage behind a retry.
      const err = new Error(
        `could not take ${lockPath} within ${timeoutMs}ms — held by pid ${holder.pid}`,
      );
      err.code = LOCK_TIMEOUT;
      throw err;
    }
    await sleep(RETRY_MS + Math.floor(Math.random() * RETRY_MS)); // jitter: no lockstep
  }
};

/**
 * Release, but only if the lock on disk is still the one we took. If ours was
 * reaped and re-taken, this is a no-op rather than a theft.
 * impure — removes the lock file.
 * @param {string} lockPath
 * @param {string} token
 */
export const releaseFileLock = async (lockPath, token) => {
  const holder = await readHolder(lockPath).catch(() => null);
  if (!holder || holder.token !== token) return; // not ours any more — leave it
  await fs.unlink(lockPath).catch(() => {});
};

/**
 * Run `fn` holding the lock. Releases on success and on throw alike.
 * impure.
 * @template T
 * @param {string} lockPath
 * @param {() => Promise<T>} fn
 * @param {{staleMs?: number, timeoutMs?: number}} [opts]
 * @returns {Promise<T>}
 */
export const withFileLock = async (lockPath, fn, opts = {}) => {
  const token = await acquireFileLock(lockPath, opts);
  try {
    return await fn();
  } finally {
    await releaseFileLock(lockPath, token);
  }
};
