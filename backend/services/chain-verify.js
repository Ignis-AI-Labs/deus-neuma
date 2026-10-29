/**
 * chain-verify — contract identity verification for the chain reader:
 * the known-good Natalis codehash table, the ERC1967 impl-slot allowlist for
 * the HouseRegistry proxy, and the two probe verifiers built on them.
 *
 * Extracted VERBATIM from chain-reader.js (size-law breakdown, 2026-08-26);
 * the provenance comments and operator reproducers travel with their
 * constants. chain-reader.js imports the two verifiers; this module never
 * imports chain-reader.
 *
 * impure (RPC probes).
 */

import { ethers } from 'ethers';
import { redactRpcUrl } from './chain/chain-registry.js';

// The known-good keccak256 of the deployed Natalis bytecode on Base Sepolia
// at 0x15e65e4aee5c5310a8f1f125a2a0944033a76ac3 — the post-audit deployment
// (SignatureChecker: EOA + ERC-1271 smart-account signers). Captured
// 2026-07-10 via `provider.getCode(addr)` then `ethers.keccak256(code)`;
// cross-checked byte-identical against the committed artifact's
// deployedBytecode in docs/contracts/abis/base/Natalis.json. Natalis is
// IMMUTABLE — no constructor args after deploy, no proxy, no upgrade path
// — so this value is permanent for the lifetime of the deployment. If a
// future redeployment is required (post-mainnet audit, e.g.), the new hash
// gets a new entry here keyed on chainId. The pre-audit Natalis
// (0x04bb…b243, hash 0x2298…09c7) is deliberately NOT trusted anymore —
// a stale config pointing at it must fail closed, not silently use the
// ECDSA-only contract.
//
// Reproducer (any operator can verify):
//   node -e 'import("ethers").then(async ({ethers}) => {
//     const p = new ethers.JsonRpcProvider("https://sepolia.base.org");
//     const code = await p.getCode("0x15e65e4aee5c5310a8f1f125a2a0944033a76ac3");
//     console.log(ethers.keccak256(code));
//   })'
const EXPECTED_NATALIS_CODEHASH = Object.freeze({
  // chainId → expected keccak256(bytecode) of the Natalis at the deployed address
  84532: '0x4d2139f9e42cf5f1fc61bad6c585643840de98d3bb10bae31ca6922cee665afe', // Base Sepolia — 0x15e65e4a…
  // Base MAINNET — Natalis 0x88A7229AFeb4DeBa8C27Edad788Ac723697Dde78 (deployed 2026-07-10).
  // Identical hash to Sepolia because Natalis is immutable (same source + compiler
  // settings → same bytecode across chains); verified live via getCode on mainnet.
  // Reproducer (any operator can verify):
  //   node -e 'import("ethers").then(async ({ethers}) => {
  //     const p = new ethers.JsonRpcProvider("https://mainnet.base.org");
  //     const code = await p.getCode("0x88a7229afeb4deba8c27edad788ac723697dde78");
  //     console.log(ethers.keccak256(code));
  //   })'
  8453: '0x4d2139f9e42cf5f1fc61bad6c585643840de98d3bb10bae31ca6922cee665afe',
  // Ethereum SEPOLIA — the UNAVIS redeploy (v3 seal law, unavis-site PR #3) at
  // 0x15e65e4aee5c5310a8f1f125a2a0944033a76ac3 (same address as Base Sepolia,
  // different bytecode). Measured live via getCode 2026-09-29 and byte-identical
  // to the UNAVIS artifact's deployedBytecode (evm-contracts/unavis, reproduced there 2026-10-05; synced to docs/contracts/abis/Natalis.json).
  // Reproducer: the Base Sepolia one above against an Ethereum Sepolia RPC.
  11155111: '0xa9853b967b7c07231f231caa15ed21672a3b49ea9f9491c210dc125bac25ab8f',
  // Ethereum MAINNET — the same v3 artifact, so the same bytecode (Natalis has
  // no immutables: source + compiler settings alone fix it). Deployed at
  // 0xcda0b092c87637276972de0ea8b5005672775f11 and measured live via getCode
  // 2026-10-05: equal. Reproducer: the Base Sepolia one above against an Ethereum RPC.
  1: '0xa9853b967b7c07231f231caa15ed21672a3b49ea9f9491c210dc125bac25ab8f',
});

// The ERC1967 impl-slot address for the standard OpenZeppelin proxy pattern:
//   bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1)
// The HouseRegistry (deployed from UNAVIS, formerly KENORIE) uses this standard pattern (verified 2026-07-01 by
// inspecting the deployed proxy bytecode + reading the slot). The proxy
// bytecode itself contains this exact 32-byte literal followed by SLOAD,
// which is the smoking-gun for […]
const ERC1967_IMPL_SLOT =
  '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';

// The known-good IMPL address for the HouseRegistry proxy, per chain. Unlike
// Natalis (immutable — bytecode never changes), HouseRegistry is UUPS-
// upgradeable, so the impl address CAN change via `upgradeToAndCall` (owner-
// gated). Each upgrade appends a new entry; the reader trusts ANY address
// in the array (an allowlist). If the deployed impl matches none of them,
// HouseRegistry methods are disabled.
//
// When UNAVIS ships a new impl, the process is:
//   1. Deploy the new impl (foundry script)
//   2. Call proxy.upgradeToAndCall(newImpl, ...)
//   3. Append newImpl to the array below + commit + tag the chain-reader
//      release; operators pull to trust the new impl
//
// Reproducer (any operator can verify the current live impl):
//   node -e 'import("ethers").then(async ({ethers}) => {
//     const p = new ethers.JsonRpcProvider("https://sepolia.base.org");
//     const raw = await p.getStorage(
//       "0xbbd9dc2ee8ba691cdb82576e45f54ce6d2e47276",
//       "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
//     );
//     console.log("0x" + raw.slice(-40));
//   })'
const EXPECTED_HOUSE_REGISTRY_IMPLS = Object.freeze({
  // chainId → allowlist of trusted impl addresses (lowercase). Multiple entries
  // permitted so a fresh clone doesn't reject a legitimate historical impl
  // that upgraded to a newer one — chain history is the source of truth.
  //
  // The pre-audit v1 impl (0xd5fc…0bf1, behind the retired proxy
  // 0x3fcd…c74e) was REMOVED 2026-07-10: the audit deployment is a fresh
  // proxy + impl (SignatureChecker quorum with explicit claimed signers),
  // and a stale config pointing at the old registry must fail closed
  // rather than trust the superseded ECDSA-only contract.
  84532: Object.freeze([
    '0xa821e60908f95848f4dcf9b7fc8e76f33ea6b495', // post-audit impl, deployed with proxy 0xbbd9…7276 (verified live 2026-07-10)
  ]),
  // Base MAINNET impl, behind proxy 0x526c6a062db774997955816c03df49b60260b883.
  // Reproducer (any operator can verify the current live impl):
  //   node -e 'import("ethers").then(async ({ethers}) => {
  //     const p = new ethers.JsonRpcProvider("https://mainnet.base.org");
  //     const raw = await p.getStorage(
  //       "0x526c6a062db774997955816c03df49b60260b883",
  //       "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
  //     );
  //     console.log("0x" + raw.slice(-40));
  //   })'
  8453: Object.freeze([
    '0xc736319418f85e7dcbb7c76cf34a7cd6149abf4d', // deployed with proxy 0x526c…b883 (verified live via ERC1967 slot 2026-07-10)
  ]),
  // Ethereum SEPOLIA — the UNAVIS redeploy behind proxy 0xbbd9…7276 (same
  // proxy + impl addresses as Base Sepolia, a different chain). Read live
  // from the ERC1967 slot 2026-09-29.
  11155111: Object.freeze([
    '0xa821e60908f95848f4dcf9b7fc8e76f33ea6b495',
  ]),
  // Ethereum MAINNET — the UNAVIS v3 deploy behind proxy 0xf915…c4eb, owned by
  // the 3-of-4 Safe 0x00C5…2368. Read live from the ERC1967 slot 2026-10-05;
  // its code equals the Sepolia impl's once each one's own address is masked.
  1: Object.freeze([
    '0xadd32e0a8681df949221b7aa31b486223d4f738a',
  ]),
});

/**
 * Verify the contract at `address` is the Natalis we expect by comparing
 * its on-chain bytecode hash against the committed known-good hash for the
 * chain we're connected to.
 *
 * Returns one of:
 *   { ok: true,  reason: 'match',         codehash }
 *   { ok: false, reason: 'no-code',       codehash }   ← EOA or empty addr
 *   { ok: false, reason: 'mismatch',      codehash, expected }  ← wrong contract
 *   { ok: false, reason: 'no-expected',   chainId }    ← we don't know this chain
 *   { ok: false, reason: 'rpc-error',     error }      ← couldn't probe (bad JSON, 500, 429, etc.)
 *   { ok: false, reason: 'timeout',       timeoutMs }  ← RPC accepted socket but never answered
 *
 * impure (RPC).
 */
export const verifyNatalisIdentity = async (provider, address) => {
  let chainId, code;
  try {
    const network = await provider.getNetwork();
    chainId = Number(network.chainId);
    code = await provider.getCode(address);
  } catch (err) {
    return { ok: false, reason: 'rpc-error', error: redactRpcUrl(err.message) };
  }
  if (code === '0x' || code === '0x0') {
    return { ok: false, reason: 'no-code', codehash: null };
  }
  const expected = EXPECTED_NATALIS_CODEHASH[chainId];
  if (!expected) {
    return { ok: false, reason: 'no-expected', chainId };
  }
  const codehash = ethers.keccak256(code);
  if (codehash !== expected) {
    return { ok: false, reason: 'mismatch', codehash, expected };
  }
  return { ok: true, reason: 'match', codehash };
};

/**
 * Verify the HouseRegistry proxy points at a trusted impl. Reads the
 * ERC1967 impl slot on the proxy, compares against the allowlist for the
 * connected chain. Unlike Natalis (strict bytecode hash), HouseRegistry
 * uses an ADDRESS ALLOWLIST because the impl is upgradeable — legitimate
 * upgrades should not require a chain-reader flag day; they require a
 * committed release that appends the new impl to EXPECTED_HOUSE_REGISTRY_IMPLS.
 *
 * Returns one of:
 *   { ok: true,  reason: 'match',       impl }
 *   { ok: false, reason: 'no-code',     impl: null }         ← EOA or empty
 *   { ok: false, reason: 'no-impl',     impl: null }         ← slot is 0x0
 *   { ok: false, reason: 'mismatch',    impl, allowlist }    ← impl not trusted
 *   { ok: false, reason: 'no-expected', chainId }            ← chain unknown
 *   { ok: false, reason: 'rpc-error',   error }
 *
 * impure (RPC).
 */
export const verifyHouseRegistryImpl = async (provider, proxyAddress) => {
  let chainId, code, implRaw;
  try {
    const network = await provider.getNetwork();
    chainId = Number(network.chainId);
    code = await provider.getCode(proxyAddress);
    if (code === '0x' || code === '0x0') {
      return { ok: false, reason: 'no-code', impl: null };
    }
    implRaw = await provider.getStorage(proxyAddress, ERC1967_IMPL_SLOT);
  } catch (err) {
    return { ok: false, reason: 'rpc-error', error: redactRpcUrl(err.message) };
  }
  // implRaw is 32 bytes; the address occupies the last 20 (right-padded).
  const impl = ('0x' + implRaw.slice(-40)).toLowerCase();
  if (impl === '0x' + '00'.repeat(20)) {
    return { ok: false, reason: 'no-impl', impl: null };
  }
  const allowlist = EXPECTED_HOUSE_REGISTRY_IMPLS[chainId];
  if (!allowlist) {
    return { ok: false, reason: 'no-expected', chainId };
  }
  if (!allowlist.includes(impl)) {
    return { ok: false, reason: 'mismatch', impl, allowlist: [...allowlist] };
  }
  return { ok: true, reason: 'match', impl };
};
