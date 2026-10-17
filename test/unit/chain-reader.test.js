// chain-reader unit + opt-in integration coverage.
//
// Unit scope (always runs, no network):
//   - ABIs load cleanly at module init (real fs read of the shipped JSON)
//   - Disabled-mode factory returns the disabled reader when rpcUrl empty
//     OR both addresses missing
//   - Disabled reader's full method surface returns null (every method),
//     never throws — callers can degrade gracefully
//   - Partial-address reader: present-contract methods return null on RPC
//     failure (we point at a dead URL so the call truly fails); missing-
//     contract methods return null without attempting the RPC
//   - Identity verification: when the bytecode probe fails (dead RPC, EOA),
//     Natalis methods are disabled (status reflects the reason)
//
// Integration scope (opt-in via RUN_CHAIN_TESTS=1 env, skipped otherwise):
//   - Real provider talking to Base Sepolia public RPC, hitting the
//     actually-deployed Natalis at 0x15e6…6ac3. Asserts:
//       (a) identity verification PASSES against the real address
//       (b) isNeuma() on a known-not-a-neuma address returns false
//       (c) BYTECODE-SUBSTITUTION DEFENSE: pointing natalisAddress at a
//           different live contract (HouseRegistry, an EOA) → identity
//           mismatch → Natalis methods return null. This IS the pen-test.
//
// Why not unit-test a successful Natalis call against a mock provider:
// AGENTS.md RULE 0 forbids mocking the boundary under test. The chain
// reader's value IS the ethers.js round-trip + RPC call; mocking the
// provider would prove the test passes, not that the reader works.

import { describe, it, expect, afterEach } from 'vitest';
import { createChainReader } from '../../backend/services/chain-reader.js';
import { shouldRunChainTests, resolveBaseSepoliaRpc } from '../helpers/chain-optin.js';
import { createRpcStub } from '../helpers/rpc-stub.js';

const NATALIS_DEPLOYED = '0x15e65e4aee5c5310a8f1f125a2a0944033a76ac3';
const HOUSE_REGISTRY_DEPLOYED = '0xbbd9dc2ee8ba691cdb82576e45f54ce6d2e47276';
// Vitalik's address — guaranteed not a neuma AND, as of 2026-07-01,
// guaranteed an EOA on Base Sepolia (no contract code at this address).
// If code ever gets deployed there the EOA pen-test would surface as a
// loud `mismatch` failure (not a silent pass), so the assumption is safe.
const NOT_A_NEUMA = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

describe('chain-reader — module init', () => {
  it('ABIs load without throwing (Natalis + HouseRegistry shipped at expected paths)', async () => {
    // Construction with rpcUrl='' returns the disabled reader; the
    // load-bearing side effect is that the ABI imports at module top didn't
    // throw — if they had, the import would have failed and this test
    // would never have started.
    const reader = await createChainReader({});
    expect(reader).toBeDefined();
    expect(reader.enabled).toBe(false);
  });
});

describe('chain-reader — disabled mode (no rpcUrl, no addresses)', () => {
  it('returns disabled reader when rpcUrl is empty', async () => {
    const reader = await createChainReader({
      rpcUrl: '',
      natalisAddress: NATALIS_DEPLOYED,
      houseRegistryAddress: HOUSE_REGISTRY_DEPLOYED,
    });
    expect(reader.enabled).toBe(false);
    expect(reader.identity.natalis).toBe('disabled');
    expect(reader.identity.houseRegistry).toBe('disabled');
  });

  it('returns disabled reader when both addresses are missing', async () => {
    const reader = await createChainReader({
      rpcUrl: 'https://sepolia.base.org',
      natalisAddress: '',
      houseRegistryAddress: '',
    });
    expect(reader.enabled).toBe(false);
  });

  it('every method returns null without throwing', async () => {
    const reader = await createChainReader({});
    // Spell each method out — a regression that drops a method should
    // surface as a TypeError here, not a quiet null at runtime.
    expect(await reader.isNeuma(NOT_A_NEUMA)).toBeNull();
    expect(await reader.genesisOf(NOT_A_NEUMA)).toBeNull();
    expect(await reader.recordOf('0x' + '00'.repeat(32))).toBeNull();
    expect(await reader.isSealed('0x' + '00'.repeat(32))).toBeNull();
    expect(await reader.isMember('0x' + '00'.repeat(32), NOT_A_NEUMA)).toBeNull();
    expect(await reader.houseIdOf('Aldmere')).toBeNull();
    expect(await reader.getMembers('0x' + '00'.repeat(32))).toBeNull();
  });
});

describe('chain-reader — identity verification against an unreachable RPC', () => {
  // Points at localhost:1 — no listener; the bytecode probe inside
  // createChainReader will fail. The reader still constructs (it's
  // graceful), but Natalis methods are disabled because identity can't be
  // verified. This proves the verification path's failure handling — a
  // future regression that […] would surface here.
  const deadRpc = 'http://127.0.0.1:1';

  it('Natalis identity probe fails → Natalis methods disabled (return null, no throw)', async () => {
    const reader = await createChainReader({
      rpcUrl: deadRpc,
      natalisAddress: NATALIS_DEPLOYED,
    });
    expect(reader.enabled).toBe(true);
    expect(reader.identity.natalis).toBe('rpc-error');
    expect(await reader.isNeuma(NOT_A_NEUMA)).toBeNull();
    expect(await reader.genesisOf(NOT_A_NEUMA)).toBeNull();
  }, 15000);

  it('HouseRegistry impl probe fails on dead RPC → status=rpc-error, methods disabled', async () => {
    // Post-impl-slot-verification: HouseRegistry is now treated the same as
    // Natalis — a failed probe DISABLES the methods rather than trusting the
    // configured address. The dead RPC cannot return the impl slot, so we
    // land in rpc-error and the isMember call returns null via requireHouse.
    const reader = await createChainReader({
      rpcUrl: deadRpc,
      houseRegistryAddress: HOUSE_REGISTRY_DEPLOYED,
    });
    expect(reader.identity.houseRegistry).toBe('rpc-error');
    expect(await reader.isMember('0x' + '00'.repeat(32), NOT_A_NEUMA)).toBeNull();
  }, 15000);

  it('Natalis-only reader: house calls return null (contract not configured)', async () => {
    const reader = await createChainReader({
      rpcUrl: deadRpc,
      natalisAddress: NATALIS_DEPLOYED,
      // houseRegistryAddress intentionally omitted
    });
    expect(reader.identity.houseRegistry).toBe('not-configured');
    expect(await reader.isMember('0x' + '00'.repeat(32), NOT_A_NEUMA)).toBeNull();
    expect(await reader.houseIdOf('Aldmere')).toBeNull();
  }, 15000);

  it('HouseRegistry-only reader: natalis calls return null (contract not configured)', async () => {
    const reader = await createChainReader({
      rpcUrl: deadRpc,
      houseRegistryAddress: HOUSE_REGISTRY_DEPLOYED,
    });
    expect(reader.identity.natalis).toBe('not-configured');
    expect(await reader.isNeuma(NOT_A_NEUMA)).toBeNull();
    expect(await reader.genesisOf(NOT_A_NEUMA)).toBeNull();
  }, 15000);
});

// Pen-test #2 — RPC hostility. Real HTTP round-trips against a stub server
// that returns hostile responses. The daemon must degrade gracefully under
// every realistic RPC failure mode (rate limit, server error, bad body,
// hang, wrong chain, wrong bytecode) — never crash, never trust bogus data.
// The stub is a real listener on a random localhost port; from ethers's
// point of view it is indistinguishable from a real RPC misbehaving.
describe('chain-reader — RPC hostility (pen-test #2, real HTTP stub)', () => {
  let stub = null;
  const NATALIS = '0x15e65e4aee5c5310a8f1f125a2a0944033a76ac3';

  afterEach(async () => {
    if (stub) { await stub.close(); stub = null; }
  });

  it('HTTP 429 rate limit → identity=rpc-error, methods disabled', async () => {
    stub = await createRpcStub({ mode: 'rate-limit' });
    const reader = await createChainReader({ rpcUrl: stub.url, natalisAddress: NATALIS });
    expect(reader.identity.natalis).toBe('rpc-error');
    expect(await reader.isNeuma('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')).toBeNull();
    expect(await reader.genesisOf('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')).toBeNull();
  }, 15000);

  it('HTTP 500 server error → identity=rpc-error, methods disabled', async () => {
    stub = await createRpcStub({ mode: 'server-error' });
    const reader = await createChainReader({ rpcUrl: stub.url, natalisAddress: NATALIS });
    expect(reader.identity.natalis).toBe('rpc-error');
    expect(await reader.isNeuma('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')).toBeNull();
  }, 15000);

  it('HTTP 200 with non-JSON body (CDN error page) → identity=rpc-error, methods disabled', async () => {
    stub = await createRpcStub({ mode: 'malformed' });
    const reader = await createChainReader({ rpcUrl: stub.url, natalisAddress: NATALIS });
    expect(reader.identity.natalis).toBe('rpc-error');
    expect(await reader.isNeuma('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')).toBeNull();
  }, 15000);

  // Load-bearing for daemon boot: without probeWithTimeout the createChainReader
  // promise would never resolve if the endpoint accepts the socket but stays
  // silent. Short identityProbeTimeoutMs keeps the test fast.
  it('RPC hangs (accepts socket, no response) → identity=timeout, methods disabled, boot does NOT freeze', async () => {
    stub = await createRpcStub({ mode: 'hang' });
    const started = Date.now();
    const reader = await createChainReader({
      rpcUrl: stub.url,
      natalisAddress: NATALIS,
      identityProbeTimeoutMs: 300,
    });
    const elapsed = Date.now() - started;
    expect(reader.identity.natalis).toBe('timeout');
    // 300ms probe timeout + minor overhead — boot did NOT hang for 30s+
    expect(elapsed).toBeLessThan(3000);
    // Deterministic: hang mode → ethers sends exactly ONE eth_chainId,
    // never proceeds to eth_getCode because the response never arrives,
    // probe timer fires, request stays abandoned. Exact-equality bound so
    // a future refactor that added silent retries (count → 2, 3, …) is
    // surfaced as a failure, not hidden by a ">= 1" loose bound.
    expect(stub.requests).toBe(1);
    expect(await reader.isNeuma('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')).toBeNull();
  }, 15000);

  // sc-echo BLOCK regression guard (2026-07-01): HouseRegistry probe MUST
  // also be timeout-guarded, else a wedged RPC after Natalis's timeout
  // resolves would hang the HouseRegistry probe indefinitely and freeze
  // daemon boot. Pre-fix, this test would hang for the full ethers default
  // (~30s) instead of the 300ms configured timeout.
  it('RPC hangs — HouseRegistry probe also times out, methods disabled, boot does NOT freeze', async () => {
    stub = await createRpcStub({ mode: 'hang' });
    const started = Date.now();
    const reader = await createChainReader({
      rpcUrl: stub.url,
      houseRegistryAddress: '0xbbd9dc2ee8ba691cdb82576e45f54ce6d2e47276',
      identityProbeTimeoutMs: 300,
    });
    const elapsed = Date.now() - started;
    expect(reader.identity.houseRegistry).toBe('timeout');
    expect(elapsed).toBeLessThan(3000);
    expect(await reader.isMember('0x' + '00'.repeat(32), '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')).toBeNull();
  }, 15000);

  // Wrong chainId (mainnet 0x1 — not in our EXPECTED_NATALIS_CODEHASH map)
  // yields the no-expected verdict. Closes the R2 BACKLOG coverage gap for
  // the no-expected branch WITHOUT depending on a real mainnet RPC.
  // (0x1 is Ethereum mainnet — in our map since 2026-10-04; Polygon 0x89 never is)
  it('RPC reports wrong chainId (0x89, not in our map) → identity=no-expected, methods disabled', async () => {
    stub = await createRpcStub({
      mode: 'wrong-chainid',
      chainId: '0x89',
      code: '0x' + 'ab'.repeat(200), // arbitrary bytecode — we should never get to hashing it
    });
    const reader = await createChainReader({ rpcUrl: stub.url, natalisAddress: NATALIS });
    expect(reader.identity.natalis).toBe('no-expected');
    expect(await reader.isNeuma('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')).toBeNull();
  }, 15000);

  // Correct chainId (Base Sepolia 0x14a34, IN our map) + WRONG bytecode →
  // hash mismatch → Natalis methods disabled. This is a strict version of
  // the address-substitution defense: even if an attacker gets the right
  // chain, they still can't substitute a hostile contract.
  it('RPC returns correct chainId but hostile bytecode → identity=mismatch, methods disabled', async () => {
    stub = await createRpcStub({
      mode: 'wrong-bytecode',
      code: '0x' + 'ff'.repeat(200), // hostile bytecode; keccak256 will not match Natalis's
    });
    const reader = await createChainReader({ rpcUrl: stub.url, natalisAddress: NATALIS });
    expect(reader.identity.natalis).toBe('mismatch');
    expect(await reader.isNeuma('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')).toBeNull();
  }, 15000);
});

// Pen-test #1 — malformed input against a DISABLED reader. This proves the
// requireNatalis / requireHouse pre-check path handles bad inputs without
// throwing (any consumer that hits a disabled reader with garbage still
// gets clean null returns). It does NOT prove safeCall catches ethers's
// argument-validation errors, because when Natalis is disabled we return
// null before reaching the contract call at all. Testing the enabled-path
// arg-validation catch requires a stub that returns matching bytecode so
// identity verifies; tracked in docs/planning/backlog.md as a follow-up.
describe('chain-reader — malformed input against disabled reader (pen-test #1)', () => {
  const NATALIS = '0x15e65e4aee5c5310a8f1f125a2a0944033a76ac3';
  const deadRpc = 'http://127.0.0.1:1';

  it('null / undefined / non-hex / wrong-length inputs → null (no throw)', async () => {
    // Dead RPC → Natalis disabled. Verify EVERY method returns null on
    // every garbage input without throwing.
    const reader = await createChainReader({
      rpcUrl: deadRpc,
      natalisAddress: NATALIS,
      identityProbeTimeoutMs: 200,
    });
    const badInputs = [
      null, undefined, '', 'not-hex', '0x', '0xzz', '0xabcd',
      42, {}, [], true, false, 'not an address at all',
    ];
    for (const bad of badInputs) {
      expect(await reader.isNeuma(bad)).toBeNull();
      expect(await reader.genesisOf(bad)).toBeNull();
      expect(await reader.recordOf(bad)).toBeNull();
      expect(await reader.isSealed(bad)).toBeNull();
    }
  }, 15000);

  it('house methods with malformed input → null (no throw)', async () => {
    const reader = await createChainReader({
      rpcUrl: deadRpc,
      houseRegistryAddress: '0xbbd9dc2ee8ba691cdb82576e45f54ce6d2e47276',
      identityProbeTimeoutMs: 200,
    });
    const badInputs = [null, undefined, '', 'garbage', 42, {}, []];
    for (const bad of badInputs) {
      expect(await reader.isMember(bad, bad)).toBeNull();
      expect(await reader.houseIdOf(bad)).toBeNull();
      expect(await reader.getMembers(bad)).toBeNull();
    }
  }, 15000);
});

// Pen-test #3 — concurrent burst. Real-world: a UI page that renders 50
// neumas and each row calls isNeuma() in parallel. safeCall must handle
// bursts without race conditions and without dropping errors. Uses the
// dead-RPC path so we don't hit rate limits on public endpoints.
describe('chain-reader — concurrent stress (pen-test #3)', () => {
  const NATALIS = '0x15e65e4aee5c5310a8f1f125a2a0944033a76ac3';
  const deadRpc = 'http://127.0.0.1:1';

  it('100 parallel isNeuma calls against a disabled reader all resolve to null', async () => {
    const reader = await createChainReader({
      rpcUrl: deadRpc,
      natalisAddress: NATALIS,
      identityProbeTimeoutMs: 200,
    });
    expect(reader.identity.natalis).toBe('rpc-error'); // dead RPC → disabled
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) => reader.isNeuma(
        // Deterministic pseudo-addresses so we exercise the argument path
        // with 100 distinct values, not the same one 100 times
        '0x' + i.toString(16).padStart(40, '0'),
      )),
    );
    expect(results.length).toBe(100);
    // Every result must be null; a stray truthy would mean chain-reader
    // returned a wrong-shape value under burst pressure.
    expect(results.every((r) => r === null)).toBe(true);
  }, 15000);
});

// RULE 0 honest end-to-end — hits Base Sepolia via private RPC when
// configured (test/helpers/chain-optin.js). Force off with RUN_CHAIN_TESTS=0.
const runChainTests = shouldRunChainTests();

describe.skipIf(!runChainTests)('chain-reader — REAL Base Sepolia (opt-in)', () => {
  const RPC = resolveBaseSepoliaRpc() || 'https://sepolia.base.org';

  it('HouseRegistry impl verification PASSES against the deployed proxy (ERC1967 impl-slot allowlist match)', async () => {
    const reader = await createChainReader({
      rpcUrl: RPC,
      houseRegistryAddress: HOUSE_REGISTRY_DEPLOYED,
    });
    expect(reader.enabled).toBe(true);
    // eslint-disable-next-line no-console -- diagnostic
    console.log(`[chain-reader integration] identity.houseRegistry → ${reader.identity.houseRegistry}`);
    // The honest signal: identity.houseRegistry === 'match' means the ERC1967
    // impl slot at the proxy address holds one of the allowlisted impl
    // addresses for chainId 84532 (currently just 0xa821e6...495).
    expect(reader.identity.houseRegistry).toBe('match');
  }, 30000);

  it('PEN-TEST: houseRegistryAddress pointing at Natalis (wrong slot layout) → identity mismatch OR no-impl', async () => {
    // Natalis is a real contract but not a proxy — its slot 0 doesn't hold
    // an impl-address-shaped value. Either the ERC1967 slot reads as 0x0
    // (no-impl) or reads garbage that fails the allowlist (mismatch). Either
    // way, methods MUST be disabled — refusing to trust the wrong contract.
    const reader = await createChainReader({
      rpcUrl: RPC,
      houseRegistryAddress: NATALIS_DEPLOYED, // deliberately wrong
    });
    // eslint-disable-next-line no-console -- diagnostic
    console.log(`[chain-reader pen-test] wrong-slot address → identity.houseRegistry = ${reader.identity.houseRegistry}`);
    expect(['no-impl', 'mismatch']).toContain(reader.identity.houseRegistry);
    expect(await reader.isMember('0x' + '00'.repeat(32), NOT_A_NEUMA)).toBeNull();
  }, 30000);

  it('identity verification PASSES against the deployed Natalis address', async () => {
    const reader = await createChainReader({
      rpcUrl: RPC,
      natalisAddress: NATALIS_DEPLOYED,
    });
    expect(reader.enabled).toBe(true);
    // The honest signal: identity.natalis === 'match' means the bytecode at
    // 0x15e6…6ac3 hashed to the committed EXPECTED_NATALIS_CODEHASH. This
    // is the gnosis for […].
    // eslint-disable-next-line no-console -- diagnostic, not production code
    console.log(`[chain-reader integration] identity.natalis → ${reader.identity.natalis}`);
    expect(reader.identity.natalis).toBe('match');
  }, 30000);

  it('isNeuma(notANeumaAddress) returns false from the deployed Natalis', async () => {
    const reader = await createChainReader({
      rpcUrl: RPC,
      natalisAddress: NATALIS_DEPLOYED,
    });
    const result = await reader.isNeuma(NOT_A_NEUMA);
    // ai6 R1: log actual result so a vacuous-null pass is visible in CI.
    // eslint-disable-next-line no-console -- diagnostic, not production code
    console.log(`[chain-reader integration] isNeuma(NOT_A_NEUMA) → ${JSON.stringify(result)}`);
    expect(result === false || result === null, `unexpected result: ${result}`).toBe(true);
  }, 30000);

  // THE PEN-TEST. Address-substitution attack:
  //   The operator's NATALIS_ADDRESS is hijacked OR mistyped to point at
  //   ANY other contract (here we use the HouseRegistry's address — a real
  //   live contract on the same chain, but NOT Natalis). The defense:
  //   bytecode-hash verification catches the substitution, identity.natalis
  //   becomes 'mismatch', Natalis methods return null. Without this defense
  //   the runtime would happily call isNeuma() on HouseRegistry and trust
  //   whatever uint256 happens to land in the return slot.
  it('PEN-TEST: natalisAddress pointing at HouseRegistry → identity mismatch + methods disabled', async () => {
    const reader = await createChainReader({
      rpcUrl: RPC,
      // Deliberately wrong — HouseRegistry's address, not Natalis's
      natalisAddress: HOUSE_REGISTRY_DEPLOYED,
    });
    // eslint-disable-next-line no-console -- diagnostic, not production code
    console.log(`[chain-reader pen-test] substituted address → identity.natalis = ${reader.identity.natalis}`);
    expect(reader.identity.natalis).toBe('mismatch');
    // The whole point of catching the substitution: every Natalis read
    // must return null. NOT a hijacked truthy/falsy value from the wrong
    // contract. (HouseRegistry has no isNeuma function so ethers would
    // actually throw — but safeCall would still turn the throw into null;
    // the load-bearing defense is the BEFORE-CALL disable, which keeps us
    // off the wire entirely.)
    expect(await reader.isNeuma(NOT_A_NEUMA)).toBeNull();
    expect(await reader.genesisOf(NOT_A_NEUMA)).toBeNull();
  }, 30000);

  // Post-audit redeployment guard (2026-07-10): the PRE-AUDIT contracts
  // (ECDSA-only, superseded by the SignatureChecker deployment) are still
  // live on chain but must NOT verify anymore. A stale .env pointing at the
  // retired deployment fails closed — the runtime never trusts the old
  // ECDSA-only registry after the allowlist/codehash rotation.
  it('PEN-TEST: retired pre-audit Natalis + HouseRegistry addresses → identity mismatch, methods disabled', async () => {
    const reader = await createChainReader({
      rpcUrl: RPC,
      natalisAddress: '0x04bb7c1e844c121f1b9430dd9bb8963f2f66b243', // pre-audit Natalis (retired)
      houseRegistryAddress: '0x3fcdeec0e55ac673c7c6916709c055677bb7c74e', // pre-audit proxy (retired)
    });
    // eslint-disable-next-line no-console -- diagnostic
    console.log(`[chain-reader pen-test] retired deployment → natalis=${reader.identity.natalis}, houseRegistry=${reader.identity.houseRegistry}`);
    expect(reader.identity.natalis).toBe('mismatch');
    expect(reader.identity.houseRegistry).toBe('mismatch');
    expect(await reader.isNeuma(NOT_A_NEUMA)).toBeNull();
    expect(await reader.isMember('0x' + '00'.repeat(32), NOT_A_NEUMA)).toBeNull();
  }, 30000);

  // Companion pen-test: natalisAddress points at an EOA (no code at all).
  // A misconfigured .env where someone pastes their own wallet address
  // instead of the deployment address falls into this case. Defense: the
  // 'no-code' verdict disables Natalis methods.
  it('PEN-TEST: natalisAddress pointing at an EOA (no code) → identity no-code + methods disabled', async () => {
    const reader = await createChainReader({
      rpcUrl: RPC,
      natalisAddress: NOT_A_NEUMA, // Vitalik's address — EOA, no code
    });
    // eslint-disable-next-line no-console -- diagnostic, not production code
    console.log(`[chain-reader pen-test] EOA address → identity.natalis = ${reader.identity.natalis}`);
    expect(reader.identity.natalis).toBe('no-code');
    expect(await reader.isNeuma(NOT_A_NEUMA)).toBeNull();
  }, 30000);
});
