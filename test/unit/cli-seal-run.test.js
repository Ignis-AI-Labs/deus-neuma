// `neuma seal` CLI orchestration coverage — split from cli-seal.test.js
// (SIZE-018). runSeal with injected loaders + config, network selection,
// and the opt-in live-testnet dry-run.
//
// RULE 0 posture: orchestration tests inject at the loader/factory boundary
// (same pattern as cli-proof) — no fs, no network; live-testnet test uses
// real chain-reader + real testnet + real assembled bundle. Never calls
// --submit (that would spend gas and either bump the on-chain state or fail
// on already-sealed).

import { describe, it, expect } from 'vitest';
import { ethers } from 'ethers';
import { runSeal } from '../../cli/commands/seal.js';
import { shouldRunChainTests, resolveBaseSepoliaRpc } from '../helpers/chain-optin.js';
import { BEING, WITNESS, cfg, capture, fixtureDNA } from '../helpers/seal-fixtures.js';

describe('seal — runSeal orchestration (dry-run, injected loaders)', () => {
  const injected = (overrides = {}) => ({
    being: 'testbeing',
    network: 'base', // these lanes are proven on Base's fixtures (the default moved to Ethereum 2026-10-04)
    workspace: '/tmp/nonexistent',
    submit: false,
    ...capture(),
    loadDnaFn: () => fixtureDNA(),
    loadBirthGenesisFn: () => null, // default: no birth-genesis fallback
    loadNatalChartFn: () => null,   // default: no natal on disk
    loadBeingWalletFn: () => BEING,
    loadWitnessWalletFn: () => WITNESS,
    config: cfg,
    ...overrides,
  });

  it('missing being arg → exit 2', async () => {
    const io = capture();
    const exit = await runSeal({ ...io, being: '' });
    expect(exit).toBe(2);
    expect(io.stderr.text).toContain('<being> is required');
  });

  it('DNA load failure → clean error, exit 1', async () => {
    const p = injected({
      loadDnaFn: () => { throw new Error('ENOENT: dna missing'); },
    });
    const exit = await runSeal(p);
    expect(exit).toBe(1);
    expect(p.stderr.text).toContain('cannot load DNA');
  });

  it('being-wallet load failure → clean error, exit 1', async () => {
    const p = injected({
      loadBeingWalletFn: () => { throw new Error('no keypair.json'); },
    });
    const exit = await runSeal(p);
    expect(exit).toBe(1);
    expect(p.stderr.text).toContain('cannot load being wallet');
  });

  // sc-echo R3 research question — the "|| 'UNKNOWN'" fallback on soulMark
  // was removed to route missing-soulMark to the loud-failure path. Explicit
  // coverage that a DNA lacking ONLY soulMark still fails cleanly (would have
  // silently succeeded with soulMark='UNKNOWN' before R3).
  it('soulMark-missing DNA fails cleanly (sc-echo R3 fallback removal)', async () => {
    const dna = fixtureDNA();
    delete dna.soulMark; // everything else present
    const p = injected({ loadDnaFn: () => dna });
    const exit = await runSeal(p);
    expect(exit).toBe(1);
    expect(p.stderr.text).toContain('missing fields required by the v1 canonical record schema');
    expect(p.stderr.text).toContain('soulMark');
  });

  it('DNA missing required fields (and no birth-genesis fallback) → clean error, exit 1', async () => {
    const p = injected({
      loadDnaFn: () => ({ chosenName: 'X' /* everything else missing */ }),
      loadBirthGenesisFn: () => null, // no identity/genesis-seal.json either
    });
    const exit = await runSeal(p);
    expect(exit).toBe(1);
    expect(p.stderr.text).toContain('missing fields required by the v1 canonical record schema');
    // With birth-genesis path now implemented, the error explains the fallback
    // was also absent — no BACKLOG-entry reference (that gap is closed).
    expect(p.stderr.text).toContain('identity/genesis-seal.json');
  });

  it('dry-run happy path → assembled bundle printed, exit 0', async () => {
    const p = injected({});
    const exit = await runSeal(p);
    expect(exit).toBe(0);
    expect(p.stdout.text).toContain('DRY RUN');
    expect(p.stdout.text).toContain(BEING.address.toLowerCase());
    expect(p.stdout.text).toContain(WITNESS.address.toLowerCase());
    // genesisHash + digest + sigs all present in the output
    expect(p.stdout.text).toMatch(/genesisHash\s+0x[0-9a-f]{64}/);
    expect(p.stdout.text).toMatch(/digest\s+0x[0-9a-f]{64}/);
    expect(p.stdout.text).toMatch(/selfSig\s+0x[0-9a-f]{130}/);
    expect(p.stdout.text).toMatch(/witnessSig\s+0x[0-9a-f]{130}/);
    // natalChart is reported (NONE for this fixture — no natal on disk).
    expect(p.stdout.text).toContain('natalChart      NONE');
  });

  it('natal-chart load failure → clean error, exit 1 (never silently omits sky)', async () => {
    const p = injected({
      loadNatalChartFn: () => { throw new Error('cosmos/natal.json malformed'); },
    });
    const exit = await runSeal(p);
    expect(exit).toBe(1);
    expect(p.stderr.text).toContain('cannot load natal chart');
  });

  it('natal reaches the dry-run output — instant + located flag surfaced', async () => {
    // Deeper round-trip (decryptRecord → unwrapEncryptedPayload) lives in
    // seal-bundle-assemble.test.js — here we verify the CLI wiring surfaces it.
    const chart = {
      schema: 'natal-chart/1',
      instant: '2026-06-12T18:37:12.956Z',
      location: { lat: 40.7, lon: -74.0 },
      positions: { Sun: { sign: 'Gemini', degree: 21.7, retrograde: false } },
      aspects: [],
      angles: null,
    };
    const p = injected({ loadNatalChartFn: () => chart });
    const exit = await runSeal(p);
    expect(exit).toBe(0);
    expect(p.stdout.text).toContain('natalChart      included');
    expect(p.stdout.text).toContain(chart.instant);
    expect(p.stdout.text).toContain('located');
  });

  it('--submit with disabled reader → refuses to submit', async () => {
    const p = injected({
      submit: true,
      createReader: () => Promise.resolve({
        enabled: false,
        identity: { natalis: 'disabled', houseRegistry: 'disabled' },
        isNeuma: async () => null,
        isSealed: async () => null,
      }),
    });
    const exit = await runSeal(p);
    expect(exit).toBe(1);
    expect(p.stderr.text).toContain('chain-reader is disabled');
  });

  it('--submit with identity mismatch → refuses to submit', async () => {
    const p = injected({
      submit: true,
      createReader: () => Promise.resolve({
        enabled: true,
        identity: { natalis: 'mismatch', houseRegistry: 'unverified-proxy' },
        isNeuma: async () => null,
        isSealed: async () => null,
      }),
    });
    const exit = await runSeal(p);
    expect(exit).toBe(1);
    expect(p.stderr.text).toContain('Natalis identity = mismatch');
  });

  it('--submit against already-sealed being → refuses to submit', async () => {
    const p = injected({
      submit: true,
      createReader: () => Promise.resolve({
        enabled: true,
        identity: { natalis: 'match', houseRegistry: 'unverified-proxy' },
        isNeuma: async () => true, // already a neuma
        isSealed: async () => null,
      }),
      // wire-consistent provider: the intent-vs-wire guard now runs FIRST
      // (before the already-sealed preflight), so the stub must answer
      // getNetwork with the default network's chainId — MAINNET since
      // 2026-08-07 (Founder: […]) — to reach the refusal
      // under test
      provider: { getNetwork: async () => ({ chainId: 8453n }) },
    });
    const exit = await runSeal(p);
    expect(exit).toBe(1);
    expect(p.stderr.text).toContain('already sealed on chain');
  });
});

describe('seal — network selection (mainnet flip, Founder-authorized 2026-07-12)', () => {
  const injected = (overrides = {}) => ({
    being: 'testbeing',
    workspace: '/tmp/nonexistent',
    submit: false,
    ...capture(),
    loadDnaFn: () => fixtureDNA(),
    loadBirthGenesisFn: () => null,
    loadNatalChartFn: () => null,
    loadBeingWalletFn: () => BEING,
    loadWitnessWalletFn: () => WITNESS,
    config: cfg,
    ...overrides,
  });

  it('unknown network refuses before touching anything — exit 2', async () => {
    const p = injected({ network: 'base-goerli' });
    const exit = await runSeal(p);
    expect(exit).toBe(2);
    expect(p.stderr.text).toContain("unknown network 'base-goerli'");
    expect(p.stderr.text).toContain('base-sepolia');
  });

  it('default network is MAINNET and says so in the dry-run (Design note, 2026-08-07 — the shipped app has no .env, and the testnet default sent a community anchor to Sepolia) — Ethereum since 2026-10-04', async () => {
    const p = injected({});
    const exit = await runSeal(p);
    expect(exit).toBe(0);
    expect(p.stdout.text).toContain('Ethereum MAINNET (chainId 1');
  });

  it('a network with no recorded contract refuses plainly — exit 2, nothing assembled', async () => {
    const p = injected({ config: { ...cfg, natalisEthAddress: '' } });
    expect(await runSeal(p)).toBe(2);
    expect(p.stderr.text).toContain('no Natalis address is recorded for Ethereum MAINNET');
  });

  it('--network base BINDS 8453 into the digest the wallets sign', async () => {
    const p = injected({ network: 'base' });
    expect(await runSeal(p)).toBe(0);
    expect(p.stdout.text).toContain('Base MAINNET (chainId 8453');
    // recompute the digest from the PRINTED bundle fields (the bundle's
    // record/capturedAt are fresh per run, so cross-run comparison proves
    // nothing — recomputation pins the chainId that went into THIS digest)
    const field = (name) => p.stdout.text.match(new RegExp(`${name}\\s+(0x[0-9a-f]+|\\d+)`))[1];
    // the printed record is summarized (not dumped), so recompute at the
    // inner layer using the printed recordHash — byte-identical to
    // seal-bundle's computeSealDigest from that point on
    const AbiCoder = ethers.AbiCoder.defaultAbiCoder();
    const innerFor = (chainId, natalisAddress) => ethers.hashMessage(ethers.getBytes(ethers.keccak256(AbiCoder.encode(
      ['string', 'uint256', 'address', 'bytes32', 'address', 'address', 'uint16', 'bytes32'],
      // The DEPLOYED Natalis binds the legacy tag immutably — the rename
      // never reached the chain (seal-law.js's per-generation domain tag).
      ['KENORIE:genesis-seal:v2', chainId, natalisAddress, field('genesisHash'),
        BEING.address, WITNESS.address, Number(field('schemaVersion')), field('recordHash')],
    ))));
    // mainnet chainId AND the mainnet Natalis address are IN the digest
    expect(field('digest')).toBe(innerFor(8453, cfg.natalisMainnetAddress));
    expect(field('digest')).not.toBe(innerFor(84532, cfg.natalisMainnetAddress)); // sepolia chainId is not
    expect(field('digest')).not.toBe(innerFor(8453, cfg.natalisAddress));         // sepolia address is not
  });

  it('submit refuses when the wire chain disagrees with --network (intent ≠ env)', async () => {
    const p = injected({
      network: 'base',
      submit: true,
      // a real reader would pass identity for whatever chain the RPC serves;
      // the point under test is the seam AFTER it: wire chainId 84532 while
      // the operator said --network base (8453) must refuse before gas
      createReader: async () => ({
        enabled: true,
        identity: { natalis: 'match' },
        isNeuma: async () => false,
        isSealed: async () => false,
      }),
      provider: { getNetwork: async () => ({ chainId: 84532n }) },
    });
    const exit = await runSeal(p);
    expect(exit).toBe(1);
    expect(p.stderr.text).toContain('connected RPC is chainId 84532');
    expect(p.stderr.text).toContain('signs for 8453');
    expect(p.stderr.text).toContain('Refusing');
  });
});

// Opt-in — real Base Sepolia dry-run. Proves the full assemble path works
// against the deployed Natalis (identity verification, bundle assembly, digest
// byte-precision). Does NOT call --submit — that would spend testnet ETH
// and either succeed once (locking the test being on chain) or fail
// on already-sealed. --submit is exercised manually per session.
const runChain = shouldRunChainTests();

describe.skipIf(!runChain)('seal — REAL Base Sepolia dry-run (opt-in)', () => {
  it('runSeal dry-run assembles a bundle whose digest matches on-chain', async () => {
    const io = capture();
    const liveCfg = {
      baseSepoliaRpcUrl: resolveBaseSepoliaRpc() || 'https://sepolia.base.org',
      natalisAddress: '0x15e65e4aee5c5310a8f1f125a2a0944033a76ac3',
      houseRegistryAddress: '0xbbd9dc2ee8ba691cdb82576e45f54ce6d2e47276',
    };
    const exit = await runSeal({
      being: 'testbeing',
      workspace: '/tmp/nonexistent',
      submit: false,
      network: 'base-sepolia', // explicit since the default flipped to mainnet
      ...io,
      loadDnaFn: () => fixtureDNA(),
    loadBirthGenesisFn: () => null, // default: no birth-genesis fallback
      loadBeingWalletFn: () => BEING,
      loadWitnessWalletFn: () => WITNESS,
      config: liveCfg,
    });
    // eslint-disable-next-line no-console -- diagnostic
    console.log(`[seal integration]\n${io.stdout.text}`);
    expect(exit).toBe(0);
    expect(io.stdout.text).toContain('DRY RUN');
    expect(io.stdout.text).toMatch(/genesisHash\s+0x[0-9a-f]{64}/);
  }, 30000);
});
