// ollama-server-state — what answers at an Ollama endpoint, and whether the platform may use it.
// impure (network, /proc through listener-owner.js). Cut from managed-ollama.js, which reads it.
//
// An answer on the port is not the server (PR600 audit P6-153): any program on this computer can
// bind 127.0.0.1:11434 before Ollama does, answer /api/version with a new enough number, and become
// every being's model: it would read every prompt and write every reply and tool call. So a server
// found answering is used only when this account runs it, or root, or the `ollama` service account
// Ollama's own installer creates. One run by another person's account is reported as `foreign` and
// never used: the setup puts the platform's own server beside it, and a boot moves past it.
// On Linux, where the system cannot say who listens (a port forwarded from elsewhere), the answer
// stands as it always did. On macOS and Windows a server whose owner cannot be read is `foreign`
// too: it answered, and no listener of a trusted account was found (listener-owner.js).
import { createLogger } from './logger.js';
import { listenerStanding, answeredStanding } from './listener-owner.js';
import { loopbackPort, SERVICE_ACCOUNTS } from './loopback-route-owner.js';
import { MIN_OLLAMA_VERSION, versionAtLeast } from './managed-ollama-plan.js';

const log = createLogger('ManagedOllama');
const DOWN = Object.freeze({ up: false, version: null, models: Object.freeze([]) });

/**
 * What answers at an Ollama endpoint: up, its version, the models it holds; `foreign` (with the
 * account's id) when another account on this computer runs what answers there. impure
 * @param {string} endpoint
 * @param {{platform?: string}} [opts] - the system whose way of reading a listener's owner is used
 * @returns {Promise<{up: boolean, version: string|null, models: string[], foreign?: true, ownerUid?: number|string|null}>}
 *   ownerUid: the other account, or null where it could not be read
 */
export const serverState = async (endpoint, { platform = process.platform } = {}) => {
  try {
    const v = await fetch(`${endpoint}/api/version`, { signal: AbortSignal.timeout(2000) });
    if (!v.ok) return DOWN;
    const port = loopbackPort(endpoint);
    const owner = port === null ? null : answeredStanding(platform, listenerStanding(port, { serviceAccounts: SERVICE_ACCOUNTS, platform }));
    if (owner?.standing === 'foreign') {
      log.warn('what answers at the model server\'s address is run by another account; it is not used', { endpoint, ownerUid: owner.uid });
      return { up: true, version: null, models: [], foreign: true, ownerUid: owner.uid };
    }
    const { version = null } = await v.json().catch(() => ({}));
    const t = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
    const models = t?.ok ? ((await t.json().catch(() => ({}))).models || []).map((m) => m.name) : [];
    return { up: true, version, models };
  } catch {
    return DOWN;
  }
};

/** May the platform use what answers there: up, run by an account it trusts, and new enough? Pure. */
export const usableServer = (state) => Boolean(state?.up && !state.foreign && versionAtLeast(state.version, MIN_OLLAMA_VERSION));

/** Is an Ollama the platform may talk to answering at this endpoint? impure */
export const ollamaUp = async (endpoint) => {
  const state = await serverState(endpoint);
  return state.up && !state.foreign;
};
