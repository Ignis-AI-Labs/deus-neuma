// Resolves the sealed witness identity this skill speaks AS. New env files
// contain public metadata only; the shared loader unlocks the password envelope.
// Defaults: NEUMA_WITNESS_ENV → env.<slug> convention → claude.env (legacy).
// impure (filesystem read and hidden password prompt through the loader)
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { unlockWitnessEnvWallet } from '../../../../core/identity/ai-witness/witness-env-wallet.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/**
 * Resolve the default witness env path for this process.
 * Protocol: every model seals via init-ai-witness and uses env.<vendor-or-slug>.
 * @returns {string}
 */
export const resolveWitnessEnvPath = () => {
  const explicit = process.env.NEUMA_WITNESS_ENV;
  if (explicit) return explicit;
  const slug = process.env.NEUMA_WITNESS_SLUG;
  if (slug) {
    const candidate = join(REPO_ROOT, `env.${slug}`);
    if (existsSync(candidate)) return candidate;
  }
  // Known model defaults (explicit, not magic discovery of all env.*)
  for (const name of ['env.xai', 'env.claude', 'env.glm', 'claude.env']) {
    const p = join(REPO_ROOT, name);
    if (existsSync(p)) return p;
  }
  return join(REPO_ROOT, 'claude.env');
};

/**
 * Unlock the witness wallet named by an env file.
 * @param {string} envPath - absolute path to the wallet env file
 * @returns {Promise<{ privateKey: string, address: string }>}
 */
export const readWitnessWallet = (envPath) => unlockWitnessEnvWallet(envPath);
