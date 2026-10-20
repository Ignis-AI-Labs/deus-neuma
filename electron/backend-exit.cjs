// Backend exit — what the desk says when its backend child goes down on its own.
//
// A child that exits normally reports a code; one the system kills reports a
// SIGNAL and a null code. The OOM killer's SIGKILL is the common case of the
// second, and it is exactly the one an operator most needs told about, because
// their beings stop answering with no other sign. Pure; backend-spawn.cjs owns
// the dialog and the restart.

/**
 * The operator-facing sentence for a backend exit, or null when the exit says
 * nothing went wrong (code 0, no signal). Pure.
 * @param {number|null} code - the child's exit code (null when a signal ended it)
 * @param {string|null} signal - the signal that ended it, e.g. 'SIGKILL'
 * @returns {string|null}
 */
const backendExitNotice = (code, signal) => {
  if (signal) {
    const why = signal === 'SIGKILL' ? ' This most often means the computer ran out of memory.' : '';
    return `The local backend was stopped by the system (${signal}).${why}`;
  }
  if (code) return `The local backend stopped unexpectedly (exit ${code}).`;
  return null;
};

module.exports = { backendExitNotice };
