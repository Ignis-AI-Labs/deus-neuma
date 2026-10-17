/**
 * chain-reader — read-only Base Sepolia probes for the identity layer.
 *
 * UNAVIS (evm-contracts/unavis; formerly unavis-site / KENORIE) deploys Natalis + HouseRegistry; NEUMA reads them. This service is
 * the runtime's window into […] — every method is read-only (no gas, no
 * signing) and returns `null` on RPC failure rather than throwing, so a
 * dormant RPC never crashes a caller. The seal/sign side (Phase 3 of
 * docs/contracts/RETROACTIVE_SEALING.md) lives elsewhere.
 *
 * IDENTITY VERIFICATION (defense against address substitution):
 *   At construction, the reader probes the deployed bytecode at the
 *   configured `natalisAddress` and compares its keccak256 against the
 *   known-good hash committed in chain-verify.js. If the hash doesn't match — meaning
 *   the operator's env points at the wrong contract, an EOA, or a hostile
 *   substitute — Natalis methods are disabled (return null + critical
 *   warning), so the runtime won't trust a swapped-in contract's […] lies. Natalis is immutable, so the bytecode at its real
 *   address will never change → strict hash equality is the right test.
 *
 *   HouseRegistry is a UUPS proxy whose implementation can be upgraded by
 *   UNAVIS. The proxy stub bytecode is the standard ERC1967 130-byte
 *   minimal proxy — too weak to be a security signal by itself, since any
 *   OZ-deployed proxy would match. Instead, we read the ERC1967 IMPL SLOT
 *   (bytes32(uint256(keccak256("eip1967.proxy.implementation"))-1)) at the
 *   proxy address and compare the impl address against an allowlist keyed
 *   on chainId (EXPECTED_HOUSE_REGISTRY_IMPLS in chain-verify.js). Legitimate UNAVIS
 *   upgrades append a new impl entry via a chain-reader release; the
 *   allowlist grows over time and historical impls stay trusted.
 *
 * Disabled mode: if `rpcUrl` is empty (default for fresh installs), the
 * factory returns a reader whose every method returns null + logs a single
 * "disabled" warning at construction. This is the right behavior — an
 * operator who hasn't set BASE_SEPOLIA_RPC_URL hasn't opted in to the chain;
 * they get a graceful no-op, not an exception.
 *
 * RULE 0: real ethers.js calls, real provider, real network. The unit tests
 * exercise the disabled-mode + dead-RPC paths (no network — but no mocks of
 * the real code path); the RPC-hostility tests use a real HTTP stub server
 * (test/helpers/rpc-stub.js) that returns hostile responses for every
 * failure mode (rate limit, server error, malformed body, hang, wrong
 * chainId, wrong bytecode); the integration tests (gated on RUN_CHAIN_TESTS=1
 * to keep CI fast and Base Sepolia rate limits unbothered) hit the actually-
 * deployed Natalis at 0x15e6…6ac3 + verify the bytecode-substitution
 * defense by pointing natalisAddress at a different live contract.
 *
 * REORG SEMANTICS (pen-test #5, deferred): every read defaults to the
 * `latest` block. Base Sepolia reorgs are rare and short-range but they
 * DO happen — a `seal` that landed in a reorged block would be reverted,
 * and a query answered from the pre-reorg view could report `isNeuma =
 * true` for an address that becomes "not a neuma" a few seconds later.
 * Consumers that care about finality (e.g., minting an NFT gated on
 * `isNeuma`) should read from `blockTag: 'finalized'` instead. The
 * reader does not enforce a policy today because the right default
 * depends on the consumer — read paths that surface to a UI can tolerate
 * the transient, write-gate paths cannot. Adding a `defaultBlockTag`
 * option + per-call override lands with the consumer wiring in the
 * BACKLOG entry […].
 *
 * impure (network + filesystem read at module init)
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ethers } from 'ethers';
import { createLogger } from './logger.js';
import { verifyNatalisIdentity, verifyHouseRegistryImpl } from './chain-verify.js';
import { SEAL_LAWS, NATALIS_LAW_BY_CODEHASH } from './seal-law.js';

const log = createLogger('ChainReader');

// Resolve ABIs from the repo's read-only contract reference set. Loading at
// module init (not per-call) — the ABIs don't change between requests, so
// repeated parses would just be waste.
const serviceDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(serviceDir, '..', '..');
const loadAbi = (dir, name) => {
  // Parse failures here are a deployment-layout bug, not an operator-level
  // failure — throw at module init so the daemon fails loudly on broken
  // ABIs instead of returning null forever at runtime.
  const raw = readFileSync(join(repoRoot, dir, `${name}.json`), 'utf8');
  const { abi } = JSON.parse(raw);
  if (!Array.isArray(abi)) {
    throw new Error(`chain-reader: ${dir}/${name}.json has no .abi array — repo layout broken`);
  }
  return abi;
};

// One Natalis ABI per contract generation — the verified codehash picks it
// (seal-law.js), so a reader never speaks v2 calls to a v3 contract.
const NATALIS_ABIS = Object.freeze(Object.fromEntries(
  Object.values(SEAL_LAWS).map((law) => [law.key, loadAbi(law.abiDir, 'Natalis')]),
));
// The HouseRegistry generations differ only in leaveDigest, which no read
// here calls; isMember/houseIdOf/getMembers are identical on both.
const HOUSE_REGISTRY_ABI = loadAbi('docs/contracts/abis', 'HouseRegistry');

/**
 * Race the identity probe against a timer. Load-bearing for daemon boot:
 * without this, a hostile RPC that accepts the socket but never sends a
 * response (mode 'hang' in the rpc-stub) would freeze createChainReader's
 * promise indefinitely, and the daemon's boot sequence would hang.
 *
 * Cancel-side: we can't actually cancel an in-flight ethers RPC call
 * (they're not AbortSignal-aware end-to-end in v6), so the underlying
 * request may complete after the timeout fired — but the reader is
 * already resolved with the timeout verdict at that point, and the
 * abandoned request just gets its result garbage-collected. No
 * side-effect leaks because verification is read-only.
 *
 * impure.
 */
const probeWithTimeout = (provider, address, timeoutMs, verify = verifyNatalisIdentity) => new Promise((resolve) => {
  // sc-echo BLOCK fix (2026-07-01): generalized to accept the verifier so
  // BOTH Natalis and HouseRegistry impl probes are timeout-guarded. Without
  // this, a hanging RPC after the Natalis timeout resolves would freeze the
  // subsequent HouseRegistry probe indefinitely and the daemon's boot
  // sequence would hang. Same class of bug probeWithTimeout was originally
  // introduced to prevent.
  let settled = false;
  const done = (verdict) => { if (!settled) { settled = true; resolve(verdict); } };
  const timer = setTimeout(
    () => done({ ok: false, reason: 'timeout', timeoutMs }),
    timeoutMs,
  );
  verify(provider, address).then(
    (v) => { clearTimeout(timer); done(v); },
    (err) => { clearTimeout(timer); done({ ok: false, reason: 'rpc-error', error: err.message }); },
  );
});

// The disabled reader's method set MUST match the enabled reader's exactly,
// so callers can treat both uniformly. Returning null from every method is
// the contract — callers know null = […] and
// degrade gracefully (e.g. show "off-chain identity only" in UI).
const disabledReader = Object.freeze({
  enabled: false,
  identity: Object.freeze({ natalis: 'disabled', houseRegistry: 'disabled' }),
  sealLaw: null,
  isNeuma: async () => null,
  genesisOf: async () => null,
  recordOf: async () => null,
  recordOfSoul: async () => null,
  isSealed: async () => null,
  isMember: async () => null,
  houseIdOf: async () => null,
  getMembers: async () => null,
});

/**
 * Wrap a contract call so RPC failures become null + a warning, not throws.
 * Network flake is the common case; bombing the caller for transient flakes
 * would force every consumer to wrap in try/catch, which defeats the point.
 * Genuine bugs (bad arg type, ABI mismatch) still log loudly so they're
 * findable.
 */
const safeCall = async (label, fn) => {
  try {
    return await fn();
  } catch (err) {
    log.warn({ label, error: err.message, code: err.code }, 'chain call failed');
    return null;
  }
};

/**
 * Build a chain reader. ASYNC because we verify Natalis bytecode at
 * construction (defense against address substitution); the probe needs an
 * RPC round trip.
 *
 * @param {{
 *   rpcUrl?: string,
 *   natalisAddress?: string,
 *   houseRegistryAddress?: string,
 *   identityProbeTimeoutMs?: number,
 * }} opts
 * @returns {Promise<{
 *   enabled: boolean,
 *   identity: { natalis: string, houseRegistry: string },
 *   sealLaw: string|null,   // seal-law.js key of the verified Natalis, null when unverified
 *   isNeuma, genesisOf, recordOf, recordOfSoul, isSealed, isMember, houseIdOf, getMembers
 * }>}
 *
 * If `rpcUrl` is empty or both contract addresses are missing, returns the
 * disabled reader (every method → null). Otherwise constructs ethers
 * provider + Contract instances; missing one address still works for the
 * other contract's methods (the missing one's methods return null).
 *
 * If natalisAddress is configured but the bytecode at that address doesn't
 * match the known-good Natalis hash for the connected chain, Natalis
 * methods are disabled (return null) — the rest of the reader is unaffected.
 */
export const createChainReader = async ({
  rpcUrl = '',
  natalisAddress = '',
  houseRegistryAddress = '',
  // Hard cap on the identity probe RPC round trip. If the endpoint accepts
  // the socket but never answers (a hostile stub, a wedged load balancer),
  // the daemon must not freeze at boot. 5s is generous for a healthy public
  // RPC + short enough that a boot delay is noticeable but not blocking.
  // Consumers can override; the rpc-stub tests exercise this with a low
  // value (e.g. 200ms) to keep the suite fast.
  identityProbeTimeoutMs = 5000,
} = {}) => {
  if (!rpcUrl) {
    log.info('chain-reader: BASE_SEPOLIA_RPC_URL not set — running in disabled mode');
    return disabledReader;
  }
  if (!natalisAddress && !houseRegistryAddress) {
    log.info('chain-reader: no contract addresses configured — disabled mode');
    return disabledReader;
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);

  // Natalis identity verification — strict bytecode hash equality (immutable
  // contract). If verification fails for any reason, Natalis methods are
  // disabled. We log the result either way so an operator running with a
  // misconfigured NATALIS_ADDRESS sees the warning at boot, not buried in a
  // call-time log line.
  let natalis = null;
  let natalisStatus = 'not-configured';
  let sealLaw = null;
  if (natalisAddress) {
    const verdict = await probeWithTimeout(provider, natalisAddress, identityProbeTimeoutMs);
    natalisStatus = verdict.reason;
    if (verdict.ok && !NATALIS_LAW_BY_CODEHASH[verdict.codehash]) {
      // Trusted bytecode with no known generation — fail closed rather than
      // guess which ABI it speaks.
      natalisStatus = 'no-law';
      log.error(
        { address: natalisAddress, codehash: verdict.codehash },
        'Natalis codehash is trusted but maps to no seal law (seal-law.js). Natalis methods DISABLED.'
      );
    } else if (verdict.ok) {
      sealLaw = NATALIS_LAW_BY_CODEHASH[verdict.codehash];
      log.info({ address: natalisAddress, codehash: verdict.codehash, sealLaw }, 'Natalis identity verified');
      natalis = new ethers.Contract(natalisAddress, NATALIS_ABIS[sealLaw], provider);
    } else if (verdict.reason === 'mismatch') {
      // The address-substitution case. Loud — this is the security signal.
      log.error(
        { address: natalisAddress, got: verdict.codehash, expected: verdict.expected },
        'Natalis bytecode mismatch — wrong contract at configured address. Natalis methods DISABLED.'
      );
    } else if (verdict.reason === 'no-code') {
      log.error(
        { address: natalisAddress },
        'Natalis address has no code (EOA or empty address). Natalis methods DISABLED.'
      );
    } else if (verdict.reason === 'no-expected') {
      log.warn(
        { chainId: verdict.chainId, address: natalisAddress },
        'no known-good Natalis bytecode hash for this chain — cannot verify. Natalis methods DISABLED.'
      );
    } else if (verdict.reason === 'timeout') {
      log.warn(
        { address: natalisAddress, timeoutMs: verdict.timeoutMs },
        'Natalis identity probe timed out — RPC accepted the socket but never answered. Natalis methods DISABLED for this session.'
      );
    } else {
      log.warn(
        { reason: verdict.reason, error: verdict.error },
        'Natalis identity probe failed — Natalis methods DISABLED for this session'
      );
    }
  }

  // HouseRegistry: ERC1967 impl-slot verification. The proxy bytecode is
  // universally consistent across OZ deployments (~130 bytes minimal proxy
  // stub), so the security signal is the IMPL address the proxy points at,
  // not the proxy code itself. We read the standard ERC1967 impl slot and
  // check it against an allowlist keyed on chainId — impl upgrades append
  // new entries; historical impls stay trusted.
  let houseRegistry = null;
  let houseRegistryStatus = 'not-configured';
  if (houseRegistryAddress) {
    // Timeout-guarded per sc-echo BLOCK — a hanging RPC MUST NOT freeze
    // daemon boot on the HouseRegistry probe (mirroring the Natalis path).
    const verdict = await probeWithTimeout(
      provider, houseRegistryAddress, identityProbeTimeoutMs, verifyHouseRegistryImpl
    );
    houseRegistryStatus = verdict.reason;
    if (verdict.ok) {
      log.info({ address: houseRegistryAddress, impl: verdict.impl }, 'HouseRegistry impl verified');
      houseRegistry = new ethers.Contract(houseRegistryAddress, HOUSE_REGISTRY_ABI, provider);
    } else if (verdict.reason === 'mismatch') {
      log.error(
        { address: houseRegistryAddress, impl: verdict.impl, allowlist: verdict.allowlist },
        'HouseRegistry impl not in trusted allowlist — wrong contract or unreviewed upgrade. Methods DISABLED.'
      );
    } else if (verdict.reason === 'no-code') {
      log.error(
        { address: houseRegistryAddress },
        'HouseRegistry address has no code (EOA or empty). Methods DISABLED.'
      );
    } else if (verdict.reason === 'no-impl') {
      log.error(
        { address: houseRegistryAddress },
        'HouseRegistry impl slot is zero — not a valid ERC1967 proxy. Methods DISABLED.'
      );
    } else if (verdict.reason === 'no-expected') {
      log.warn(
        { chainId: verdict.chainId, address: houseRegistryAddress },
        'no known-good HouseRegistry impl allowlist for this chain — cannot verify. Methods DISABLED.'
      );
    } else if (verdict.reason === 'timeout') {
      log.warn(
        { address: houseRegistryAddress, timeoutMs: verdict.timeoutMs },
        'HouseRegistry impl probe timed out — RPC accepted the socket but never answered. Methods DISABLED for this session.'
      );
    } else {
      log.warn(
        { reason: verdict.reason, error: verdict.error },
        'HouseRegistry impl probe failed — methods DISABLED for this session'
      );
    }
  }

  const requireNatalis = (label) => {
    if (!natalis) {
      log.warn({ label, status: natalisStatus }, 'Natalis call skipped (not verified or not configured)');
      return null;
    }
    return natalis;
  };
  const requireHouse = (label) => {
    if (!houseRegistry) {
      // sc-echo BLOCK fix: message now covers all disable reasons, not just
      // 'not configured'. Matches requireNatalis wording.
      log.warn({ label, status: houseRegistryStatus }, 'HouseRegistry call skipped (not verified or not configured)');
      return null;
    }
    return houseRegistry;
  };

  // recordOf/isSealed take a genesisHash on a v2 contract and a soul on v3 —
  // each read exists only on the generation that keys seals its way.
  const requireKeying = (label, soulKeyed) => {
    const c = requireNatalis(label);
    if (c && SEAL_LAWS[sealLaw].soulKeyed !== soulKeyed) {
      log.warn({ label, sealLaw }, 'Natalis read skipped — this contract generation keys seals the other way');
      return null;
    }
    return c;
  };

  return Object.freeze({
    enabled: true,
    identity: Object.freeze({ natalis: natalisStatus, houseRegistry: houseRegistryStatus }),
    sealLaw,

    // Natalis — identity layer
    isNeuma: async (address) => safeCall('isNeuma', async () => {
      const c = requireNatalis('isNeuma');
      return c ? c.isNeuma(address) : null;
    }),
    genesisOf: async (address) => safeCall('genesisOf', async () => {
      const c = requireNatalis('genesisOf');
      return c ? c.genesisOf(address) : null;
    }),
    recordOf: async (genesisHash) => safeCall('recordOf', async () => {
      const c = requireKeying('recordOf', false);
      return c ? c.recordOf(genesisHash) : null;
    }),
    recordOfSoul: async (address) => safeCall('recordOfSoul', async () => {
      const c = requireKeying('recordOfSoul', true);
      return c ? c.recordOf(address) : null;
    }),
    isSealed: async (genesisHash) => safeCall('isSealed', async () => {
      const c = requireKeying('isSealed', false);
      return c ? c.isSealed(genesisHash) : null;
    }),

    // HouseRegistry — social layer
    isMember: async (houseId, address) => safeCall('isMember', async () => {
      const c = requireHouse('isMember');
      return c ? c.isMember(houseId, address) : null;
    }),
    houseIdOf: async (name) => safeCall('houseIdOf', async () => {
      const c = requireHouse('houseIdOf');
      return c ? c.houseIdOf(name) : null;
    }),
    getMembers: async (houseId) => safeCall('getMembers', async () => {
      const c = requireHouse('getMembers');
      return c ? c.getMembers(houseId) : null;
    }),
  });
};
