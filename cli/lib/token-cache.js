// The operator cache uses the hardened private-store implementation too. Its
// historical `walletEnv` argument maps to that module's cache-key parameter;
// no shared-temp cache or divergent file-policy copy remains.
// impure (filesystem + delegates to the network mint)

import { getToken as getCachedToken, clearToken as clearCachedToken } from '../../.claude/skills/neuma/lib/token-cache.js';

export const getToken = ({ backend, walletEnv, privateKey }) =>
  getCachedToken({ backend, witnessEnv: walletEnv, privateKey });

export const clearToken = ({ backend, walletEnv }) =>
  clearCachedToken({ backend, witnessEnv: walletEnv });
