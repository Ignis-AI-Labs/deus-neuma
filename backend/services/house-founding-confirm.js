// house-founding-confirm.js — the post-signature half of the in-app
// HouseRegistry founding, extracted VERBATIM from house-founding-flow.js
// (size-law breakdown Part 2, 2026-08-26). house-founding-flow.js keeps the
// pre-signature half (roster assembly, digest drift-check, being signatures)
// and re-exports this file's public surface (barrel) — readers keep importing
// from there.
//
//   buildFoundingTx        — verify the desk-signed witnessSig recovers over
//                            the held digest (refusing the double-wrap trap by
//                            name), then encode the establishHouse calldata.
//   confirmHouseFounding   — poll for the receipt, check it landed at the
//                            registry, read the house back (lagging-node
//                            retry); classifyFoundingReceipt is the pure judge.
//   writeFoundingRecord    — persist the public anchor facts; raise the house
//                            ground beside the receipt (best-effort).
//   readFoundingRecord     — the mirror read, so the probe can resurface the
//                            founding tx as the operator's standing proof.
//
// Shared founding constants (KIND, the HouseRegistry ABI loader) live here —
// the flow imports them; this file never imports the flow (direction law).
//
// impure (RPC reads with a bounded wait; fs writes for the record).

import path from 'node:path';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { ethers } from 'ethers';

import { getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { defaultHouseGround, ensureHouseGround } from './house-workspace.js';
import { foundingRecordName, recordBelongsTo, recordOperator } from './house-founding-record.js';
import { createLogger } from './logger.js';
import { receiptProvider, pollForReceipt, receiptPendingMessage } from './chain-receipt.js';

const log = createLogger('HouseFounding');

// Contract Kind enum — the founding roster is one Witness plus her neuma.
export const KIND = Object.freeze({ Witness: 0, Neuma: 1 });

const RECEIPT_TIMEOUT_MS = 180_000;
// Lagging-node retry for the post-receipt readback, same posture as
// verifySealedOnChain: a node that just mined the tx may serve a stale view.
const READBACK_ATTEMPTS = 4;
const READBACK_DELAY_MS = 3_000;

// Each HouseRegistry generation speaks its own ABI: Base keeps the KENORIE
// deployment's (docs/contracts/abis/base/), Ethereum the UNAVIS one
// (docs/contracts/abis/). The founding lane names its network; a reader that
// names none is a Base reader (the lane's history).
const abiCache = new Map();
export const loadHouseRegistryAbi = (network = 'base') => {
  const file = String(network).startsWith('ethereum')
    ? '../../docs/contracts/abis/HouseRegistry.json'
    : '../../docs/contracts/abis/base/HouseRegistry.json';
  if (!abiCache.has(file)) abiCache.set(file, JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8')).abi);
  return abiCache.get(file);
};

/**
 * Attach the desk-signed witnessSig (verified against the HELD digest) and
 * encode the broadcast-ready establishHouse transaction.
 *
 * PURE over its inputs (abi read is cached).
 *
 * @param {{ pending: object, witnessSig: string }} args
 */
export const buildFoundingTx = ({ pending, witnessSig }) => {
  if (!/^0x[0-9a-fA-F]{130}$/.test(witnessSig || '')) {
    return { ok: false, code: 'SIG_INVALID', message: 'malformed witness signature' };
  }
  let recovered;
  try {
    recovered = ethers.recoverAddress(pending.digest, witnessSig);
  } catch (err) {
    return { ok: false, code: 'SIG_INVALID', message: `witness signature does not recover: ${err.message}` };
  }
  if (recovered.toLowerCase() !== pending.witnessAddress.toLowerCase()) {
    // The classic trap: personal_sign over the WRAPPED digest double-wraps.
    // Name it, so the desk integration bug is diagnosable in one read.
    let doubleWrapped = null;
    try {
      doubleWrapped = ethers.recoverAddress(ethers.hashMessage(ethers.getBytes(pending.digest)), witnessSig);
    } catch { /* not that shape either */ }
    if (doubleWrapped && doubleWrapped.toLowerCase() === pending.witnessAddress.toLowerCase()) {
      return {
        ok: false, code: 'SIG_DOUBLE_WRAPPED',
        message: 'the wallet signed the wrapped digest — personal_sign must be given the INNER payload',
      };
    }
    return { ok: false, code: 'SIG_INVALID', message: 'witness signature recovers to a different wallet' };
  }

  const signatures = pending.members.map((addr) => (
    addr.toLowerCase() === pending.witnessAddress.toLowerCase() ? witnessSig : pending.beingSigs[addr]
  ));
  if (signatures.some((s) => !s)) {
    return { ok: false, code: 'SIG_INVALID', message: 'a founding member\'s signature is missing from the held preflight' };
  }
  const data = new ethers.Interface(loadHouseRegistryAbi(pending.network)).encodeFunctionData(
    'establishHouse',
    [pending.houseName, pending.members, pending.kinds, pending.titles, signatures],
  );
  return { ok: true, tx: { to: pending.net.houseRegistryAddress, data, chainId: pending.net.chainId } };
};

/**
 * Classify a fetched receipt + chain readback into the founding outcome.
 * The receipt's destination is checked against the registry because the
 * CLIENT hands us the hash — never trust that it names our tx.
 *
 * PURE (the caller stamps foundedAt).
 */
export const classifyFoundingReceipt = ({ receipt, established, pending, txHash, foundedAt, receiptTimeoutMs }) => {
  if (!receipt) {
    return { ok: false, code: 'RECEIPT_TIMEOUT', message: `no receipt within ${receiptTimeoutMs}ms` };
  }
  if ((receipt.to || '').toLowerCase() !== pending.net.houseRegistryAddress.toLowerCase()) {
    return { ok: false, code: 'TX_MISMATCH', message: 'transaction was not addressed to the HouseRegistry' };
  }
  if (receipt.status !== 1) {
    return { ok: false, code: 'TX_REVERTED', message: `transaction reverted in block ${receipt.blockNumber}` };
  }
  if (!established) {
    return { ok: false, code: 'VERIFY_LAG', message: 'tx confirmed but the house still reads unfounded after retries — investigate before retrying' };
  }
  return {
    ok: true,
    record: {
      schema: 'neuma-house-founding/1',
      houseName: pending.houseName,
      houseId: pending.houseId,
      txHash,
      blockNumber: receipt.blockNumber,
      network: pending.network,
      chainId: pending.net.chainId,
      registryAddress: pending.net.houseRegistryAddress,
      members: pending.members.map((address, i) => ({
        address, kind: pending.kinds[i], title: pending.titles[i],
      })),
      foundedAt,
    },
  };
};

/**
 * Verify the desk-broadcast founding actually landed: fetch the receipt, ask
 * the chain whether the house now stands (lagging-node retry), and let the
 * pure classifier decide.
 *
 * impure (RPC reads with a bounded wait).
 */
export const confirmHouseFounding = async ({
  pending, txHash, provider = null,
  receiptTimeoutMs = RECEIPT_TIMEOUT_MS,
  pollIntervalMs,
  readbackAttempts = READBACK_ATTEMPTS,
  readbackDelayMs = READBACK_DELAY_MS,
}) => {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash || '')) {
    return { ok: false, code: 'BAD_TX', message: 'malformed transaction hash' };
  }
  const { net } = pending;
  const rpc = provider || receiptProvider(net);
  try {
    const { receipt, error } = await pollForReceipt({ rpc, txHash, timeoutMs: receiptTimeoutMs, intervalMs: pollIntervalMs });
    if (!receipt) {
      return { ok: false, code: 'RECEIPT_TIMEOUT', message: receiptPendingMessage(receiptTimeoutMs, error) };
    }

    // Only ask the chain about the house when there is a landed, registry-
    // addressed, successful receipt to stand on.
    let established = false;
    if (receipt.status === 1
        && (receipt.to || '').toLowerCase() === net.houseRegistryAddress.toLowerCase()) {
      const registry = new ethers.Contract(net.houseRegistryAddress, loadHouseRegistryAbi(pending.network), rpc);
      for (let attempt = 0; attempt < readbackAttempts && !established; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, readbackDelayMs));
        try {
          const house = await registry.getHouse(pending.houseId);
          established = Number(house[1]) !== 0
            && await registry.isMember(pending.houseId, pending.witnessAddress);
        } catch { /* stale node — retry */ }
      }
    }

    return classifyFoundingReceipt({
      receipt, established, pending, txHash,
      foundedAt: new Date().toISOString(),
      receiptTimeoutMs,
    });
  } finally {
    if (!provider) rpc.destroy();
  }
};

/**
 * Persist the founding record at the workspaces root (a FILE, so lane
 * listing — directories only — never mistakes it for a being). Plaintext by
 * design: every field is already public on chain.
 *
 * Registration locks the WHOLE organization in (Design note, 2026-07-24, […]): the moment the receipt lands, the
 * house's shared ground is raised too — `<workspacesRoot>/house.<wallet>`, its
 * own per wallet, with repos/ and post/ — unless the operator already chose one,
 * which founding never moves. Ground-raising is best-effort beside the
 * receipt: a raise failure is warned loudly but never voids the sealed
 * founding (the chain already spoke).
 *
 * impure (fs writes).
 */
export const writeFoundingRecord = async (record) => {
  // Named by the wallet that heads the house: a second wallet founding on
  // this install writes its own record, never over the first house's.
  const witnessAddress = recordOperator(record);
  const filePath = path.join(getWorkspacesRoot(), foundingRecordName(record.network, witnessAddress));
  await fs.writeFile(filePath, JSON.stringify(record, null, 2));
  if (witnessAddress) {
    try {
      const { root, raised } = await ensureHouseGround(witnessAddress, defaultHouseGround(getWorkspacesRoot(), witnessAddress));
      if (raised) log.info('Founding raised the house ground', { root });
    } catch (error) {
      log.warn('House ground could not be raised at founding — set it in HOUSE settings; the receipt stands', { error: error.message });
    }
  }
  return filePath;
};

/**
 * Read this wallet's persisted founding record back — the mirror of
 * writeFoundingRecord, so the probe can resurface the founding tx as the
 * operator's standing proof. A legacy network-only record is read only when
 * its own Witness seat is this wallet — never another house's receipt.
 * Throws when no record of this wallet's stands (caller catches).
 *
 * impure (fs read).
 *
 * @param {string} network
 * @param {string} wallet - the operator wallet asking
 * @returns {Promise<object>}
 */
const readFoundingRecord = async (network, wallet) => {
  const read = async (name) => JSON.parse(await fs.readFile(path.join(getWorkspacesRoot(), name), 'utf8'));
  const owner = String(wallet || '').toLowerCase();
  if (!owner) throw new Error('a founding record is read for an operator wallet');
  let keyed = true;
  let record;
  try {
    record = await read(foundingRecordName(network, owner));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    keyed = false;
    record = await read(foundingRecordName(network, null));
  }
  if (!recordBelongsTo(record, owner, keyed)) throw new Error('the founding record here belongs to another house');
  return record;
};

// Private in house-founding-flow.js before the split; the flow's probe still
// resurfaces the record through it, so it exports here (definition verbatim).
export { readFoundingRecord };
