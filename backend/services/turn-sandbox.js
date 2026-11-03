/**
 * THE TURN'S SHELL, PREPARED ONLY WHEN SANDBOX IS ON. OFF returns a direct
 * descriptor immediately — no sweep, bubblewrap, or overlay. ON prepares the
 * isolated shell on first use and sweeps the focused folder for secret paths:
 * ~1.3-1.5 s on this repository, warm, on NVMe — and it used to run before
 * EVERY message, whether or not the turn touched the shell. Design note, 2026-10-04:
 * […] Now the turn notes WHERE its
 * shell would stand and prepares it at the first act that needs it — the
 * sweep stays fresh (taken moments before the command, not a turn earlier),
 * and a refused preparation answers that call with its reason.
 */
import { ensureWitnessCodingSandbox } from './witness-coding-sandbox.js';
import { directShellFor } from './sandbox-mode.js';
import { createLogger } from './logger.js';

const log = createLogger('TurnSandbox');

/**
 * impure — reset this turn's shell to "not yet prepared", remembering where it would stand.
 * @param {Object} connection
 * @param {{laneId: string, sourceRoot: string}|null} source
 */
export const noteTurnSandboxSource = (connection, source) => {
  connection._turnSandbox = null;
  connection._turnSandboxError = null;
  connection._turnSandboxRecoverable = false;
  connection._turnSandboxSource = source;
};

/**
 * impure — the turn's prepared shell, preparing it on first use. Null when the
 * turn has no shell or preparation was refused (the reason rides
 * `_turnSandboxError`, as before).
 * @param {Object} connection
 * @returns {Promise<Object|null>}
 */
export const ensureTurnSandbox = async (connection) => {
  const source = connection?._turnSandboxSource;
  const direct = directShellFor(connection, source);
  if (direct) {
    connection._turnSandbox = direct;
    connection._turnSandboxError = null;
    return direct;
  }
  if (connection?._turnSandbox && !connection._turnSandbox.direct) return connection._turnSandbox;
  connection._turnSandbox = null;
  if (!source || connection._turnSandboxError) return null;
  try {
    connection._turnSandbox = await ensureWitnessCodingSandbox(source.laneId, source.sourceRoot);
    return connection._turnSandbox;
  } catch (err) {
    log.warn('coding sandbox unavailable this turn — the rest of the surface holds', {
      laneId: source.laneId, err: err.message,
    });
    connection._turnSandboxError = err.message;
    connection._turnSandboxRecoverable = err.code === 'OVERLAY_CONFLICT';
    return null;
  }
};
