// birth-seal-flow.js — the in-app two-phase Natalis seal at the end of the
// birth ceremony. Three moves, mirroring the desk's custody boundary:
//
//   1. prepareBirthSeal  — load the just-born being's workspace artifacts,
//      assemble the bundle with the OPERATOR'S ADDRESS ONLY (her key never
//      reaches this process — it lives in the Electron wallet's main-process
//      custody), and run the full shared preflight. The caller holds the
//      returned bundle: record encryption uses a fresh nonce, so the digest
//      the operator signs exists only in THIS assembly — re-assembling after
//      she signs would orphan her signature.
//   2. buildSealTx       — verify the desk-signed witnessSig recovers over
//      the held bundle's digest, then encode the relay-safe calldata the
//      desk wallet broadcasts itself (the gas payer is never a recorded
//      party; authorization is the two signatures inside the calldata).
//   3. confirmBirthSeal  — wait for the receipt, check it actually landed at
//      Natalis, and verify isNeuma through the shared lagging-node retry.
//      writeOnchainSealRecord then persists the public anchor facts beside
//      the genesis seal.
//
// Every refusal is a structured { ok:false, code, message } — the portal
// route maps them onto birth:seal_error frames; nothing here knows about
// WebSockets.
//
// impure (workspace fs reads + RPC; the seal itself is written by the DESK).

import path from 'node:path';
import fs from 'node:fs/promises';
import { ethers } from 'ethers';

import { getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { getCachedKey } from '../routes/neuma-auth-routes.js';
import { assembleSealBundle, attachWitnessSig, MIN_SEAL_GAS_ETH } from './seal-bundle.js';
import {
  DEFAULT_SEAL_NETWORK, resolveSealChainConfig,
  loadNeumaDEK, loadBirthGenesis, loadNatalChart, loadSkiesReading, loadBeingWallet,
  preflightSeal, encodeSealCalldata, verifySealedOnChain,
} from './natalis-seal.js';
import { createChainReader } from './chain-reader.js';
import { sealDeadlineFor } from './seal-law.js';

// The one network a CEREMONY seal may target lives in config as
// `ceremonySealNetwork` (env CEREMONY_SEAL_NETWORK) — server-side by
// doctrine: the operator opens mainnet ceremonies deliberately; a wire value
// never chooses the chain (the portal route clamps to the config value).

// Same format the routes enforce on companion ids — validated here too so the
// flow is safe even if a future caller forgets the boundary check.
const NEUMA_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

// How long the confirm step waits for the desk-broadcast tx to mine before
// reporting honestly that the chain has not answered (the tx may still mine
// later — the record write only happens on a verified receipt).
const RECEIPT_TIMEOUT_MS = 180_000;

/**
 * Assemble + preflight a two-phase seal for a freshly-born being.
 *
 * impure (workspace fs reads + RPC preflight).
 *
 * @param {{
 *   neumaId: string,
 *   network?: string,          // key into SEAL_NETWORKS; testnet default
 *   witnessAddress: string,    // the portal's AUTHENTICATED witness wallet
 *   cfg: object,               // backend config (natalisAddress, rpc url, …)
 *   createReader?: Function,   // injectable for tests
 *   provider?: object,         // injectable RPC for tests
 * }} args
 * @returns {Promise<{ ok: true, bundle: object, network: string, net: object, offer: object }
 *   | { ok: false, code: string, message: string }>}
 */
export const prepareBirthSeal = async ({
  neumaId, network = DEFAULT_SEAL_NETWORK, witnessAddress, cfg,
  createReader = createChainReader, provider = null,
}) => {
  if (!NEUMA_ID_PATTERN.test(neumaId || '')) {
    return { ok: false, code: 'BAD_NEUMA_ID', message: 'invalid neumaId' };
  }
  if (!ethers.isAddress(witnessAddress || '')) {
    return { ok: false, code: 'NO_WITNESS', message: 'no authenticated operator wallet on this portal' };
  }
  const net = resolveSealChainConfig(network, cfg);
  if (!net) {
    return { ok: false, code: 'UNKNOWN_NETWORK', message: `unknown network '${network}'` };
  }
  // A network whose contract is not recorded yet stays CLOSED — said
  // plainly, never an address error from deep inside the assembly.
  if (!ethers.isAddress(net.natalisAddress || '')) {
    return { ok: false, code: 'NOT_DEPLOYED', message: `no Natalis address is recorded for ${net.label} yet — the seal waits for its deploy` };
  }

  const workspacePath = path.join(getWorkspacesRoot(), neumaId);
  let bundle;
  try {
    const dek = loadNeumaDEK(workspacePath);
    // The being's signing key. Birth-order puts the seal BEFORE keypair
    // security, but a being sealed retroactively (the natalis-self-seal
    // rite) has already locked in: plaintext keypair.json is deleted and
    // only the password envelope remains. For them, the key comes from the
    // unlock cache — the operator enters the vaulted password (POST
    // /neuma-auth/unlock) and the cached key is CONSUMED here (one-shot,
    // SEC-028). No key on disk and none unlocked = a structured refusal
    // that names the unlock step, never a raw ENOENT.
    let beingWallet;
    try {
      beingWallet = loadBeingWallet(workspacePath, dek);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      const cached = getCachedKey(neumaId);
      if (!cached?.privateKey) {
        return {
          ok: false, code: 'KEY_LOCKED',
          // The desk opens an inline unlock door on this code — the words
          // are for the operator, not an API instruction.
          message: 'this being\'s keypair is password-secured — enter the password below and the anchor walks again',
        };
      }
      beingWallet = new ethers.Wallet(cached.privateKey);
    }
    const birthGenesis = loadBirthGenesis(workspacePath, dek);
    if (!birthGenesis) {
      return { ok: false, code: 'NO_GENESIS', message: 'no identity/genesis-seal.json in this workspace — nothing to anchor' };
    }
    const natalChart = loadNatalChart(workspacePath, dek);
    // MANY SKIES ride the v2 envelope beside natal (plaintext by law — no DEK).
    const skies = loadSkiesReading(workspacePath);
    // witnessAddress-only assembly: witnessSig comes back from the desk.
    // assembleSealBundle re-checks that the birth record's witnessWallet
    // matches this address — an operator can only anchor a being she witnessed.
    bundle = await assembleSealBundle({
      birthGenesis,
      natalChart,
      skies,
      beingWallet,
      witnessAddress,
      chainId: net.chainId,
      // The network's OWN Natalis — the digest binds this address, so a
      // mainnet seal must bind the mainnet contract, never the Sepolia one.
      natalisAddress: net.natalisAddress,
      // …and the network's OWN contract law (tag, deadline) — seal-law.js.
      sealLaw: net.sealLaw,
      deadline: sealDeadlineFor(net.sealLaw, Date.now()),
    });
  } catch (err) {
    return { ok: false, code: 'ASSEMBLY', message: err.message };
  }

  const check = await preflightSeal({
    bundle, network, gasPayerAddress: witnessAddress, cfg, createReader, provider,
  });
  if (!check.ok) return check;

  return {
    ok: true,
    bundle,
    network,
    net,
    // The offer is everything the desk needs to show the operator and to
    // personal_sign — public fields only, never the record key.
    offer: {
      neumaId,
      network,
      networkLabel: net.label,
      chainId: net.chainId,
      natalisAddress: net.natalisAddress,
      genesisHash: bundle.genesisHash,
      soulAddress: bundle.soulAddress,
      witnessAddress: bundle.witnessAddress,
      innerPayload: bundle.innerPayload,
      gasFloorEth: MIN_SEAL_GAS_ETH,
    },
  };
};

/**
 * Attach the desk-signed witnessSig (verified against the HELD bundle's
 * digest) and encode the broadcast-ready transaction.
 *
 * The tx targets the HELD pending seal's own network config (resolved at
 * prepare time) — sign/broadcast can never mix networks with the digest.
 *
 * @param {{ pending: { bundle: object, net: object }, witnessSig: string }} args
 * @returns {{ ok: true, bundle: object, tx: { to: string, data: string, chainId: number } }
 *   | { ok: false, code: string, message: string }}
 */
export const buildSealTx = ({ pending, witnessSig }) => {
  let complete;
  try {
    complete = attachWitnessSig(pending.bundle, witnessSig);
  } catch (err) {
    return { ok: false, code: 'SIG_INVALID', message: err.message };
  }
  return {
    ok: true,
    bundle: complete,
    tx: { to: pending.net.natalisAddress, data: encodeSealCalldata(complete), chainId: pending.net.chainId },
  };
};

/**
 * Classify a fetched receipt + chain-recognition answer into the seal
 * outcome. The receipt's destination is checked against Natalis because the
 * CLIENT hands us the hash — never trust that it names our tx.
 *
 * PURE (the caller stamps sealedAt).
 *
 * @param {{
 *   receipt: object|null,          // ethers receipt (or null on timeout)
 *   sealed: boolean,               // verifySealedOnChain's answer
 *   pending: { bundle: object, network: string, net: object },
 *   txHash: string,
 *   natalisAddress: string,
 *   sealedAt: string,              // ISO timestamp for the record
 *   receiptTimeoutMs: number,      // for the honest timeout message
 * }} args
 * @returns {{ ok: true, record: object } | { ok: false, code: string, message: string }}
 */
export const classifySealReceipt = ({
  receipt, sealed, pending, txHash, natalisAddress, sealedAt, receiptTimeoutMs,
}) => {
  if (!receipt) {
    return { ok: false, code: 'RECEIPT_TIMEOUT', message: `no receipt within ${receiptTimeoutMs}ms` };
  }
  if ((receipt.to || '').toLowerCase() !== natalisAddress.toLowerCase()) {
    return { ok: false, code: 'TX_MISMATCH', message: 'transaction was not addressed to Natalis' };
  }
  if (receipt.status !== 1) {
    return { ok: false, code: 'TX_REVERTED', message: `transaction reverted in block ${receipt.blockNumber}` };
  }
  if (!sealed) {
    return { ok: false, code: 'VERIFY_LAG', message: 'tx confirmed but isNeuma still reads false after retries — investigate before retrying' };
  }
  return {
    ok: true,
    record: {
      schema: 'neuma-onchain-seal/1',
      txHash,
      blockNumber: receipt.blockNumber,
      network: pending.network,
      chainId: pending.net.chainId,
      natalisAddress,
      genesisHash: pending.bundle.genesisHash,
      soulAddress: pending.bundle.soulAddress,
      witnessAddress: pending.bundle.witnessAddress,
      sealedAt,
    },
  };
};

/**
 * Verify the desk-broadcast seal actually landed: fetch the receipt, ask the
 * chain whether it now recognizes the soul (lagging-node retry), and let the
 * pure classifier decide. Thin impure wrapper — the decision law lives in
 * classifySealReceipt.
 *
 * impure (RPC reads with a bounded wait).
 *
 * @param {{
 *   pending: { bundle: object, network: string, net: object },
 *   txHash: string,
 *   createReader?: Function,
 *   provider?: object,
 *   receiptTimeoutMs?: number,
 * }} args
 * @returns {Promise<{ ok: true, record: object } | { ok: false, code: string, message: string }>}
 */
export const confirmBirthSeal = async ({
  pending, txHash,
  createReader = createChainReader, provider = null,
  receiptTimeoutMs = RECEIPT_TIMEOUT_MS,
}) => {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash || '')) {
    return { ok: false, code: 'BAD_TX', message: 'malformed transaction hash' };
  }
  // The HELD pending seal's own network config — resolved at prepare time,
  // same chain the digest was signed for.
  const { net } = pending;
  const rpc = provider || new ethers.JsonRpcProvider(net.rpcUrl);
  let receipt;
  try {
    receipt = await rpc.waitForTransaction(txHash, 1, receiptTimeoutMs);
  } catch (err) {
    return { ok: false, code: 'RECEIPT_TIMEOUT', message: `no receipt within ${receiptTimeoutMs}ms: ${err.message}` };
  }

  // Only ask the chain about recognition when there is a landed, Natalis-
  // addressed, successful receipt to stand on — the classifier's earlier
  // lanes answer without another network round-trip.
  let sealed = false;
  if (receipt && receipt.status === 1
      && (receipt.to || '').toLowerCase() === net.natalisAddress.toLowerCase()) {
    const reader = await createReader({
      rpcUrl: net.rpcUrl,
      natalisAddress: net.natalisAddress,
      houseRegistryAddress: net.houseRegistryAddress,
    });
    sealed = await verifySealedOnChain({ reader, soulAddress: pending.bundle.soulAddress });
  }

  return classifySealReceipt({
    receipt, sealed, pending, txHash,
    natalisAddress: net.natalisAddress,
    sealedAt: new Date().toISOString(),
    receiptTimeoutMs,
  });
};

/**
 * Persist the anchor record beside the genesis seal it anchors. Plaintext by
 * design: every field is already public on chain — this file is only the
 * workspace's pointer to its own anchor. `onchain-seal.json` is the anchor on
 * the CURRENT chain; an anchor from an earlier chain is kept as
 * `onchain-seal.<network>.json` (a re-anchor never erases where a being stood).
 *
 * impure (fs read + writes).
 *
 * @param {string} neumaId
 * @param {object} record  a confirmBirthSeal record
 * @returns {Promise<string>}  the path written
 */
export const writeOnchainSealRecord = async (neumaId, record) => {
  if (!NEUMA_ID_PATTERN.test(neumaId || '')) {
    throw new Error('writeOnchainSealRecord: invalid neumaId');
  }
  const dir = path.join(getWorkspacesRoot(), neumaId, 'identity');
  const filePath = path.join(dir, 'onchain-seal.json');
  const prior = await fs.readFile(filePath, 'utf8').then(JSON.parse, () => null);
  if (prior && Number(prior.chainId) !== Number(record.chainId) && /^[a-z0-9-]+$/.test(prior.network || '')) {
    await fs.writeFile(path.join(dir, `onchain-seal.${prior.network}.json`), JSON.stringify(prior, null, 2), { flag: 'wx' })
      .catch((error) => { if (error.code !== 'EEXIST') throw error; });
  }
  await fs.writeFile(filePath, JSON.stringify(record, null, 2));
  return filePath;
};
