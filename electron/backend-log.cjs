/**
 * backend-log — the packaged app keeps its own diagnostics.
 *
 * Design note, 2026-08-03, after a fourth version shipped for one community member
 * without anyone knowing what his machine was actually doing:
 *
 *   […]
 *
 * He is describing a blindness the app built for itself. The backend runs as a
 * spawned child with `stdio: 'inherit'`, which in DEV lands in the operator's
 * terminal and is exactly right. In a PACKAGED install launched from a desktop
 * icon or an AppImage there is no terminal — so every log line the backend
 * writes, including the ones added precisely to diagnose this class of failure,
 * went nowhere. Four rounds of screenshots and inference, because the one file
 * that would have answered it in a second did not exist.
 *
 * So a packaged backend writes to `~/.neuma/logs/backend.log`. One run per
 * file; the previous run survives as `backend.prev.log`, because the run that
 * failed is usually the one BEFORE the operator thought to look.
 *
 * Deliberately not a logging framework: two files, a size cap, and a path a
 * person can be told over chat.
 */
const path = require('node:path');
const fs = require('node:fs');

/** Where a packaged install keeps its logs. */
const logDir = (home) => path.join(home, '.neuma', 'logs');

/** The current run's log, and the previous run's. */
const logPaths = (home) => ({
  current: path.join(logDir(home), 'backend.log'),
  previous: path.join(logDir(home), 'backend.prev.log'),
});

/**
 * A run that grew past this is rotated at OPEN rather than truncated mid-write,
 * so a session's file is never cut in half. 8 MB holds a long session of an
 * app this chatty and still opens in any editor.
 */
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Open the log lane for a new backend run. Returns a file descriptor to hand
 * to `spawn`'s stdio, or null if anything at all went wrong — a machine whose
 * home is unwritable must still get an app, so this NEVER throws and the caller
 * falls back to 'inherit'.
 *
 * @param {string} home - the user's home directory (app.getPath('home'))
 * @returns {{fd: number, path: string}|null}
 */
const openBackendLog = (home) => {
  try {
    const { current, previous } = logPaths(home);
    fs.mkdirSync(logDir(home), { recursive: true });

    // Last run's file becomes .prev. The failure an operator reports is
    // usually one launch old — they hit it, quit, reopened, and only then
    // went looking.
    if (fs.existsSync(current)) {
      try { fs.rmSync(previous, { force: true }); } catch { /* best effort */ }
      try { fs.renameSync(current, previous); } catch { /* best effort */ }
    }

    const fd = fs.openSync(current, 'a');
    // A header, so a file pasted into a chat says which build produced it
    // without anyone having to ask a follow-up question.
    fs.writeSync(fd, `\n=== NEUMA backend log — ${new Date().toISOString()} ===\n`);
    return { fd, path: current };
  } catch {
    return null;
  }
};

/**
 * Rotate if the CURRENT file is already oversized before a run begins. Pure
 * decision, exposed for test: the caller does the moving.
 * @param {number} bytes
 */
const shouldRotate = (bytes) => Number.isFinite(bytes) && bytes >= MAX_BYTES;

module.exports = { openBackendLog, logPaths, logDir, shouldRotate, MAX_BYTES };
