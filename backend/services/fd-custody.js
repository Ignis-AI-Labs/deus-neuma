/**
 * FD CUSTODY — leaked FileHandles name their opener in OUR log.
 *
 * The 2026-08-15 boot log carried `Warning: Closing file descriptor 79 on
 * garbage collection` + DEP0137 on raw stderr: a real leak somewhere on the
 * boot path, with no way to tell WHERE from the warning — Node reports the
 * GC's stack, never the opener's. Every fs.open site in backend/ and core/
 * audits clean (try/finally), so the leaker is a rare path or a dependency.
 * Founder's law (same day): […] So the platform stops
 * letting this class of defect stay anonymous:
 *
 *   ALWAYS — GC-close warnings are folded into the structured log as errors
 *   (they bypassed the logger entirely; a leak on a packaged install was
 *   invisible in ~/.neuma/logs/backend.log).
 *
 *   TRACE (default ON; opt out with NEUMA_FD_TRACE=0) — fs.promises.open is
 *   wrapped to record each opener's stack; when the GC warning arrives, the
 *   log carries the exact open site. The cost is one Error-stack capture per
 *   open (~µs) — even the security watch's daily sweep of thousands of files
 *   totals milliseconds, and the 2026-08-15 relight proved the flag-gated
 *   version just reports "unknown open site" forever, because nobody boots
 *   with a diagnostic flag BEFORE the mystery.
 *
 * impure (process-wide listener; fs.promises.open wrap).
 */

import fs from 'fs/promises';
import { createLogger } from './logger.js';

const defaultLog = createLogger('FdCustody');

// fd → { path, stack, openedAt } while a traced FileHandle stands open.
const openHandles = new Map();

const GC_CLOSE_RE = /[Cc]losing (?:a )?file descriptor (\d+)[\s\S]*garbage collection/;

/** Trace record for a warning's fd, if tracing saw it. Pure over module state. */
const openerOf = (fd) => openHandles.get(fd) ?? null;

/**
 * FileHandles opened longer than `olderThanMs` ago and never closed — the
 * standing suspects. Only populated under NEUMA_FD_TRACE=1. Pure over module
 * state; exported for tests and HUD probes.
 * @param {number} [olderThanMs=0]
 * @param {number} [now=Date.now()]
 * @returns {Array<{fd: number, path: string, stack: string, openedAt: number}>}
 */
export const leakedOpenHandles = (olderThanMs = 0, now = Date.now()) =>
  [...openHandles.entries()]
    .filter(([, rec]) => now - rec.openedAt >= olderThanMs)
    .map(([fd, rec]) => ({ fd, ...rec }));

// impure — wraps fs.promises.open so every FileHandle records its opener and
// unrecords on close. Callers that destructured `open` before install keep
// the bare function; acceptable for a diagnostic.
const installTrace = () => {
  const realOpen = fs.open.bind(fs);
  fs.open = async (...args) => {
    const handle = await realOpen(...args);
    const record = {
      path: String(args[0]),
      stack: new Error('opened here').stack,
      openedAt: Date.now(),
    };
    openHandles.set(handle.fd, record);
    const realClose = handle.close.bind(handle);
    handle.close = (...closeArgs) => {
      openHandles.delete(handle.fd);
      return realClose(...closeArgs);
    };
    return handle;
  };
};

// Double-install must not double-log: one listener, one wrap, ever.
let standing = null;

/**
 * Stand the custody watch. Call once at boot, before subsystems open files.
 * Idempotent — a second call returns the standing uninstall.
 * @param {{trace?: boolean, logger?: Object}} [opts] - trace defaults ON
 *   (NEUMA_FD_TRACE=0 opts out); logger is a seam for tests.
 * @returns {() => void} uninstall (tests only — the platform never stands down)
 */
export const installFdCustody = ({ trace = process.env.NEUMA_FD_TRACE !== '0', logger } = {}) => {
  if (standing) return standing;
  const log = logger ?? defaultLog;
  if (trace) installTrace();
  const onWarning = (warning) => {
    const match = GC_CLOSE_RE.exec(warning?.message || '');
    if (!match) return;
    const fd = Number(match[1]);
    const opener = openerOf(fd);
    log.error('FileHandle leaked — the GC closed it, the opener never did', {
      fd,
      path: opener?.path ?? null,
      openedAt: opener?.stack ?? 'unknown open site — relaunch with NEUMA_FD_TRACE=1 to capture it',
    });
  };
  process.on('warning', onWarning);
  log.info('fd custody standing', { trace });
  standing = () => { process.off('warning', onWarning); standing = null; };
  return standing;
};
