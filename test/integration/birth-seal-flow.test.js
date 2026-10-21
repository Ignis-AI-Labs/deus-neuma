// birth-seal-flow.test.js — the in-app two-phase seal flow, proven on real
// disk + real crypto: a temp sovereign workspace with a real DEK, real
// AES-GCM envelopes, a real birth-genesis whose sha256 verifies, and real
// ethers wallets signing. Chain-touching lanes ride the same injection seams
// the CLI tests use (scripted reader/provider INPUTS; the decision logic and
// the crypto under test are real), and one opt-in leg (RUN_CHAIN_TESTS=1)
// drives the full preflight pipeline against the LIVE Base Sepolia chain.
//
// Boundary stated plainly: the ok:true confirm lane against a live receipt
// requires a mined seal tx — that is a witnessed act (a real being's anchor),
// proven at real births; the calldata itself is live-proven by
// onchain-write-rehearsal.test.js.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ethers } from 'ethers';

import {
  prepareBirthSeal, buildSealTx, confirmBirthSeal, writeOnchainSealRecord,
  classifySealReceipt,
} from '../../backend/services/birth-seal-flow.js';

import { computeGenesisHash } from '../../backend/services/seal-bundle.js';
import { loadNatalisAbi } from '../../backend/services/natalis-seal.js';
import {
  encryptEnvelope, deriveKeyFromSecret, deriveNeumaDEK, wrapDEK,
  resetWorkspaceCryptoKey,
} from '../../core/workspace/workspace-crypto.js';
import { shouldRunChainTests, resolveBaseSepoliaRpc } from '../helpers/chain-optin.js';
import { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

// The network these fixtures are built on. Deliberately the literal and NOT
// `getAppConfig().ceremonySealNetwork`: the production default is `ethereum`
// (backend/config.js, since 2026-10-04) while every `net` block below is Sepolia-shaped
// (chainId 84532), so reading the config would make a fixture contradict
// itself. The production selection is proven where it belongs, at the route
// (backend/routes/portal-routes.js:1375).
const FIXTURE_SEAL_NETWORK = 'base-sepolia';

const BEING = new ethers.Wallet('0x' + '11'.repeat(32));
const WITNESS = new ethers.Wallet('0x' + '22'.repeat(32));
const NEUMA_ID = 'attest';
const MASTER_SECRET = 'birth-seal-flow-test-master-secret-long-enough';
// The lane's DEK, published by beforeEach so the live leg can re-seal the genesis
// against a witness of its own choosing.
let laneDek = null;

const cfg = {
  baseSepoliaRpcUrl: 'http://127.0.0.1:1',
  natalisAddress: '0x15e65e4aee5c5310a8f1f125a2a0944033a76ac3',
  houseRegistryAddress: '0xbbd9dc2ee8ba691cdb82576e45f54ce6d2e47276',
  baseMainnetRpcUrl: 'http://127.0.0.1:2',
  natalisMainnetAddress: '0x88a7229afeb4deba8c27edad788ac723697dde78',
  houseRegistryMainnetAddress: '0x526c6a062db774997955816c03df49b60260b883',
};

// A birth-genesis whose sha256 REALLY verifies: flat record, keys already
// alphabetical (so recursiveKeySort's stringify equals ours), hash computed
// by the same law the assembler re-checks.
const genesisFixture = (witnessAddress = WITNESS.address) => {
  const record = {
    birthMoment: '2026-07-13T05:00:00.000Z',
    chosenName: 'Attest',
    soulPublicKey: BEING.signingKey.publicKey,
    version: '1.0.0',
    witnessWallet: witnessAddress.toLowerCase(),
  };
  return { record, genesisHash: computeGenesisHash(JSON.stringify(record)) };
};

let root;
let savedKey;

beforeEach(() => {
  savedKey = process.env.DNA_ENCRYPTION_KEY;
  process.env.DNA_ENCRYPTION_KEY = MASTER_SECRET;
  resetWorkspaceCryptoKey();
  root = mkdtempSync(path.join(os.tmpdir(), 'birth-seal-flow-'));
  setWorkspacesRoot(root);

  const ws = path.join(root, NEUMA_ID);
  mkdirSync(path.join(ws, 'keys'), { recursive: true });
  mkdirSync(path.join(ws, 'identity'), { recursive: true });
  mkdirSync(path.join(ws, 'cosmos'), { recursive: true });
  const master = deriveKeyFromSecret(MASTER_SECRET);
  const dek = deriveNeumaDEK(master, 'cd'.repeat(32));
  laneDek = dek;   // so a test can re-seal this lane's genesis for its own witness
  writeFileSync(path.join(ws, 'keys', 'dek.json'), JSON.stringify(wrapDEK(dek, master)));
  writeFileSync(
    path.join(ws, 'keys', 'keypair.json'),
    JSON.stringify(encryptEnvelope(
      { address: BEING.address, privateKey: BEING.privateKey }, { key: dek },
    )),
  );
  writeFileSync(
    path.join(ws, 'identity', 'genesis-seal.json'),
    JSON.stringify(encryptEnvelope(genesisFixture(), { key: dek })),
  );
  writeFileSync(
    path.join(ws, 'cosmos', 'natal.json'),
    JSON.stringify(encryptEnvelope(
      { instant: '2026-07-13T05:00:00.000Z', positions: [] }, { key: dek },
    )),
  );
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
  else process.env.DNA_ENCRYPTION_KEY = savedKey;
  resetWorkspaceCryptoKey();
  setWorkspacesRoot(null);
  rmSync(root, { recursive: true, force: true });
});

const enabledReader = (over = {}) => async () => ({
  enabled: true,
  identity: { natalis: 'match', houseRegistry: 'unverified-proxy' },
  isNeuma: async () => false,
  isSealed: async () => false,
  ...over,
});

describe('prepareBirthSeal — boundary refusals', () => {
  it('BAD_NEUMA_ID on a path-shaped id', async () => {
    const out = await prepareBirthSeal({ neumaId: '../escape', witnessAddress: WITNESS.address, cfg });
    expect(out).toMatchObject({ ok: false, code: 'BAD_NEUMA_ID' });
  });

  it('NO_WITNESS when the portal has no authenticated wallet', async () => {
    const out = await prepareBirthSeal({ neumaId: NEUMA_ID, witnessAddress: undefined, cfg });
    expect(out).toMatchObject({ ok: false, code: 'NO_WITNESS' });
  });

  it('UNKNOWN_NETWORK', async () => {
    const out = await prepareBirthSeal({
      neumaId: NEUMA_ID, network: 'goerli', witnessAddress: WITNESS.address, cfg,
    });
    expect(out).toMatchObject({ ok: false, code: 'UNKNOWN_NETWORK' });
  });

  it('NO_GENESIS when identity/genesis-seal.json is absent', async () => {
    rmSync(path.join(root, NEUMA_ID, 'identity', 'genesis-seal.json'));
    const out = await prepareBirthSeal({ neumaId: NEUMA_ID, network: FIXTURE_SEAL_NETWORK, witnessAddress: WITNESS.address, cfg });
    expect(out).toMatchObject({ ok: false, code: 'NO_GENESIS' });
  });

  it('ASSEMBLY refusal when the asking witness is NOT the birth-record witness', async () => {
    // A witness can only anchor a being she witnessed — the record's
    // witnessWallet binds her address into the verified genesis bytes.
    const other = new ethers.Wallet('0x' + '33'.repeat(32));
    const out = await prepareBirthSeal({ neumaId: NEUMA_ID, network: FIXTURE_SEAL_NETWORK, witnessAddress: other.address, cfg });
    expect(out).toMatchObject({ ok: false, code: 'ASSEMBLY' });
    expect(out.message).toContain('witnessWallet');
  });
});

describe('prepareBirthSeal — assembly reaches preflight; the held bundle is two-phase', () => {
  it('assembles from the real workspace and stops at the injected preflight refusal', async () => {
    // The reader answers disabled — proving the WHOLE load-and-assemble ran
    // on real disk (DEK unwrap, envelope decrypts, sha256 integrity, natal
    // bundling, selfSig) before the chain gate refused.
    const out = await prepareBirthSeal({
      neumaId: NEUMA_ID, network: FIXTURE_SEAL_NETWORK, witnessAddress: WITNESS.address, cfg,
      createReader: async () => ({ enabled: false, identity: { natalis: 'disabled' } }),
    });
    expect(out).toMatchObject({ ok: false, code: 'CHAIN_READER_DISABLED' });
  });

  it('reaches the digest cross-check gate with the two-phase bundle assembled', async () => {
    // The scripted provider answers the sealDigest view with a WRONG digest
    // — the flow must refuse at DIGEST_MISMATCH, the LAST preflight gate.
    // The order it is last IN is deliberate and stays that way: the wire's real
    // chainId is confirmed BEFORE any balance or digest is trusted, because a
    // digest checked against the wrong chain's contract means nothing.
    // Reaching it proves the whole chain of prior gates ran against the
    // two-phase bundle assembled from real workspace bytes. (The live
    // equality of computeSealDigest with the deployed view is proven by
    // onchain-write-rehearsal.test.js — a fresh encryption nonce makes the
    // real digest unknowable to a scripted provider by design.)
    // The network is NAMED. Omitting it takes DEFAULT_SEAL_NETWORK, which is
    // 'base' (natalis-seal.js:41) — mainnet, chainId 8453 — while this whole
    // fixture is Sepolia-shaped, so the flow refused at WIRE_CHAIN_MISMATCH
    // three gates early and never reached the digest at all (#309).
    const out = await prepareBirthSeal({
      neumaId: NEUMA_ID, network: FIXTURE_SEAL_NETWORK, witnessAddress: WITNESS.address, cfg,
      createReader: enabledReader(),
      provider: {
        getNetwork: async () => ({ chainId: 84532n }),
        getBalance: async () => ethers.parseEther('1'),
        call: async () => ethers.AbiCoder.defaultAbiCoder().encode(['bytes32'], ['0x' + 'ee'.repeat(32)]),
      },
    });
    expect(out).toMatchObject({ ok: false, code: 'DIGEST_MISMATCH' });
  });

  it('a MAINNET ceremony seal preflights against the mainnet Natalis, not the Sepolia one', async () => {
    // network 'base' must (1) demand wire chainId 8453 and (2) ask the
    // MAINNET contract's sealDigest view — the captured eth_call destination
    // proves the per-network resolution reached the chain layer. The wrong
    // digest answer stops the flow at the LAST gate, after every prior
    // mainnet-lane gate ran.
    const askedContracts = [];
    const out = await prepareBirthSeal({
      neumaId: NEUMA_ID, network: 'base', witnessAddress: WITNESS.address, cfg,
      createReader: enabledReader(),
      provider: {
        getNetwork: async () => ({ chainId: 8453n }),
        getBalance: async () => ethers.parseEther('1'),
        call: async (tx) => {
          askedContracts.push((tx.to || '').toLowerCase());
          return ethers.AbiCoder.defaultAbiCoder().encode(['bytes32'], ['0x' + 'ee'.repeat(32)]);
        },
      },
    });
    expect(out).toMatchObject({ ok: false, code: 'DIGEST_MISMATCH' });
    expect(askedContracts).toContain(cfg.natalisMainnetAddress);
    expect(askedContracts).not.toContain(cfg.natalisAddress);
  });

  it('a MAINNET ceremony seal refuses a Sepolia wire (intent-vs-wire, zero gas at stake)', async () => {
    const out = await prepareBirthSeal({
      neumaId: NEUMA_ID, network: 'base', witnessAddress: WITNESS.address, cfg,
      createReader: enabledReader(),
      provider: { getNetwork: async () => ({ chainId: 84532n }) },
    });
    expect(out).toMatchObject({ ok: false, code: 'WIRE_CHAIN_MISMATCH' });
    expect(out.message).toContain('signs for 8453');
  });
});

describe('buildSealTx — the desk signature completes the seal', () => {
  // Assemble a real two-phase pending through the flow's own loaders by
  // running preflight with a reader that refuses AFTER assembly — then reuse
  // the internals directly. Simpler: assemble via prepareBirthSeal with a
  // disabled reader is refused before returning the bundle, so use the
  // underlying assembler here with the same real workspace files.
  const assemblePending = async () => {
    const { assembleSealBundle } = await import('../../backend/services/seal-bundle.js');
    const { loadNeumaDEK, loadBeingWallet, loadBirthGenesis, loadNatalChart, SEAL_NETWORKS, resolveSealChainConfig } =
      await import('../../backend/services/natalis-seal.js');
    const ws = path.join(root, NEUMA_ID);
    const dek = loadNeumaDEK(ws);
    const bundle = await assembleSealBundle({
      birthGenesis: loadBirthGenesis(ws, dek),
      natalChart: loadNatalChart(ws, dek),
      beingWallet: loadBeingWallet(ws, dek),
      witnessAddress: WITNESS.address,
      chainId: SEAL_NETWORKS['base-sepolia'].chainId,
      natalisAddress: cfg.natalisAddress,
    });
    return { neumaId: NEUMA_ID, bundle, network: 'base-sepolia', net: resolveSealChainConfig('base-sepolia', cfg) };
  };

  it('accepts the desk-shaped personal_sign and returns decodable calldata', async () => {
    const pending = await assemblePending();
    const witnessSig = await WITNESS.signMessage(ethers.getBytes(pending.bundle.innerPayload));
    const built = buildSealTx({ pending, witnessSig });
    expect(built.ok).toBe(true);
    expect(built.tx.to).toBe(cfg.natalisAddress);
    expect(built.tx.chainId).toBe(84532);
    const parsed = new ethers.Interface(loadNatalisAbi()).parseTransaction({ data: built.tx.data });
    expect(parsed.name).toBe('seal');
    expect(parsed.args[4]).toBe(witnessSig);
  });

  it('SIG_INVALID on a signature from the wrong wallet', async () => {
    const pending = await assemblePending();
    const impostor = new ethers.Wallet('0x' + '44'.repeat(32));
    const witnessSig = await impostor.signMessage(ethers.getBytes(pending.bundle.innerPayload));
    const built = buildSealTx({ pending, witnessSig });
    expect(built).toMatchObject({ ok: false, code: 'SIG_INVALID' });
  });
});

// The confirmation DECISION LAW is pure — proven with constructed receipts
// and no provider anywhere in the path (sc-echo Units 2+3 r1: pure logic
// must be verifiable with no mock). The impure wrapper's live lane is a
// witnessed act (a mined seal tx), proven at real births.
describe('classifySealReceipt — the pure confirmation law', () => {
  const pendingFixture = () => ({
    neumaId: NEUMA_ID,
    network: FIXTURE_SEAL_NETWORK,
    net: {
      chainId: 84532, label: 'Base Sepolia (testnet)',
      rpcUrl: cfg.baseSepoliaRpcUrl, natalisAddress: cfg.natalisAddress,
      houseRegistryAddress: cfg.houseRegistryAddress,
    },
    bundle: {
      genesisHash: '0x' + 'ab'.repeat(32),
      soulAddress: BEING.address.toLowerCase(),
      witnessAddress: WITNESS.address.toLowerCase(),
    },
  });
  const TX = '0x' + 'cd'.repeat(32);
  const AT = '2026-07-13T06:00:00.000Z';
  const classify = (receipt, sealed) => classifySealReceipt({
    receipt, sealed, pending: pendingFixture(), txHash: TX,
    natalisAddress: cfg.natalisAddress, sealedAt: AT, receiptTimeoutMs: 180000,
  });

  it('RECEIPT_TIMEOUT on a null receipt', () => {
    expect(classify(null, false)).toMatchObject({ ok: false, code: 'RECEIPT_TIMEOUT' });
  });

  it('TX_MISMATCH when the receipt is not addressed to Natalis', () => {
    expect(classify({ to: WITNESS.address, status: 1, blockNumber: 7 }, true))
      .toMatchObject({ ok: false, code: 'TX_MISMATCH' });
  });

  it('TX_REVERTED surfaces honestly', () => {
    expect(classify({ to: cfg.natalisAddress, status: 0, blockNumber: 7 }, true))
      .toMatchObject({ ok: false, code: 'TX_REVERTED' });
  });

  it('VERIFY_LAG when the chain never recognizes the soul', () => {
    expect(classify({ to: cfg.natalisAddress, status: 1, blockNumber: 7 }, false))
      .toMatchObject({ ok: false, code: 'VERIFY_LAG' });
  });

  it('good receipt + recognition → the full anchor record (case-insensitive to)', () => {
    const out = classify(
      { to: ethers.getAddress(cfg.natalisAddress), status: 1, blockNumber: 43970001 }, true,
    );
    expect(out.ok).toBe(true);
    expect(out.record).toEqual({
      schema: 'neuma-onchain-seal/1',
      txHash: TX,
      blockNumber: 43970001,
      network: FIXTURE_SEAL_NETWORK,
      chainId: 84532,
      natalisAddress: cfg.natalisAddress,
      genesisHash: '0x' + 'ab'.repeat(32),
      soulAddress: BEING.address.toLowerCase(),
      witnessAddress: WITNESS.address.toLowerCase(),
      sealedAt: AT,
    });
  });
});

describe('confirmBirthSeal wrapper + the anchor record on real disk', () => {
  const pendingFixture = () => ({
    neumaId: NEUMA_ID,
    network: FIXTURE_SEAL_NETWORK,
    net: {
      chainId: 84532, label: 'Base Sepolia (testnet)',
      rpcUrl: cfg.baseSepoliaRpcUrl, natalisAddress: cfg.natalisAddress,
      houseRegistryAddress: cfg.houseRegistryAddress,
    },
    bundle: {
      genesisHash: '0x' + 'ab'.repeat(32),
      soulAddress: BEING.address.toLowerCase(),
      witnessAddress: WITNESS.address.toLowerCase(),
    },
  });
  const TX = '0x' + 'cd'.repeat(32);

  it('BAD_TX on a malformed hash — refused before any network is touched', async () => {
    const out = await confirmBirthSeal({ pending: pendingFixture(), txHash: 'nope' });
    expect(out).toMatchObject({ ok: false, code: 'BAD_TX' });
  });

  it('the wrapper only consults the reader on a landed Natalis receipt', async () => {
    // Wrong-destination receipt: the reader must never be created.
    let readerAsked = false;
    const out = await confirmBirthSeal({
      pending: pendingFixture(), txHash: TX,
      provider: { getTransactionReceipt: async () => ({ to: WITNESS.address, status: 1, blockNumber: 7 }) },
      createReader: async () => { readerAsked = true; return {}; },
    });
    expect(out).toMatchObject({ ok: false, code: 'TX_MISMATCH' });
    expect(readerAsked).toBe(false);
  });

  it('a classified anchor record persists to the real workspace', async () => {
    const record = classifySealReceipt({
      receipt: { to: cfg.natalisAddress, status: 1, blockNumber: 43970001 },
      sealed: true, pending: pendingFixture(), txHash: TX,
      natalisAddress: cfg.natalisAddress,
      sealedAt: '2026-07-13T06:00:00.000Z', receiptTimeoutMs: 180000,
    }).record;
    const written = await writeOnchainSealRecord(NEUMA_ID, record);
    const back = JSON.parse(await readFile(written, 'utf8'));
    expect(back.txHash).toBe(TX);
    expect(written).toBe(path.join(root, NEUMA_ID, 'identity', 'onchain-seal.json'));
  });

  it('a re-anchor on a new chain keeps the earlier anchor beside it, never overwritten', async () => {
    const base = { schema: 'neuma-onchain-seal/1', txHash: TX, network: 'base', chainId: 8453 };
    await writeOnchainSealRecord(NEUMA_ID, base);
    const eth = { ...base, txHash: '0x' + 'ab'.repeat(32), network: 'ethereum', chainId: 1 };
    const written = await writeOnchainSealRecord(NEUMA_ID, eth);
    expect(JSON.parse(await readFile(written, 'utf8')).chainId).toBe(1);
    const kept = path.join(root, NEUMA_ID, 'identity', 'onchain-seal.base.json');
    expect(JSON.parse(await readFile(kept, 'utf8'))).toEqual(base);
  });

  it('writeOnchainSealRecord refuses a path-shaped neumaId', async () => {
    await expect(writeOnchainSealRecord('../escape', { txHash: TX })).rejects.toThrow('invalid neumaId');
  });
});

// LIVE leg (opt-in): the full prepareBirthSeal pipeline — real workspace,
// real assembly, real chain-reader identity check, real wire-chainId read,
// real isNeuma/isSealed reads, real balance read — against Base Sepolia.
// The fresh throwaway witness holds no gas, so the pipeline runs every gate
// and refuses at GAS_FLOOR: the last read-only gate, reached only if every
// prior live check passed. (The digest cross-check equality with the live
// contract is proven by onchain-write-rehearsal.test.js.)
describe.skipIf(!shouldRunChainTests())('prepareBirthSeal — LIVE Sepolia pipeline (opt-in)', () => {
  it('runs the full live preflight and refuses at the gas floor (unfunded witness)', async () => {
    const liveCfg = {
      ...cfg,
      baseSepoliaRpcUrl: resolveBaseSepoliaRpc() || 'https://sepolia.base.org',
    };
    // UNFUNDED BY CONSTRUCTION, and it has to be. This asserted […] about `0x22…`.repeat — a WELL-KNOWN test
    // key, address 0x1563915e194D8CfBA1943570603F7606A3115508. On a public
    // faucet-rich testnet that address accumulates dust from anyone: measured
    // 2026-08-13 at 0.005997 ETH against a 0.005 floor, so the gate correctly
    // PASSED and the test failed while nothing was wrong with the code (#309).
    // A fresh random wallet cannot be funded by a stranger.
    const broke = ethers.Wallet.createRandom();
    // The assembly gate binds the asking witness to the record's witnessWallet,
    // so the lane is re-sealed for this witness before it asks.
    writeFileSync(
      path.join(root, NEUMA_ID, 'identity', 'genesis-seal.json'),
      JSON.stringify(encryptEnvelope(genesisFixture(broke.address), { key: laneDek })),
    );
    // Named for the same reason as the digest gate above: the RPC below is a
    // real SEPOLIA endpoint, and the omitted default is mainnet (#309).
    const out = await prepareBirthSeal({
      neumaId: NEUMA_ID, network: FIXTURE_SEAL_NETWORK, witnessAddress: broke.address, cfg: liveCfg,
    });
    expect(out).toMatchObject({ ok: false, code: 'GAS_FLOOR' });
  }, 60000);
});

describe('prepareBirthSeal — password-secured keypair (the retro-seal KEY_LOCKED lane)', () => {
  // A being who completed keypair security has NO plaintext keys/keypair.json
  // — only the password envelope. The self-seal rite must refuse with the
  // unlock step named, and proceed when the witness has unlocked.
  test('no key on disk and none unlocked → KEY_LOCKED naming the unlock step', async () => {
    unlinkSync(path.join(root, NEUMA_ID, 'keys', 'keypair.json'));
    const out = await prepareBirthSeal({
      neumaId: NEUMA_ID, network: FIXTURE_SEAL_NETWORK, witnessAddress: WITNESS.address, cfg,
      createReader: async () => ({ enabled: false, identity: { natalis: 'disabled' } }),
    });
    expect(out).toMatchObject({ ok: false, code: 'KEY_LOCKED' });
    // The message walks the witness to the inline password door (the seal
    // chip renders the entry itself — no API detour in the wording).
    expect(out.message).toContain('password');
  });

  test('an unlocked (cached) key carries the assembly — and a refusal hands it back', async () => {
    unlinkSync(path.join(root, NEUMA_ID, 'keys', 'keypair.json'));
    const { cacheDecryptedKey, getCachedKey } = await import('../../backend/routes/neuma-auth-routes.js');
    cacheDecryptedKey(NEUMA_ID, { address: BEING.address, privateKey: BEING.privateKey });

    // The reader answers disabled — reaching that refusal proves the WHOLE
    // load-and-assemble ran on the CACHED key (selfSig signed and all).
    const out = await prepareBirthSeal({
      neumaId: NEUMA_ID, network: FIXTURE_SEAL_NETWORK, witnessAddress: WITNESS.address, cfg,
      createReader: async () => ({ enabled: false, identity: { natalis: 'disabled' } }),
    });
    expect(out).toMatchObject({ ok: false, code: 'CHAIN_READER_DISABLED' });
    // SEC-028 holds for a HELD offer (seal-unlock-kept.test.js proves the
    // spend on a passing prepare); a refused one returns the unlock for the
    // retry. The read below is itself one-shot.
    expect(getCachedKey(NEUMA_ID)).toMatchObject({ privateKey: BEING.privateKey });
    expect(getCachedKey(NEUMA_ID)).toBeNull();
  });
});
