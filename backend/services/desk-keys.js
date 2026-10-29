/**
 * Desk keys — the at-rest keys handed over by the desk, never through the
 * environment. A packaged app keeps them locked by the OS keychain
 * (electron/key-lock/); the shell unlocks them and answers this process's one
 * request on the IPC channel it spawned us with. The keys land in this
 * process's own environment for config and the workspace crypto to read; a
 * later setenv never shows in /proc/<pid>/environ, and the processes we start
 * drop them (agent-terminal-environment.js).
 *
 * Fails closed: a launch told to wait for its keys that never gets them exits,
 * rather than minting new keys over a locked record.
 */

const REQUEST = 'neuma:at-rest-keys?';
const REPLY = 'neuma:at-rest-keys';
const WAIT_MS = 20_000;

let lockState = Object.freeze({ source: 'env', backend: null, kitPending: false, since: null });

/** What holds the keys this launch: `keychain` (the desk's lock) or `env` (an env file / plain secrets file). */
export const keyLockState = () => lockState;

/** The desk reports the Recovery Kit saved (or replaced); the waiting account stops asking. */
const noteKitSaved = () => {
  lockState = Object.freeze({ ...lockState, kitPending: false });
};

/**
 * impure (IPC, env) — wait for the desk's keys when this launch was told to.
 * @param {{env?: Record<string, string|undefined>, channel?: NodeJS.Process}} [opts]
 * @returns {Promise<boolean>} true when the keys came from the desk
 */
export const receiveDeskKeys = async ({ env = process.env, channel = process } = {}) => {
  if (env.NEUMA_KEYS_VIA_IPC !== '1') return false;
  delete env.NEUMA_KEYS_VIA_IPC;
  if (typeof channel.send !== 'function') throw new Error('desk-keys: told to wait for keys, but no desk channel exists');
  const reply = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      channel.off('message', onMessage);
      reject(new Error('desk-keys: the desk never handed over the at-rest keys'));
    }, WAIT_MS);
    const onMessage = (message) => {
      if (message?.type !== REPLY) return;
      clearTimeout(timer);
      channel.off('message', onMessage);
      resolve(message);
    };
    channel.on('message', onMessage);
    channel.send({ type: REQUEST });
  });
  for (const [envKey, field] of [['DNA_ENCRYPTION_KEY', 'dnaEncryptionKey'], ['AUTH_SECRET', 'authSecret']]) {
    const value = reply.keys?.[field];
    if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw new Error(`desk-keys: the desk sent no ${envKey}`);
    if (env[envKey] && env[envKey] !== value) throw new Error(`desk-keys: ${envKey} from the environment disagrees with the desk's lock — refusing to guess`);
    env[envKey] = value;
  }
  lockState = Object.freeze({
    source: 'keychain', backend: String(reply.backend || ''), kitPending: Boolean(reply.kitPending), since: new Date().toISOString(),
  });
  channel.on('message', (message) => { if (message?.type === 'neuma:kit-saved') noteKitSaved(); });
  return true;
};
