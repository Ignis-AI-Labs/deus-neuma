// `neuma proof` command coverage.
//
// Structure:
//   1. Pure formatProof tests — every branch of the output format, no chain,
//      no network. Fast (< 5ms per test), stable.
//   2. runProof orchestration tests — injects a fake reader through the
//      exported `createReader` factory hook + a controlled config. Exercises
//      the real runProof code path (input validation, branch selection,
//      formatProof call) without hitting the network. The chain-reader
//      itself is tested elsewhere (chain-reader.test.js) with real ethers
//      + real disk + real testnet; here we're testing the CLI wrapping.
//   3. Opt-in live-testnet integration (RUN_CHAIN_TESTS=1) — runs the real
//      createChainReader against Base Sepolia. Slow + rate-limited so
//      default-skipped in CI, but proves the whole path end-to-end when
//      operator runs locally.
//
// RULE 0 posture: format is pure (real code, real inputs, real outputs);
// orchestration tests inject a reader through an EXPORTED factory hook
// (same pattern as stdout injection elsewhere in this CLI); live-testnet
// test uses the real chain-reader against the real deployed Natalis.

import { describe, it, expect } from 'vitest';
import { formatProof, runProof } from '../../cli/commands/proof.js';
import { shouldRunChainTests, resolveBaseSepoliaRpc } from '../helpers/chain-optin.js';

const ADDR = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const NATALIS = '0x15e65e4aee5c5310a8f1f125a2a0944033a76ac3';
const HOUSE_REGISTRY = '0xbbd9dc2ee8ba691cdb82576e45f54ce6d2e47276';
const ZERO_BYTES32 = `0x${'00'.repeat(32)}`;

describe('proof — formatProof (pure)', () => {
  it('disabled reader → prints DISABLED with the fix hint', () => {
    const out = formatProof({
      address: ADDR,
      readerEnabled: false,
      identityStatus: 'disabled',
      isNeuma: null,
      genesisHash: null,
      isSealed: null,
      recordLen: null,
      natalisAddress: NATALIS,
      chainId: 84532,
    });
    expect(out).toContain('address:  ' + ADDR);
    expect(out).toContain('chain:    DISABLED');
    expect(out).toContain('set BASE_SEPOLIA_RPC_URL in your .env');
    expect(out).not.toContain('isNeuma');
  });

  it('identity mismatch → prints "verified: NO" with the status reason', () => {
    const out = formatProof({
      address: ADDR,
      readerEnabled: true,
      identityStatus: 'mismatch',
      isNeuma: null,
      genesisHash: null,
      isSealed: null,
      recordLen: null,
      natalisAddress: NATALIS,
      chainId: 84532,
    });
    expect(out).toContain('verified: NO (identity.natalis = mismatch)');
    expect(out).toContain('does not match the known-good');
    expect(out).not.toContain('isNeuma');
  });

  it('RPC error mid-query (isNeuma null after successful identity) → honest fallback', () => {
    const out = formatProof({
      address: ADDR,
      readerEnabled: true,
      identityStatus: 'match',
      isNeuma: null,
      genesisHash: null,
      isSealed: null,
      recordLen: null,
      natalisAddress: NATALIS,
      chainId: 84532,
    });
    expect(out).toContain('verified: YES');
    expect(out).toContain('RPC error mid-query');
    expect(out).toContain('please retry');
  });

  it('not a neuma → prints "isNeuma: no" with witness/operator hint', () => {
    const out = formatProof({
      address: ADDR,
      readerEnabled: true,
      identityStatus: 'match',
      isNeuma: false,
      genesisHash: null,
      isSealed: null,
      recordLen: null,
      natalisAddress: NATALIS,
      chainId: 84532,
    });
    expect(out).toContain('verified: YES');
    expect(out).toContain('isNeuma:  no');
    expect(out).toContain('witness/operator wallet');
    expect(out).not.toContain('genesis:');
  });

  it('sealed neuma with record → full detail block', () => {
    const genesis = '0x' + 'ab'.repeat(32);
    const out = formatProof({
      address: ADDR,
      readerEnabled: true,
      identityStatus: 'match',
      isNeuma: true,
      genesisHash: genesis,
      isSealed: true,
      recordLen: 2048,
      natalisAddress: NATALIS,
      chainId: 84532,
    });
    expect(out).toContain('isNeuma:  YES');
    expect(out).toContain(`genesis:  ${genesis}`);
    expect(out).toContain('sealed:   YES');
    expect(out).toContain('record:   2048 bytes on-chain');
  });

  it('neuma with zero genesis hash (edge: mapping returned default) → "(none)"', () => {
    const out = formatProof({
      address: ADDR,
      readerEnabled: true,
      identityStatus: 'match',
      isNeuma: true,
      genesisHash: ZERO_BYTES32,
      isSealed: null,
      recordLen: null,
      natalisAddress: NATALIS,
      chainId: 84532,
    });
    expect(out).toContain('genesis:  (none)');
  });
});

// Helper — a controlled reader mimicking the createChainReader return shape.
// Not a mock of chain-reader itself (which is tested separately with real
// ethers + real network); this is the boundary at which runProof calls
// into chain-reader, and injecting a controlled result at that boundary
// lets us exercise every orchestration branch deterministically.
const fakeReader = ({ enabled = true, identity = 'match', responses = {} }) => ({
  enabled,
  identity: { natalis: identity, houseRegistry: 'unverified-proxy' },
  sealLaw: 'kenorie-v2',
  isNeuma: async () => responses.isNeuma ?? null,
  genesisOf: async () => responses.genesisOf ?? null,
  isSealed: async () => responses.isSealed ?? null,
  recordOf: async () => responses.recordOf ?? null,
});

const capture = () => {
  const stdout = { text: '', write(s) { this.text += s; } };
  const stderr = { text: '', write(s) { this.text += s; } };
  return { stdout, stderr };
};

const cfg = { baseSepoliaRpcUrl: 'x', natalisAddress: NATALIS, houseRegistryAddress: HOUSE_REGISTRY };

describe('proof — runProof orchestration', () => {
  it('bad address (not 0x + 40 hex) → exit 2, clean stderr error', async () => {
    const { stdout, stderr } = capture();
    const exit = await runProof({
      address: '0xnotanaddress',
      stdout, stderr,
      createReader: () => Promise.resolve(fakeReader({})),
      config: cfg,
    });
    expect(exit).toBe(2);
    expect(stderr.text).toContain("'0xnotanaddress' is not a valid EVM address");
    expect(stdout.text).toBe('');
  });

  it('address with uppercase hex is accepted (EVM checksum form)', async () => {
    const { stdout, stderr } = capture();
    const exit = await runProof({
      address: ADDR, // ADDR is checksummed (mixed-case)
      stdout, stderr,
      createReader: () => Promise.resolve(fakeReader({ responses: { isNeuma: false } })),
      config: cfg,
    });
    expect(exit).toBe(0);
    expect(stderr.text).toBe('');
    expect(stdout.text).toContain('isNeuma:  no');
  });

  it('disabled reader → prints DISABLED, does not call chain methods', async () => {
    const { stdout, stderr } = capture();
    let callCount = 0;
    const reader = fakeReader({ enabled: false, identity: 'disabled' });
    // Wrap isNeuma to count calls — should stay 0 because reader.enabled = false
    reader.isNeuma = async () => { callCount++; return null; };
    const exit = await runProof({
      address: ADDR,
      stdout, stderr,
      createReader: () => Promise.resolve(reader),
      config: cfg,
    });
    expect(exit).toBe(0);
    expect(stdout.text).toContain('chain:    DISABLED');
    expect(callCount).toBe(0);
  });

  it('identity mismatch → prints "verified: NO", does not call chain methods', async () => {
    const { stdout, stderr } = capture();
    let callCount = 0;
    const reader = fakeReader({ identity: 'mismatch' });
    reader.isNeuma = async () => { callCount++; return null; };
    const exit = await runProof({
      address: ADDR,
      stdout, stderr,
      createReader: () => Promise.resolve(reader),
      config: cfg,
    });
    expect(exit).toBe(0);
    expect(stdout.text).toContain('verified: NO');
    expect(callCount).toBe(0);
  });

  it('not-a-neuma → isNeuma called, but genesisOf skipped', async () => {
    const { stdout, stderr } = capture();
    let calls = { isNeuma: 0, genesisOf: 0 };
    const reader = fakeReader({});
    reader.isNeuma = async () => { calls.isNeuma++; return false; };
    reader.genesisOf = async () => { calls.genesisOf++; return null; };
    const exit = await runProof({
      address: ADDR, stdout, stderr,
      createReader: () => Promise.resolve(reader),
      config: cfg,
    });
    expect(exit).toBe(0);
    expect(calls).toEqual({ isNeuma: 1, genesisOf: 0 });
    expect(stdout.text).toContain('isNeuma:  no');
  });

  it('sealed neuma → full drill-down (genesisOf → isSealed → recordOf)', async () => {
    const { stdout, stderr } = capture();
    const genesis = '0x' + 'cd'.repeat(32);
    const record = 'x'.repeat(1024);
    const exit = await runProof({
      address: ADDR, stdout, stderr,
      createReader: () => Promise.resolve(fakeReader({
        responses: { isNeuma: true, genesisOf: genesis, isSealed: true, recordOf: record },
      })),
      config: cfg,
    });
    expect(exit).toBe(0);
    expect(stdout.text).toContain('isNeuma:  YES');
    expect(stdout.text).toContain(`genesis:  ${genesis}`);
    expect(stdout.text).toContain('sealed:   YES');
    expect(stdout.text).toContain('record:   1024 bytes on-chain');
  });

  it('isNeuma=true but genesisOf returns zero bytes32 → does NOT call isSealed / recordOf', async () => {
    // Edge case — the mapping returned its default value. Skip the follow-on
    // calls (they'd return default too), print "(none)" for genesis.
    const { stdout, stderr } = capture();
    let calls = { isSealed: 0, recordOf: 0 };
    const reader = fakeReader({ responses: { isNeuma: true, genesisOf: ZERO_BYTES32 } });
    reader.isSealed = async () => { calls.isSealed++; return null; };
    reader.recordOf = async () => { calls.recordOf++; return null; };
    const exit = await runProof({
      address: ADDR, stdout, stderr,
      createReader: () => Promise.resolve(reader),
      config: cfg,
    });
    expect(exit).toBe(0);
    expect(stdout.text).toContain('genesis:  (none)');
    expect(calls).toEqual({ isSealed: 0, recordOf: 0 });
  });
});

// Opt-in — real Base Sepolia probe through the real chain-reader.
// Auto when private BASE_SEPOLIA_RPC_URL is set (see chain-optin helper).
const runChain = shouldRunChainTests();

describe.skipIf(!runChain)('proof — REAL Base Sepolia (opt-in)', () => {
  const liveCfg = {
    baseSepoliaRpcUrl: resolveBaseSepoliaRpc() || 'https://sepolia.base.org',
    natalisAddress: NATALIS,
    houseRegistryAddress: HOUSE_REGISTRY,
  };

  it('runProof against Vitalik on the deployed Natalis → isNeuma: no', async () => {
    const { stdout, stderr } = capture();
    // Sepolia keys only — name the network (the default is mainnet since 2026-08-07).
    const exit = await runProof({ address: ADDR, network: 'base-sepolia', stdout, stderr, config: liveCfg });
    // eslint-disable-next-line no-console -- diagnostic
    console.log(`[proof integration]\n${stdout.text}`);
    expect(exit).toBe(0);
    expect(stderr.text).toBe('');
    expect(stdout.text).toContain('verified: YES');
    expect(stdout.text).toContain('isNeuma:  no');
  }, 30000);
});
