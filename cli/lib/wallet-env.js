// Resolve the operator's explicitly configured wallet env. A working project
// is untrusted input: its .env is never an ambient identity source. An operator
// may still name that file explicitly when they really intend to use it.
// impure (env read)

import { resolve as resolvePath } from 'node:path';

/**
 * @param {string} cwd - base for an explicitly relative override
 * @returns {string} absolute path to the wallet env file
 */
export const resolveWalletEnvPath = (cwd) => {
  const configured = process.env.NEUMA_WALLET_ENV?.trim();
  if (configured) return resolvePath(cwd, configured);
  throw new Error('NEUMA_WALLET_ENV must name the operator wallet env file; the CLI never reads a working project\'s .env by default');
};
