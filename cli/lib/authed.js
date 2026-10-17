// Shared operator-auth runner for the routing commands: resolve a session token
// from the operator wallet and run fn(token, address), re-minting once on a 401
// (server restarted with a fresh secret). Mirrors the talk.js auth chain.
//
// This is a library function: it THROWS on failure and never touches process
// lifecycle — the command handler owns stderr + process.exit. Throwing (rather
// than exiting inside the lib) keeps the auth logic testable and honors Single
// Responsibility. impure (fs + signing + network).
import { readOperatorWallet } from './wallet.js';
import { resolveWalletEnvPath } from './wallet-env.js';
import { getToken, clearToken } from './token-cache.js';

/**
 * @param {{backend: string, cwd: string}} ctx
 * @param {(token: string, address: string) => Promise<any>} fn
 * @returns {Promise<any>} whatever fn returns
 * @throws when the operator wallet can't be read, or a non-401 error occurs
 */
export const withAuth = async ({ backend, cwd }, fn) => {
  const walletEnv = resolveWalletEnvPath(cwd);
  const { privateKey } = readOperatorWallet(walletEnv); // throws → caller surfaces + exits

  const once = async () => {
    const { token, address } = await getToken({ backend, walletEnv, privateKey });
    return fn(token, address);
  };

  try {
    return await once();
  } catch (err) {
    // A stale token (server restarted with a fresh secret) surfaces as a 401 —
    // drop the cache and re-mint once before giving up. Key on the numeric
    // status, not a message substring, so a non-401 whose body text merely
    // contains "401" is never misread as a stale token.
    if (err.status === 401) {
      clearToken({ backend, walletEnv });
      return once();
    }
    throw err;
  }
};
