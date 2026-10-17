/**
 * DESK PARENT WATCH — the backend must not outlive the desk that spawned it.
 *
 * ── THE FAILURE THIS EXISTS FOR ─────────────────────────────────────────────
 *
 * The desk spawns this backend as its own PROCESS GROUP LEADER (`detached:
 * true`, electron/main.cjs) so that quitting can signal the whole group and
 * take the MCP filesystem server with it — the server rides an `npx` wrapper,
 * so signalling the backend alone leaves the real one standing to die on an
 * unhandled EPIPE (#211).
 *
 * That fix has a cost, and this module is the payment. A detached child is in
 * its OWN group, so it no longer receives the terminal's signals. Ctrl-C in the
 * terminal running `npm run electron:dev` kills Electron and LEAVES THE BACKEND
 * RUNNING — holding port 47317, so the next launch dies with EADDRINUSE and the
 * operator sees a port conflict rather than […]
 * (#215). A crash or SIGKILL strands it the same way, and no handler inside the
 * desk can cover those: a process that is killed outright runs no code.
 *
 * So the backend watches for itself. When the desk that spawned us dies, the
 * kernel reparents us — our parent pid changes — and that is a fact we can see
 * without cooperation from anything.
 *
 * ── WINDOWS ────────────────────────────────────────────────────────────────
 *
 * Windows does not reparent, so the ppid simply goes stale and this never
 * fires. That is correct rather than unfortunate: Windows has no process groups
 * either, which is why the desk kills the tree with `taskkill /T` there — a
 * mechanism that does not depend on the child noticing anything.
 *
 * The decision is pure and separately provable; only the clock and the exit are
 * impure.
 */

/** The env var the desk stamps its own pid into when it spawns us. */
export const DESK_PID_ENV = 'NEUMA_DESK_PID';

/** How often to look. Long enough to cost nothing, short enough that a freed
 *  port is free before the operator has finished reading the error. */
export const WATCH_INTERVAL_MS = 4000;

/**
 * Pure — has the desk that spawned this backend gone away?
 *
 * FALSE is the safe answer and the default for every uncertainty: a backend
 * that exits because it misread its own parentage would take a live desk's
 * beings down with it, which is far worse than a stranded process. So this only
 * says yes when it has two real pids and they genuinely differ.
 *
 * @param {number} deskPid - the pid the desk stamped at spawn
 * @param {number} currentPpid - this process's parent pid, now
 * @returns {boolean}
 */
export const isOrphaned = (deskPid, currentPpid) => {
  if (!Number.isInteger(deskPid) || deskPid <= 1) return false;      // not desk-spawned
  if (!Number.isInteger(currentPpid) || currentPpid <= 0) return false; // unreadable
  return currentPpid !== deskPid;
};

/**
 * Pure — the desk pid this process was spawned by, or null when it was not
 * spawned by a desk at all (`npm run dev:backend`, the test lane, CI).
 * @param {object} env
 * @returns {number|null}
 */
export const deskPidFrom = (env) => {
  const n = Number.parseInt(env?.[DESK_PID_ENV] ?? '', 10);
  return Number.isInteger(n) && n > 1 ? n : null;
};

/**
 * impure — start watching. Returns a stop function, or null when this process
 * was not spawned by a desk (in which case there is no parent to outlive).
 *
 * @param {object} [opts]
 * @param {Function} opts.onOrphaned - called ONCE when the desk is gone
 * @param {object} [opts.env] - defaults to process.env
 * @param {Function} [opts.ppid] - reads the current parent pid
 * @param {number} [opts.intervalMs]
 * @returns {Function|null} stop
 */
export const watchDeskParent = ({
  onOrphaned,
  env = process.env,
  ppid = () => process.ppid,
  intervalMs = WATCH_INTERVAL_MS,
} = {}) => {
  const deskPid = deskPidFrom(env);
  if (deskPid === null || typeof onOrphaned !== 'function') return null;
  let fired = false;
  const timer = setInterval(() => {
    if (fired || !isOrphaned(deskPid, ppid())) return;
    fired = true;               // one exit, however long the shutdown takes
    clearInterval(timer);
    onOrphaned(deskPid);
  }, intervalMs);
  // Never hold the process open on our account — this watches an exit, it must
  // not prevent one.
  timer.unref?.();
  return () => clearInterval(timer);
};
