// birth-seal-recovery.js — a seal that was SENT is checked, never sent again.
//
// The desk broadcasts the seal tx itself, then asks the backend to confirm
// it. If that confirmation runs out (the RPC was failing, the chain was
// slow, the socket or the backend went away), the being's anchor can still
// land on chain with no local record — and every later ANCHOR used to offer
// a fresh bundle: a second tx while the first was pending (paid, then
// reverted: one seal per soul), or ALREADY_SEALED forever once it landed.
//
//   markSealSent       — written before the wait: which tx went out, for
//                        which soul, on which chain.
//   recheckSentSeal    — on the next ANCHOR: the sent tx's receipt decides —
//                        landed (record it), still pending (say so, offer
//                        nothing), or dead (reverted / expired / dropped:
//                        the lane is open again).
//   recoverSealFromChain — the being's own seal on chain with no local trace
//                        of the tx: its GenesisSealed event names it.
//
// Every fact here is public on chain; the files are the lane's pointers.
//
// impure (lane fs + RPC reads).

import path from 'node:path';
import fs from 'node:fs/promises';
import { ethers } from 'ethers';

import { getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { writeJsonAtomic } from './user-realm.js';
import { confirmBirthSeal, classifySealReceipt } from './birth-seal-flow.js';
import {
  resolveSealChainConfig, loadNeumaDEK, loadBirthGenesis, loadNatalisAbi,
} from './natalis-seal.js';
import { createChainReader } from './chain-reader.js';
import { receiptProvider } from './chain-receipt.js';

const NEUMA_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
// A v3 bundle's signed deadline is checked against block time; past it by
// this much, the sent tx can no longer seal (the contract reverts it).
const DEADLINE_GRACE_S = 120;

const sentPath = (neumaId) => {
  if (!NEUMA_ID_PATTERN.test(neumaId || '')) throw new Error('seal-sent: invalid neumaId');
  return path.join(getWorkspacesRoot(), neumaId, 'identity', 'onchain-seal-sent.json');
};

/**
 * Record that the seal tx for this held bundle went out. A malformed hash is
 * not recorded (the confirm refuses it as BAD_TX). impure (atomic fs write).
 *
 * @param {string} neumaId
 * @param {{ pending: { network: string, net: object, bundle: object }, txHash: string }} sent
 * @returns {Promise<boolean>} whether a marker was written
 */
export const markSealSent = async (neumaId, { pending, txHash }) => {
  if (!TX_HASH_PATTERN.test(txHash || '')) return false;
  await writeJsonAtomic(sentPath(neumaId), {
    schema: 'neuma-onchain-seal-sent/1',
    txHash,
    network: pending.network,
    chainId: pending.net.chainId,
    natalisAddress: pending.net.natalisAddress,
    genesisHash: pending.bundle.genesisHash,
    soulAddress: pending.bundle.soulAddress,
    witnessAddress: pending.bundle.witnessAddress,
    deadline: pending.bundle.deadline ?? null,
    sentAt: new Date().toISOString(),
  });
  return true;
};

/** Forget the sent tx (it landed and is recorded, or it can never land). impure. */
export const clearSealSent = (neumaId) => fs.rm(sentPath(neumaId), { force: true });

const readSealSent = async (neumaId) => {
  try {
    return JSON.parse(await fs.readFile(sentPath(neumaId), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};

// Can the sent tx still land? Past a signed deadline it cannot; under a law
// that signs none, only a tx the chain no longer knows is dead. An RPC that
// cannot answer proves nothing — the tx stays pending. Shared with the
// founding's sent tx (house-founding-recovery.js).
export const sentTxIsDead = async (sent, net, provider, nowMs) => {
  if (sent.deadline) return Math.floor(nowMs / 1000) > sent.deadline + DEADLINE_GRACE_S;
  const rpc = provider || receiptProvider(net);
  try {
    return (await rpc.getTransaction(sent.txHash)) === null;
  } catch {
    return false;
  } finally {
    if (!provider) rpc.destroy();
  }
};

/**
 * Check the lane's sent seal tx, if there is one. One look at the receipt,
 * no wait.
 *
 * impure (lane fs + RPC reads).
 *
 * @param {{ neumaId: string, cfg: object, createReader?: Function, provider?: object, nowMs?: number }} args
 * @returns {Promise<null
 *   | { state: 'sealed', record: object, net: object }
 *   | { state: 'pending', message: string }
 *   | { state: 'open' }>}  null when no seal tx was sent
 */
export const recheckSentSeal = async ({
  neumaId, cfg, createReader = createChainReader, provider = null, nowMs = Date.now(),
}) => {
  const sent = await readSealSent(neumaId);
  if (!sent) return null;
  const net = resolveSealChainConfig(sent.network, cfg);
  const pending = {
    network: sent.network,
    net,
    bundle: { genesisHash: sent.genesisHash, soulAddress: sent.soulAddress, witnessAddress: sent.witnessAddress },
  };
  const outcome = await confirmBirthSeal({ pending, txHash: sent.txHash, createReader, provider, receiptTimeoutMs: 0 });
  if (outcome.ok) return { state: 'sealed', record: outcome.record, net };
  const stillPending = outcome.code === 'VERIFY_LAG'
    || (outcome.code === 'RECEIPT_TIMEOUT' && !(await sentTxIsDead(sent, net, provider, nowMs)));
  if (stillPending) {
    return {
      state: 'pending',
      message: `sent — confirmation pending: the seal transaction ${sent.txHash} is not confirmed yet, and nothing new is offered while it is pending. Press ANCHOR again to check.`,
    };
  }
  await clearSealSent(neumaId);
  return { state: 'open' };
};

/**
 * The being's own seal is on chain but the lane has no record of it and no
 * trace of the tx: read the anchor back. The verified Natalis (codehash-
 * checked reader) must hold THIS lane's genesis for THIS soul; its
 * GenesisSealed event names the tx and block.
 *
 * impure (lane fs + RPC reads).
 *
 * @param {{ neumaId: string, network: string, cfg: object, createReader?: Function, provider?: object }} args
 * @returns {Promise<{ ok: true, record: object, net: object } | null>}  null when the chain holds no seal of this lane
 */
export const recoverSealFromChain = async ({
  neumaId, network, cfg, createReader = createChainReader, provider = null,
}) => {
  const net = resolveSealChainConfig(network, cfg);
  const workspacePath = path.join(getWorkspacesRoot(), neumaId);
  const genesis = loadBirthGenesis(workspacePath, loadNeumaDEK(workspacePath));
  if (!net || !genesis) return null;
  const { canonicalRecord, genesisHash } = genesis;
  const soulAddress = (canonicalRecord.soulPublicKey
    ? ethers.computeAddress(canonicalRecord.soulPublicKey)
    : canonicalRecord.soulAddress || '').toLowerCase();

  const reader = await createReader({
    rpcUrl: net.rpcUrl, natalisAddress: net.natalisAddress, houseRegistryAddress: net.houseRegistryAddress,
  });
  const onChain = await reader.genesisOf(soulAddress);
  if (String(onChain || '').toLowerCase() !== genesisHash.toLowerCase()) return null;

  const natalis = new ethers.Interface(loadNatalisAbi(net.sealLaw));
  const rpc = provider || receiptProvider(net);
  try {
    const [log] = await rpc.getLogs({
      address: net.natalisAddress, fromBlock: 0, toBlock: 'latest',
      topics: natalis.encodeFilterTopics('GenesisSealed', [genesisHash, soulAddress]),
    });
    if (!log) return null;
    const receipt = await rpc.getTransactionReceipt(log.transactionHash);
    const { witness, sealedAt } = natalis.parseLog(log).args;
    const outcome = classifySealReceipt({
      receipt, sealed: true, txHash: log.transactionHash, natalisAddress: net.natalisAddress,
      pending: { network, net, bundle: { genesisHash, soulAddress, witnessAddress: witness.toLowerCase() } },
      sealedAt: new Date(Number(sealedAt) * 1000).toISOString(),
      receiptTimeoutMs: 0,
    });
    return outcome.ok ? { ok: true, record: outcome.record, net } : null;
  } finally {
    if (!provider) rpc.destroy();
  }
};
