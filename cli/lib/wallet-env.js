// Resolve the path to the operator's wallet env file. Used by talk so the
// resolution rule lives in ONE place and the override convention stays
// consistent.
//
// Order:
//   1. NEUMA_WALLET_ENV env var (operator's explicit override)
//   2. <projectRoot>/.env (operator-side, matches the existing
//      DNA_ENCRYPTION_KEY convention; project-root resolved via .git walk-up)
//
// impure (env read + fs stat via findProjectRoot)

import { resolve as resolvePath } from 'node:path';
import { findProjectRoot } from './project-root.js';

/**
 * @param {string} cwd - the current working directory
 * @returns {string} absolute path to the wallet env file
 */
export const resolveWalletEnvPath = (cwd) => {
  if (process.env.NEUMA_WALLET_ENV) return process.env.NEUMA_WALLET_ENV;
  return resolvePath(findProjectRoot(cwd), '.env');
};
