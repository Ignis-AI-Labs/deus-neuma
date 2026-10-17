/**
 * Opt-in gate for live Base Sepolia integration tests.
 *
 * Default hermetic CI has no private RPC (public sepolia.base.org is often
 * 403 / rate-limited). Operator machines with BASE_SEPOLIA_RPC_URL pointing
 * at a private endpoint (Alchemy, Ignis self-hosted, etc.) auto-enable so
 * those tests are not silently parked.
 *
 * Explicit overrides:
 *   RUN_CHAIN_TESTS=1  — force on
 *   RUN_CHAIN_TESTS=0  — force off
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Read a single KEY=value from repo .env without importing dotenv (no side effects). */
const readDotenvValue = (key) => {
  try {
    const text = fs.readFileSync(path.join(REPO_ROOT, '.env'), 'utf8');
    const m = text.match(new RegExp(`^${key}=(.*)$`, 'm'));
    if (!m) return null;
    return m[1].trim().replace(/^["']|["']$/g, '');
  } catch {
    return null;
  }
};

/**
 * Resolve the Base Sepolia RPC URL for live chain tests.
 * Prefer process.env (session export); fall back to gitignored .env.
 */
export const resolveBaseSepoliaRpc = () => {
  const fromEnv = process.env.BASE_SEPOLIA_RPC_URL?.trim();
  if (fromEnv) return fromEnv;
  const fromFile = readDotenvValue('BASE_SEPOLIA_RPC_URL');
  if (fromFile) {
    // Make it visible to tests that already read process.env
    process.env.BASE_SEPOLIA_RPC_URL = fromFile;
    return fromFile;
  }
  return null;
};

/**
 * Resolve the Ethereum mainnet RPC URL for live chain tests.
 * Prefer process.env (session export); fall back to gitignored .env.
 */
export const resolveEthMainnetRpc = () => {
  const fromEnv = process.env.ETH_RPC_URL?.trim();
  if (fromEnv) return fromEnv;
  const fromFile = readDotenvValue('ETH_RPC_URL');
  if (fromFile) {
    // Make it visible to tests that already read process.env
    process.env.ETH_RPC_URL = fromFile;
    return fromFile;
  }
  return null;
};

/**
 * Resolve the Ethereum Sepolia RPC URL for the live v3-contract tests.
 * Prefer process.env (session export); fall back to gitignored .env.
 */
export const resolveEthSepoliaRpc = () => {
  const fromEnv = process.env.ETH_SEPOLIA_RPC_URL?.trim();
  if (fromEnv) return fromEnv;
  const fromFile = readDotenvValue('ETH_SEPOLIA_RPC_URL');
  if (fromFile) {
    process.env.ETH_SEPOLIA_RPC_URL = fromFile;
    return fromFile;
  }
  return null;
};

/** Public community endpoints that must not auto-enable (flake / 403). */
const isPublicOnlyRpc = (url) =>
  !url
  || /sepolia\.base\.org/i.test(url)
  || /base-sepolia\.publicnode\.com/i.test(url);

/**
 * @returns {boolean} whether live chain describe.skipIf blocks should run
 */
export const shouldRunChainTests = () => {
  if (process.env.RUN_CHAIN_TESTS === '0') return false;
  if (process.env.RUN_CHAIN_TESTS === '1') {
    resolveBaseSepoliaRpc(); // still hydrate URL for the suite
    return true;
  }
  const rpc = resolveBaseSepoliaRpc();
  return Boolean(rpc && !isPublicOnlyRpc(rpc));
};
