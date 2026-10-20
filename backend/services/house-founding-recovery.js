// house-founding-recovery.js — a founding that was SENT is checked, never
// offered again (the founding's twin of birth-seal-recovery.js).
//
// The desk broadcasts the establishHouse tx itself, then asks the backend to
// confirm it. If that confirmation runs out (RECEIPT_TIMEOUT: a slow chain, a
// failing RPC, a socket or backend gone), the next FOUND used to compose a
// fresh founding while the house still read unfounded — a second tx the
// operator signs and pays for, reverted once the first mines (NameTaken).
//
//   markFoundingSent    — written before the wait: which tx went out, for
//                         which house, on which chain.
//   readFoundingSent    — the operator's sent founding, or null.
//   recheckSentFounding — on the next FOUND: the sent tx's receipt decides —
//                         landed (its record), still pending (say so, offer
//                         nothing), or dead (reverted / dropped: open again).
//
// One file per operator wallet at the workspaces root — a FILE, so lane
// listing never mistakes it for a being, and never another house's. Every
// fact in it is public on chain.
//
// impure (workspaces-root fs + RPC reads).

import path from 'node:path';
import fs from 'node:fs/promises';
import { ethers } from 'ethers';

import { getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { writeJsonAtomic } from './user-realm.js';
import { confirmHouseFounding } from './house-founding-confirm.js';
import { resolveSealChainConfig } from './natalis-seal.js';
import { sentTxIsDead } from './birth-seal-recovery.js';

const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

const sentPath = (wallet) => {
  if (!ethers.isAddress(wallet || '')) throw new Error('founding-sent: invalid operator wallet');
  return path.join(getWorkspacesRoot(), `house-founding-sent.${wallet.toLowerCase()}.json`);
};

/**
 * Record that the founding tx for this held preflight went out. A malformed
 * hash is not recorded (the confirm refuses it as BAD_TX). impure (atomic fs write).
 *
 * @param {{ pending: object, txHash: string }} sent - the held founding and its tx
 * @returns {Promise<boolean>} whether a record was written
 */
export const markFoundingSent = async ({ pending, txHash }) => {
  if (!TX_HASH_PATTERN.test(txHash || '')) return false;
  await writeJsonAtomic(sentPath(pending.witnessAddress), {
    schema: 'neuma-house-founding-sent/1',
    txHash,
    network: pending.network,
    chainId: pending.net.chainId,
    registryAddress: pending.net.houseRegistryAddress,
    houseName: pending.houseName,
    houseId: pending.houseId,
    members: pending.members,
    kinds: pending.kinds,
    titles: pending.titles,
    witnessAddress: pending.witnessAddress,
    sentAt: new Date().toISOString(),
  });
  return true;
};

/** Forget the sent tx (it landed and is recorded, or it can never land). impure. */
export const clearFoundingSent = (wallet) => fs.rm(sentPath(wallet), { force: true });

/** The operator's sent founding, or null. impure (fs read). */
export const readFoundingSent = async (wallet) => {
  try {
    return JSON.parse(await fs.readFile(sentPath(wallet), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};

/**
 * Check the operator's sent founding tx, if there is one. One look at the
 * receipt, no wait. An RPC that cannot answer proves nothing — the tx stays
 * pending. impure (fs + RPC reads).
 *
 * @param {{ wallet: string, cfg: object, provider?: object }} args
 * @returns {Promise<null
 *   | { state: 'founded', record: object }
 *   | { state: 'pending', message: string }
 *   | { state: 'open' }>}  null when no founding tx was sent
 */
export const recheckSentFounding = async ({ wallet, cfg, provider = null }) => {
  const sent = await readFoundingSent(wallet);
  if (!sent) return null;
  // The registry the tx was sent to, whatever the config names today.
  const net = { ...resolveSealChainConfig(sent.network, cfg), houseRegistryAddress: sent.registryAddress };
  const pending = {
    houseName: sent.houseName, houseId: sent.houseId, network: sent.network, net,
    members: sent.members, kinds: sent.kinds, titles: sent.titles, witnessAddress: sent.witnessAddress,
  };
  const outcome = await confirmHouseFounding({ pending, txHash: sent.txHash, provider, receiptTimeoutMs: 0 });
  if (outcome.ok) return { state: 'founded', record: outcome.record };
  // A founding signs no deadline: only a tx the chain no longer knows is dead.
  const stillPending = outcome.code === 'VERIFY_LAG'
    || (outcome.code === 'RECEIPT_TIMEOUT' && !(await sentTxIsDead({ ...sent, deadline: null }, net, provider, Date.now())));
  if (stillPending) {
    return {
      state: 'pending',
      message: `sent — confirmation pending: the founding transaction ${sent.txHash} is not confirmed yet, and nothing new is offered while it is pending. Ask again to check.`,
    };
  }
  await clearFoundingSent(wallet);
  return { state: 'open' };
};
