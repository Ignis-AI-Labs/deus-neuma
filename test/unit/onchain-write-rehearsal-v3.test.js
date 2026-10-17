// On-chain WRITE-PATH rehearsal against the live UNAVIS redeploy on Ethereum
// Sepolia — the v3 seal law (UNAVIS:genesis-seal:v3, a signed deadline,
// soul-keyed seals; unavis-site PR #3, 2026-09-29).
//
// Same honest dry-run as onchain-write-rehearsal.test.js (the Base v2 twin):
// every state-changing call runs via eth_call/staticCall, so the deployed
// bytecode executes its full validation path — digest, SignatureChecker,
// deadline, write-once gates — and reports what a mined transaction would do.
// Nothing is mined, no gas is spent, every wallet is an in-memory throwaway.
//
// RULE 0 posture: real chain, real bytecode, real signatures, real chain
// reader, no mocks. Opt-in like its twin (test/helpers/chain-optin.js), and
// additionally needs ETH_SEPOLIA_RPC_URL.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { assembleSealBundle, attachWitnessSig } from '../../backend/services/seal-bundle.js';
import {
  encodeSealCalldata, preflightSeal, resolveSealChainConfig, SEAL_NETWORKS,
} from '../../backend/services/natalis-seal.js';
import { sealCallArgs, sealDeadlineFor } from '../../backend/services/seal-law.js';
import { createChainReader } from '../../backend/services/chain-reader.js';
import { shouldRunChainTests, resolveEthSepoliaRpc } from '../helpers/chain-optin.js';

const RPC = resolveEthSepoliaRpc();
const runChain = shouldRunChainTests() && Boolean(RPC);

const deployment = JSON.parse(readFileSync('docs/contracts/deployments/eth-sepolia.json', 'utf8'));
const NATALIS_ADDR = deployment.contracts.Natalis.address;
const HOUSE_ADDR = deployment.contracts.HouseRegistry.address;
const NETWORK = 'ethereum-sepolia';
const CHAIN_ID = SEAL_NETWORKS[NETWORK].chainId;
const natalisAbi = JSON.parse(readFileSync('docs/contracts/abis/Natalis.json', 'utf8')).abi;

const freshWallet = () => new ethers.Wallet(ethers.Wallet.createRandom().privateKey);

// staticCall and name the custom error the live contract reverted with.
const dryRun = async (contract, method, args) => {
  try {
    await contract[method].staticCall(...args);
    return { ok: true };
  } catch (err) {
    const data = err.data ?? err.info?.error?.data ?? null;
    const parsed = data ? contract.interface.parseError(data) : null;
    return { ok: false, error: parsed ? parsed.name : `unparsed:${err.shortMessage || err.message}` };
  }
};

const rehearsalDna = (beingWallet, witnessWallet) => ({
  birthMoment: '2026-09-29T12:00:00.000Z',
  capturedAt: '2026-09-29T12:00:01.000Z',
  chosenName: 'ONCHAIN-WRITE-REHEARSAL-V3',
  house: 'rehearsal',
  soulAddress: beingWallet.address,
  soulMark: 'REHEARSAL',
  substrate: { vendor: 'test', model: 'test', fullModelId: 'test/rehearsal', harness: 'vitest' },
  witnessAddress: witnessWallet.address,
  witnessKind: 'ai',
});

const freshBundle = async ({ deadline = sealDeadlineFor('unavis-v3', Date.now()) } = {}) => {
  const being = freshWallet();
  const witness = freshWallet();
  const bundle = await assembleSealBundle({
    dnaFields: rehearsalDna(being, witness),
    beingWallet: being,
    witnessWallet: witness,
    chainId: CHAIN_ID,
    natalisAddress: NATALIS_ADDR,
    sealLaw: 'unavis-v3',
    deadline,
  });
  return { being, witness, bundle };
};

describe.skipIf(!runChain)('Natalis v3 seal() write path — live Ethereum Sepolia dry-run (opt-in)', () => {
  const provider = new ethers.JsonRpcProvider(RPC);
  const natalis = new ethers.Contract(NATALIS_ADDR, natalisAbi, provider);

  it('a full v3 bundle SUCCEEDS as a seal() transaction', async () => {
    const { bundle } = await freshBundle();
    expect(bundle.deadline).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(await dryRun(natalis, 'seal', sealCallArgs(bundle))).toEqual({ ok: true });
  }, 30000);

  it('a TWO-PHASE desk-shaped v3 bundle SUCCEEDS as raw calldata', async () => {
    const being = freshWallet();
    const witness = freshWallet();
    const partial = await assembleSealBundle({
      dnaFields: rehearsalDna(being, witness),
      beingWallet: being,
      witnessAddress: witness.address,
      chainId: CHAIN_ID,
      natalisAddress: NATALIS_ADDR,
      sealLaw: 'unavis-v3',
      deadline: sealDeadlineFor('unavis-v3', Date.now()),
    });
    const witnessSig = await witness.signMessage(ethers.getBytes(partial.innerPayload));
    const data = encodeSealCalldata(attachWitnessSig(partial, witnessSig));
    await expect(provider.call({ to: NATALIS_ADDR, data })).resolves.toBeDefined();
  }, 30000);

  it('a bundle past its signed deadline is rejected with SealBundleExpired', async () => {
    const { bundle } = await freshBundle({ deadline: Math.floor(Date.now() / 1000) - 60 });
    expect(await dryRun(natalis, 'seal', sealCallArgs(bundle))).toEqual({ ok: false, error: 'SealBundleExpired' });
  }, 30000);

  it('a moved deadline breaks both signatures (the deadline is signed, not advisory)', async () => {
    const { bundle } = await freshBundle();
    const verdict = await dryRun(natalis, 'seal', sealCallArgs({ ...bundle, deadline: bundle.deadline + 1 }));
    expect(verdict).toEqual({ ok: false, error: 'InvalidSelfSignature' });
  }, 30000);

  it('a v2-law bundle can never seal on the v3 contract', async () => {
    const being = freshWallet();
    const witness = freshWallet();
    const v2 = await assembleSealBundle({
      dnaFields: rehearsalDna(being, witness),
      beingWallet: being,
      witnessWallet: witness,
      chainId: CHAIN_ID,
      natalisAddress: NATALIS_ADDR,
    });
    // Forced into v3's argument shape: the signatures bind the v2 tag and
    // field list, so the v3 contract's digest never recovers them.
    const forced = sealCallArgs({ ...v2, sealLaw: 'unavis-v3', deadline: sealDeadlineFor('unavis-v3', Date.now()) });
    expect(await dryRun(natalis, 'seal', forced)).toEqual({ ok: false, error: 'InvalidSelfSignature' });
  }, 30000);
});

describe.skipIf(!runChain)('chain-reader + preflight against the live v3 contract (opt-in)', () => {
  const cfg = {
    ethSepoliaRpcUrl: RPC,
    natalisEthSepoliaAddress: NATALIS_ADDR,
    houseRegistryEthSepoliaAddress: HOUSE_ADDR,
  };

  it('the reader verifies the v3 bytecode and speaks soul-keyed reads only', async () => {
    const reader = await createChainReader({
      rpcUrl: RPC, natalisAddress: NATALIS_ADDR, houseRegistryAddress: HOUSE_ADDR,
    });
    expect(reader.identity).toEqual({ natalis: 'match', houseRegistry: 'match' });
    expect(reader.sealLaw).toBe('unavis-v3');
    const stranger = freshWallet().address;
    expect(await reader.isNeuma(stranger)).toBe(false);
    // Genesis-keyed reads do not exist on this generation — skipped, never mis-encoded.
    expect(await reader.isSealed('0x' + 'ab'.repeat(32))).toBeNull();
    expect(await reader.recordOf('0x' + 'ab'.repeat(32))).toBeNull();
    // Soul-keyed read reaches the contract, which reverts NotSealed → null.
    expect(await reader.recordOfSoul(stranger)).toBeNull();
  }, 30000);

  it('full live preflight passes identity, wire and write-once, then refuses at the gas floor', async () => {
    const { witness, bundle } = await freshBundle();
    const out = await preflightSeal({
      bundle, network: NETWORK, gasPayerAddress: witness.address, cfg, createReader: createChainReader,
    });
    expect(out).toMatchObject({ ok: false, code: 'GAS_FLOOR' });
    expect(resolveSealChainConfig(NETWORK, cfg).sealLaw).toBe('unavis-v3');
  }, 30000);

  it('refuses a v2-law bundle for this network before touching the chain', async () => {
    const being = freshWallet();
    const witness = freshWallet();
    const v2 = await assembleSealBundle({
      dnaFields: rehearsalDna(being, witness),
      beingWallet: being,
      witnessWallet: witness,
      chainId: CHAIN_ID,
      natalisAddress: NATALIS_ADDR,
    });
    const out = await preflightSeal({
      bundle: v2, network: NETWORK, gasPayerAddress: witness.address, cfg, createReader: createChainReader,
    });
    expect(out).toMatchObject({ ok: false, code: 'SEAL_LAW_MISMATCH' });
  }, 30000);

  it('refuses an expired bundle before spending anything', async () => {
    const { witness, bundle } = await freshBundle();
    const out = await preflightSeal({
      bundle, network: NETWORK, gasPayerAddress: witness.address, cfg, createReader: createChainReader,
      nowMs: (bundle.deadline + 1) * 1000,
    });
    expect(out).toMatchObject({ ok: false, code: 'BUNDLE_EXPIRED' });
  }, 30000);
});
