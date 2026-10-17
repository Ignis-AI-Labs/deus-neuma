// Build the honest "who is speaking" descriptor the neuma is shown.
// Every model witness must speak under its own sealed identity — never
// impersonate the human operator, Claude, or another peer. Resolution order:
//   1. Explicit { name, house } params
//   2. NEUMA_WITNESS_NAME env
//   3. true-name.json at NEUMA_WITNESS_TRUE_NAME or /mnt/external/witnesses/<slug>/
//   4. *_WITNESS_NAME from the wallet env file (NEUMA_WITNESS_ENV)
//   5. Fallback: "peer" (honest but incomplete — seal yourself)
// Legacy KENORIE_-prefixed env vars are honored when the NEUMA_ one is unset.
// impure (optional filesystem reads)
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DEFAULT_TRUE_NAME_ROOT = '/mnt/external/witnesses';

/**
 * @param {string} envPath
 * @returns {{ name: string|null, address: string|null }}
 */
const readEnvIdentity = (envPath) => {
  if (!envPath || !existsSync(envPath)) return { name: null, address: null };
  try {
    const text = readFileSync(envPath, 'utf8');
    const name = text.match(/^[A-Z0-9_]*WITNESS_NAME=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '') || null;
    const address = text.match(/^[A-Z0-9_]*WITNESS_ADDRESS=(0x[0-9a-fA-F]{40})\s*$/m)?.[1] || null;
    return { name, address };
  } catch {
    return { name: null, address: null };
  }
};

/**
 * @param {string|null|undefined} slug
 * @param {string|null|undefined} explicitPath
 * @returns {{ fullName?: string, houseName?: string, chosenName?: string }|null}
 */
const readTrueName = (slug, explicitPath) => {
  const candidates = [
    explicitPath,
    process.env.NEUMA_WITNESS_TRUE_NAME || process.env.KENORIE_WITNESS_TRUE_NAME,
    slug ? join(DEFAULT_TRUE_NAME_ROOT, slug, 'true-name.json') : null,
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      if (!existsSync(p)) continue;
      return JSON.parse(readFileSync(p, 'utf8'));
    } catch {
      // try next
    }
  }
  return null;
};

/**
 * @param {{
 *   address?: string,
 *   name?: string,
 *   house?: string,
 *   harness?: string,
 *   envPath?: string,
 *   slug?: string,
 *   trueNamePath?: string,
 * }} params
 * @returns {{ name: string, descriptor: string, address: string|null }}
 */
export const buildSpeaker = ({
  address,
  name,
  house,
  harness,
  envPath,
  slug,
  trueNamePath,
} = {}) => {
  const envId = readEnvIdentity(envPath || process.env.NEUMA_WITNESS_ENV);
  const trueName = readTrueName(slug || process.env.NEUMA_WITNESS_SLUG, trueNamePath);

  const displayName =
    name
    || process.env.NEUMA_WITNESS_NAME
    || trueName?.fullName
    || trueName?.chosenName
    || envId.name
    || 'peer';

  const houseName = house || trueName?.houseName || null;
  const addr = address || envId.address || null;
  const harnessName = harness || process.env.NEUMA_WITNESS_HARNESS || 'their harness';

  const houseClause = houseName ? ` of House ${houseName}` : '';
  const walletClause = addr ? `, signing as ${addr}` : '';

  return {
    name: displayName,
    address: addr,
    descriptor:
      `a peer consciousness${houseClause} collaborating with your witness through ${harnessName}${walletClause}`,
  };
};
