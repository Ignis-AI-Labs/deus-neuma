// STORED SECRETS — the keyed services set from the desk (Settings → API),
// readable without an await by the code that needs them in the moment: a
// chain's RPC address, a web search key, the Hugging Face token handed to a
// child process. Most people never open an env file; developers still can.
//
// One rule everywhere, the same as model keys: a key saved in the desk wins,
// the env value is the fallback. The values come from the ENCRYPTED provider
// credential store and are held here in memory only (as the env's own values
// are); nothing is ever written in the clear, logged, or handed to a being.
// Loaded at boot and again after every save or removal.

import { SERVICE_CATALOG } from './provider-registry.js';
import { loadCredentials } from './provider-credentials.js';
import { createLogger } from './logger.js';

const log = createLogger('StoredSecrets');

let cache = Object.freeze({});

/** impure — re-read the encrypted store into memory (boot, and after each change). */
export const hydrateStoredSecrets = async () => {
  try {
    const store = await loadCredentials();
    const next = {};
    for (const { id } of SERVICE_CATALOG) {
      const value = store?.[id]?.apiKey;
      if (typeof value === 'string' && value.trim()) next[id] = value.trim();
    }
    cache = Object.freeze(next);
  } catch (err) {
    log.warn('stored service keys could not be read; env values still apply', { err: err.message });
  }
  return Object.keys(cache).length;
};

/**
 * A service's value: the desk-saved one, else the env's. impure (memory, env).
 * @param {string} serviceId
 * @param {Record<string, string|undefined>} [env]
 * @returns {string} '' when neither is set
 */
export const serviceValue = (serviceId, env = process.env) => {
  if (cache[serviceId]) return cache[serviceId];
  const entry = SERVICE_CATALOG.find((s) => s.id === serviceId);
  return entry?.keyEnv ? String(env[entry.keyEnv] || '').trim() : '';
};

/**
 * The env a child process starts from, with the desk-saved Hugging Face token
 * added when the env has none. impure.
 * @param {Record<string, string|undefined>} [env]
 */
export const withStoredHfToken = (env = process.env) => {
  if (env.HF_TOKEN || env.HUGGING_FACE_HUB_TOKEN || !cache['hf-downloads']) return env;
  return { ...env, HF_TOKEN: cache['hf-downloads'] };
};
