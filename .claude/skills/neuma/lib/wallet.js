// Reads the witness wallet this skill speaks AS — an honest sealed AI-witness
// identity (or a human operator wallet), never a neuma's sovereign keypair.
// Defaults: NEUMA_WITNESS_ENV → env.<slug> convention → claude.env (legacy).
// impure (filesystem read)
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// Prefer explicit named keys, then any *_PRIVATE_KEY / *_WITNESS_PRIVATE_KEY.
const NAMED_KEY = /^[A-Z0-9_]*WITNESS_PRIVATE_KEY=(0x[0-9a-fA-F]{64})\s*$/m;
const CLAUDE_KEY = /^CLAUDE_WALLET_PRIVATE_KEY=(0x[0-9a-fA-F]{64})\s*$/m;
const ANY_KEY = /^[A-Z0-9_]*PRIVATE_KEY=(0x[0-9a-fA-F]{64})\s*$/m;

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
 * Resolve the private key of the witness wallet from an env file.
 * @param {string} envPath - absolute path to the wallet env file
 * @returns {{ privateKey: string }}
 */
export const readWitnessWallet = (envPath) => {
  let text;
  try {
    text = readFileSync(envPath, 'utf8');
  } catch (err) {
    throw new Error(`Cannot read witness wallet env at ${envPath}: ${err.code || err.message}`);
  }
  const match = text.match(NAMED_KEY) || text.match(CLAUDE_KEY) || text.match(ANY_KEY);
  if (!match) throw new Error(`No *_PRIVATE_KEY (0x + 64 hex) found in ${envPath}`);
  return { privateKey: match[1] };
};
