/**
 * chain-registry — the operator's own keyed RPC endpoints as the platform's
 * chains. Chain truth comes from THESE endpoints, never from explorer
 * middlemen whose 404 can mean "zero balance" or "wrong path".
 *
 * Four chains: Ethereum mainnet + Sepolia, Base mainnet + Sepolia. A chain is
 * CONFIGURED when its env URL is set; unconfigured and unknown keys degrade
 * to null + one log line, never a throw — the chain-reader disabled-mode
 * idiom, per chain instead of per daemon.
 *
 * WRONG-CHAIN DEFENSE: an endpoint is probed with eth_chainId at
 * construction and refused when its answer disagrees with the registry — a
 * pasted URL that points at the wrong network is a silent-wrong-answer
 * machine, and the one thing worse than no answer. The probe is raced
 * against a 10s clock so a wedged endpoint cannot freeze a caller. Verified
 * providers are cached (staticNetwork — the chainId question is asked once,
 * not once per call).
 *
 * The URL carries the operator's key, so it is never logged — only the
 * chain key names a failure.
 *
 * impure (network at provider construction; env read per call so a test or
 * a launch can repoint without a module reload).
 */

import { ethers } from 'ethers';
import { createLogger } from '../logger.js';
import { serviceValue } from '../stored-secrets.js';

const log = createLogger('ChainRegistry');

/** ethers errors can embed the endpoint URL — and the URL carries the key.
 *  Redact before any message crosses into a log line or a result. Pure. */
export const redactRpcUrl = (message) =>
  String(message || '').replace(/https?:\/\/[^\s"']+/g, '<rpc-url>');

const PROVIDER_PROBE_TIMEOUT_MS = 10_000;

// The address saved in Settings → API wins; the env name is the fallback (stored-secrets.js).
const entry = (key, label, chainId, envName) => Object.freeze({
  key,
  label,
  chainId,
  envName,
  rpcUrl: (env = process.env) => serviceValue(`rpc-${key}`, env),
});

export const CHAINS = Object.freeze([
  entry('ethereum', 'Ethereum mainnet', 1, 'ETH_RPC_URL'),
  entry('ethereum-sepolia', 'Ethereum Sepolia', 11155111, 'ETH_SEPOLIA_RPC_URL'),
  entry('base', 'Base mainnet', 8453, 'BASE_MAINNET_RPC_URL'),
  entry('base-sepolia', 'Base Sepolia', 84532, 'BASE_SEPOLIA_RPC_URL'),
]);

/** The registry row for a key, or undefined. Pure. */
export const chainEntry = (key) => CHAINS.find((c) => c.key === key);

/** Every chain with its configured state — the catalog and /chains payload. */
export const listChains = (env = process.env) =>
  CHAINS.map((c) => Object.freeze({
    key: c.key, label: c.label, chainId: c.chainId, configured: c.rpcUrl(env) !== '',
  }));

/** The chains whose RPC URL is actually set. */
export const configuredChains = (env = process.env) =>
  CHAINS.filter((c) => c.rpcUrl(env) !== '');

/** Is this key known AND its env URL set? */
export const isConfigured = (key, env = process.env) => {
  const c = chainEntry(key);
  return Boolean(c && c.rpcUrl(env) !== '');
};

// Verified providers, keyed by key+URL so an env repoint never rides a stale
// endpoint; `logged` arms the log-once guard per (kind, chain, URL).
const providers = new Map();
const logged = new Set();

const logOnce = (guard, level, msg, data) => {
  if (logged.has(guard)) return;
  logged.add(guard);
  log[level](data || {}, msg);
};

// The probe raced against the clock: an endpoint that accepts the socket but
// never answers must not hold the caller (the rpc-stub 'hang' mode is the
// proof shape). The abandoned request resolves into a destroyed provider —
// no side effect leaks, verification is read-only.
const probeNetwork = (url) => {
  const probe = new ethers.JsonRpcProvider(url);
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${PROVIDER_PROBE_TIMEOUT_MS}ms`)), PROVIDER_PROBE_TIMEOUT_MS);
  });
  return Promise.race([probe.getNetwork(), timeout])
    .finally(() => { clearTimeout(timer); probe.destroy(); });
};

/**
 * The verified provider for a chain, or null. impure (real RPC round trip).
 * Unknown key, unset env, dead endpoint, wrong chainId — all null + one log
 * line, never a throw. Failures are NOT cached: a transiently dead endpoint
 * gets a fresh probe next call.
 *
 * @param {string} key - a registry key ('ethereum', 'base', …)
 * @param {Record<string, string|undefined>} [env]
 * @returns {Promise<ethers.JsonRpcProvider|null>}
 */
export const providerFor = async (key, env = process.env) => {
  const c = chainEntry(key);
  if (!c) {
    logOnce(`unknown:${key}`, 'warn', `chain-registry: unknown chain "${key}" — one of ${CHAINS.map((x) => x.key).join(', ')}`);
    return null;
  }
  const url = c.rpcUrl(env);
  if (!url) {
    logOnce(`unconfigured:${key}`, 'info', `chain-registry: ${c.envName} not set — ${key} reads disabled`);
    return null;
  }
  const cacheKey = `${key}\n${url}`;
  const cached = providers.get(cacheKey);
  if (cached) return cached;

  let network;
  try {
    network = await probeNetwork(url);
  } catch (err) {
    logOnce(`rpc:${cacheKey}`, 'warn', `chain-registry: ${key} RPC probe failed — reads will refuse until it answers`, { error: redactRpcUrl(err.message) });
    return null;
  }
  if (Number(network.chainId) !== c.chainId) {
    // The wrong-chain refusal — loud, and the endpoint is never trusted.
    logOnce(`mismatch:${cacheKey}`, 'error',
      `chain-registry: ${key} endpoint reports chainId ${network.chainId}, expected ${c.chainId} — refusing to trust it`);
    return null;
  }
  const provider = new ethers.JsonRpcProvider(url, network, { staticNetwork: true });
  providers.set(cacheKey, provider);
  return provider;
};

/**
 * Drop every cached provider and re-arm the log-once guards. The test door:
 * suites repoint env per case and must not inherit a sibling's endpoint.
 */
export const resetChainProviders = () => {
  for (const provider of providers.values()) provider.destroy();
  providers.clear();
  logged.clear();
};
