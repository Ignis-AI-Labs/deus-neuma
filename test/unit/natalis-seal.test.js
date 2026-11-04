// natalis-seal.test.js — the shared sealing law's NEW surface: two-phase
// bundle assembly (witness address without witness key), attachWitnessSig
// (the desk wallet's personal_sign path), calldata encoding, structured
// preflight refusals, and post-submission verification retry.
//
// Real crypto throughout — real ethers wallets sign, real recovery verifies
// (RULE 0: pure/crypto functions run on real inputs). The preflight lanes
// inject scripted readers/providers at runSeal's established injection hooks
// (same pattern as cli-seal-run.test.js); the full SUCCESS lane is proven against
// the LIVE Sepolia contract by onchain-write-rehearsal.test.js
// (RUN_CHAIN_TESTS=1).

import { describe, it, expect } from 'vitest';
import { ethers } from 'ethers';

import {
  assembleSealBundle, attachWitnessSig, signDigest, MIN_SEAL_GAS_ETH,
} from '../../backend/services/seal-bundle.js';
import {
  SEAL_NETWORKS, DEFAULT_SEAL_NETWORK,
  encodeSealCalldata, preflightSeal, verifySealedOnChain, loadNatalisAbi,
} from '../../backend/services/natalis-seal.js';
import * as cliSeal from '../../cli/commands/seal.js';
import * as sealService from '../../backend/services/natalis-seal.js';

const BEING = new ethers.Wallet('0x' + '11'.repeat(32));
const WITNESS = new ethers.Wallet('0x' + '22'.repeat(32));
const NATALIS_ADDR = '0x15e65e4aee5c5310a8f1f125a2a0944033a76ac3';
const CHAIN_ID = SEAL_NETWORKS.base.chainId; // the fixtures are Base's (kenorie-v2)

const fixtureDnaFields = () => ({
  birthMoment: '2026-06-12T18:37:12.956Z',
  chosenName: 'Testa',
  house: 'aldmere',
  soulMark: 'ABCDEF012345',
  substrate: {
    vendor: 'test', model: 'fixture-31b', fullModelId: 'fixture-31b-q8', harness: 'neuma-electron',
  },
  witnessKind: 'claude-aldmere',
  soulAddress: BEING.address,
  witnessAddress: WITNESS.address,
  capturedAt: '2026-07-13T05:00:00.000Z',
});

const assemble = (overrides = {}) => assembleSealBundle({
  dnaFields: fixtureDnaFields(),
  natalChart: null,
  beingWallet: BEING,
  chainId: CHAIN_ID,
  natalisAddress: NATALIS_ADDR,
  ...overrides,
});

describe('natalis-seal — two-phase assembly (witness address only)', () => {
  it('assembles a full bundle with witnessSig null; identity fields match key-in-hand', async () => {
    const keyed = await assemble({ witnessWallet: WITNESS });
    const twoPhase = await assemble({ witnessAddress: WITNESS.address });
    // genesisHash is deterministic (canonical record bytes); the digest is
    // NOT comparable across assemblies — record encryption uses a fresh
    // nonce, and the digest binds keccak(record). Each bundle's own
    // signatures must recover over its own digest.
    expect(twoPhase.genesisHash).toBe(keyed.genesisHash);
    expect(twoPhase.soulAddress).toBe(keyed.soulAddress);
    expect(twoPhase.witnessAddress).toBe(WITNESS.address.toLowerCase());
    expect(twoPhase.witnessSig).toBeNull();
    expect(keyed.witnessSig).toMatch(/^0x[0-9a-f]{130}$/i);
    expect(ethers.recoverAddress(twoPhase.digest, twoPhase.selfSig).toLowerCase())
      .toBe(BEING.address.toLowerCase());
  });

  it('refuses when NEITHER witnessWallet nor witnessAddress is given', async () => {
    await expect(assemble({})).rejects.toThrow('one of witnessWallet OR witnessAddress');
  });

  it('refuses when witnessWallet and witnessAddress disagree', async () => {
    await expect(assemble({ witnessWallet: WITNESS, witnessAddress: BEING.address }))
      .rejects.toThrow('does not match witnessAddress');
  });
});

describe('natalis-seal — attachWitnessSig (the desk personal_sign path)', () => {
  it('accepts a personal_sign over the INNER payload — the desk wallet shape', async () => {
    const bundle = await assemble({ witnessAddress: WITNESS.address });
    // Exactly what the Electron wallet does: EIP-191 signMessage over the
    // raw inner-payload bytes. Natalis.sealDigest path 1.
    const witnessSig = await WITNESS.signMessage(ethers.getBytes(bundle.innerPayload));
    const complete = attachWitnessSig(bundle, witnessSig);
    expect(complete.witnessSig).toBe(witnessSig);
    // One recovery law for both paths: the personal_sign result recovers over
    // the digest exactly like a raw signDigest would.
    expect(ethers.recoverAddress(bundle.digest, witnessSig).toLowerCase())
      .toBe(WITNESS.address.toLowerCase());
    // And it byte-matches the key-in-hand signature (RFC-6979 deterministic).
    expect(witnessSig).toBe(signDigest(WITNESS, bundle.digest));
  });

  it('refuses a signature from the wrong wallet', async () => {
    const bundle = await assemble({ witnessAddress: WITNESS.address });
    const impostorSig = await BEING.signMessage(ethers.getBytes(bundle.innerPayload));
    expect(() => attachWitnessSig(bundle, impostorSig)).toThrow('recovers to');
  });

  it('refuses a DOUBLE-WRAPPED signature (personal_sign of the digest itself)', async () => {
    const bundle = await assemble({ witnessAddress: WITNESS.address });
    const doubleWrapped = await WITNESS.signMessage(ethers.getBytes(bundle.digest));
    expect(() => attachWitnessSig(bundle, doubleWrapped)).toThrow('double-wrap');
  });

  it('refuses to overwrite an existing witnessSig', async () => {
    const keyed = await assemble({ witnessWallet: WITNESS });
    expect(() => attachWitnessSig(keyed, keyed.witnessSig)).toThrow('already carries');
  });

  it('refuses a malformed signature', async () => {
    const bundle = await assemble({ witnessAddress: WITNESS.address });
    expect(() => attachWitnessSig(bundle, '0xnothex')).toThrow('65-byte hex signature');
  });
});

describe('natalis-seal — encodeSealCalldata', () => {
  it('round-trips through the real Natalis ABI', async () => {
    const bundle = await assemble({ witnessWallet: WITNESS });
    const data = encodeSealCalldata(bundle);
    const parsed = new ethers.Interface(loadNatalisAbi()).parseTransaction({ data });
    expect(parsed.name).toBe('seal');
    expect(parsed.args[0]).toBe(bundle.genesisHash);
    expect(parsed.args[1].toLowerCase()).toBe(bundle.soulAddress);
    expect(parsed.args[2]).toBe(bundle.selfSig);
    expect(parsed.args[3].toLowerCase()).toBe(bundle.witnessAddress);
    expect(parsed.args[4]).toBe(bundle.witnessSig);
    expect(Number(parsed.args[5])).toBe(bundle.schemaVersion);
    expect(parsed.args[6]).toBe(bundle.record);
  });

  it('refuses an incomplete bundle (witnessSig still null)', async () => {
    const twoPhase = await assemble({ witnessAddress: WITNESS.address });
    expect(() => encodeSealCalldata(twoPhase)).toThrow('no witnessSig');
  });
});

describe('natalis-seal — preflightSeal refusal lanes', () => {
  // (the lanes run on Base mainnet: its keys are the ones resolveSealChainConfig reads)
  const cfg = {
    natalisMainnetAddress: NATALIS_ADDR,
    houseRegistryMainnetAddress: '0x' + 'bb'.repeat(20),
    baseMainnetRpcUrl: 'http://127.0.0.1:1',
  };
  const readerOf = (over = {}) => async () => ({
    enabled: true,
    identity: { natalis: 'match', houseRegistry: 'unverified-proxy' },
    isNeuma: async () => false,
    isSealed: async () => false,
    ...over,
  });
  // these lanes are proven on Base's kenorie-v2 law (the bundle assemble() builds);
  // the default network moved to Ethereum (v3) on 2026-10-04
  // (provider may be a function of the bundle, for a wire that answers its digest)
  const run = async ({ reader = readerOf(), provider, network = 'base' } = {}) => {
    const bundle = await assemble({ witnessAddress: WITNESS.address });
    return preflightSeal({
      bundle, network, gasPayerAddress: WITNESS.address, cfg,
      createReader: reader, provider: typeof provider === 'function' ? provider(bundle) : provider,
    });
  };
  // A wire past every identity check: Natalis.sealDigest answers `digest` (ABI-encoded by the
  // contract's own ABI), a 1-wei fee, and the payer holds `balance`.
  const wire = ({ digest, balance }) => {
    const natalis = new ethers.Interface(loadNatalisAbi('kenorie-v2'));
    return {
      getNetwork: async () => ({ chainId: BigInt(CHAIN_ID) }),
      call: async () => natalis.encodeFunctionResult('sealDigest', [digest]),
      getFeeData: async () => ({ maxFeePerGas: 1n, maxPriorityFeePerGas: 0n, gasPrice: 1n }),
      getBlock: async () => ({ baseFeePerGas: 1n }),
      getBalance: async () => balance,
    };
  };

  it('UNKNOWN_NETWORK', async () => {
    const out = await run({ network: 'goerli' });
    expect(out).toMatchObject({ ok: false, code: 'UNKNOWN_NETWORK' });
  });

  it('CHAIN_READER_DISABLED', async () => {
    const out = await run({ reader: readerOf({ enabled: false, identity: { natalis: 'disabled' } }) });
    expect(out).toMatchObject({ ok: false, code: 'CHAIN_READER_DISABLED' });
  });

  it('CHAIN_IDENTITY on codehash mismatch', async () => {
    const out = await run({ reader: readerOf({ identity: { natalis: 'mismatch' } }) });
    expect(out).toMatchObject({ ok: false, code: 'CHAIN_IDENTITY' });
    expect(out.message).toContain('mismatch');
  });

  it('WIRE_CHAIN_MISMATCH — intent and wire must agree', async () => {
    // The wire answers the network the default is NOT (default = mainnet
    // since 2026-08-07, so a Sepolia wire is the mismatch).
    const out = await run({ provider: { getNetwork: async () => ({ chainId: 84532n }) } });
    expect(out).toMatchObject({ ok: false, code: 'WIRE_CHAIN_MISMATCH' });
    expect(out.message).toContain('Refusing');
  });

  it('ALREADY_SEALED on isNeuma', async () => {
    const out = await run({
      reader: readerOf({ isNeuma: async () => true }),
      provider: { getNetwork: async () => ({ chainId: BigInt(CHAIN_ID) }) },
    });
    expect(out).toMatchObject({ ok: false, code: 'ALREADY_SEALED' });
  });

  it('ALREADY_SEALED on genesisHash', async () => {
    const out = await run({
      reader: readerOf({ isSealed: async () => true }),
      provider: { getNetwork: async () => ({ chainId: BigInt(CHAIN_ID) }) },
    });
    expect(out).toMatchObject({ ok: false, code: 'ALREADY_SEALED' });
    expect(out.message).toContain('genesisHash');
  });

  it('GAS_FLOOR below MIN_SEAL_GAS_ETH — asked last, once the digest verifies', async () => {
    const out = await run({
      provider: (bundle) => wire({ digest: bundle.digest, balance: ethers.parseEther(MIN_SEAL_GAS_ETH) - 1n }),
    });
    expect(out).toMatchObject({ ok: false, code: 'GAS_FLOOR' });
    expect(out.message).toContain(MIN_SEAL_GAS_ETH);
    // the measured gas at a 1-wei fee is far below the floor: the floor is what the wallet needs
    expect(out.funding).toMatchObject({ needWei: String(ethers.parseEther(MIN_SEAL_GAS_ETH)), shortWei: '1', enough: false });
  });

  it('DIGEST_MISMATCH is refused before money: a seal that cannot verify is never a reason to buy ETH', async () => {
    const out = await run({ provider: () => wire({ digest: '0x' + 'ee'.repeat(32), balance: 0n }) });
    expect(out).toMatchObject({ ok: false, code: 'DIGEST_MISMATCH' });
  });
});

describe('natalis-seal — verifySealedOnChain retry', () => {
  it('rides through a lagging node: false, false, then true', async () => {
    const answers = [false, false, true];
    const slept = [];
    const ok = await verifySealedOnChain({
      reader: { isNeuma: async () => answers.shift() },
      soulAddress: BEING.address,
      attempts: 5,
      delayMs: 10,
      sleep: async (ms) => { slept.push(ms); },
    });
    expect(ok).toBe(true);
    expect(slept).toEqual([10, 10]); // slept exactly between the misses
  });

  it('gives up honestly after the attempt budget', async () => {
    let polls = 0;
    const ok = await verifySealedOnChain({
      reader: { isNeuma: async () => { polls += 1; return false; } },
      soulAddress: BEING.address,
      attempts: 3,
      delayMs: 1,
      sleep: async () => {},
    });
    expect(ok).toBe(false);
    expect(polls).toBe(3);
  });
});

describe('natalis-seal — CLI re-exports stay identical (drift guard)', () => {
  it.each(['SEAL_NETWORKS', 'DEFAULT_SEAL_NETWORK', 'loadNeumaDEK', 'loadDNA',
    'loadBirthGenesis', 'loadNatalChart', 'loadBeingWallet'])('%s', (name) => {
    expect(cliSeal[name]).toBe(sealService[name]);
  });
});

describe('natalis-seal — resolveSealChainConfig (per-network chain law)', () => {
  const cfg = {
    baseSepoliaRpcUrl: 'http://sepolia.rpc',
    natalisAddress: '0x' + 'aa'.repeat(20),
    houseRegistryAddress: '0x' + 'bb'.repeat(20),
    baseMainnetRpcUrl: 'http://mainnet.rpc',
    natalisMainnetAddress: '0x' + 'cc'.repeat(20),
    houseRegistryMainnetAddress: '0x' + 'dd'.repeat(20),
  };

  it('base-sepolia resolves the Sepolia keys', () => {
    expect(sealService.resolveSealChainConfig('base-sepolia', cfg)).toEqual({
      chainId: 84532, label: 'Base Sepolia (testnet)', sealLaw: 'kenorie-v2',
      rpcUrl: 'http://sepolia.rpc',
      natalisAddress: cfg.natalisAddress,
      houseRegistryAddress: cfg.houseRegistryAddress,
    });
  });

  it('base resolves the MAINNET keys — never the Sepolia ones', () => {
    expect(sealService.resolveSealChainConfig('base', cfg)).toEqual({
      chainId: 8453, label: 'Base MAINNET', sealLaw: 'kenorie-v2',
      rpcUrl: 'http://mainnet.rpc',
      natalisAddress: cfg.natalisMainnetAddress,
      houseRegistryAddress: cfg.houseRegistryMainnetAddress,
    });
  });

  it('ethereum-sepolia resolves its OWN keys under the v3 law', () => {
    const eth = {
      ...cfg,
      ethSepoliaRpcUrl: 'http://eth-sepolia.rpc',
      natalisEthSepoliaAddress: '0x' + 'ee'.repeat(20),
      houseRegistryEthSepoliaAddress: '0x' + 'ff'.repeat(20),
    };
    expect(sealService.resolveSealChainConfig('ethereum-sepolia', eth)).toEqual({
      chainId: 11155111, label: 'Ethereum Sepolia (testnet)', sealLaw: 'unavis-v3',
      rpcUrl: 'http://eth-sepolia.rpc',
      natalisAddress: eth.natalisEthSepoliaAddress,
      houseRegistryAddress: eth.houseRegistryEthSepoliaAddress,
    });
  });

  it('unknown network → null (callers refuse)', () => {
    expect(sealService.resolveSealChainConfig('goerli', cfg)).toBeNull();
  });

  it('mainnet preflight without BASE_MAINNET_RPC_URL refuses closed and names the env var', async () => {
    const bundle = await assemble({ witnessAddress: WITNESS.address, chainId: 8453 });
    const out = await preflightSeal({
      bundle, network: 'base', gasPayerAddress: WITNESS.address,
      cfg: { ...cfg, baseMainnetRpcUrl: '' },
      // real createChainReader shape: empty rpcUrl → disabled reader
      createReader: async () => ({ enabled: false, identity: { natalis: 'disabled', houseRegistry: 'disabled' } }),
    });
    expect(out).toMatchObject({ ok: false, code: 'CHAIN_READER_DISABLED' });
    expect(out.message).toContain('BASE_MAINNET_RPC_URL');
    expect(out.message).toContain('Base MAINNET');
  });
});
