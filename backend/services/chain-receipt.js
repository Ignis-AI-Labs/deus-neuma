// chain-receipt.js — the one bounded wait for a desk-broadcast transaction's
// receipt, shared by the ceremony seal and the house founding.
//
// ethers 6.15's waitForTransaction awaits its first block number inside an
// async Promise executor: an HTTP 5xx, a JSON-RPC error or a refused
// connection on that read rejects a promise no caller holds, and Node ends
// the process — moments after the operator paid gas. This wait asks for the
// receipt itself, each attempt caught and bounded, so a flaking RPC costs a
// retry and never the backend.
//
// impure (RPC reads + wall-clock waits).

import { ethers } from 'ethers';
import { redactRpcUrl } from './chain/chain-registry.js';

const POLL_INTERVAL_MS = 2_000;

/**
 * A provider for the chain the transaction was signed for. The network is
 * static: no startup chainId detection, so an RPC that is down never leaves
 * a detection retry loop running after the wait gives up. The caller
 * destroys it.
 *
 * @param {{ rpcUrl: string, chainId: number }} net
 * @returns {ethers.JsonRpcProvider}
 */
export const receiptProvider = (net) => new ethers.JsonRpcProvider(
  net.rpcUrl, ethers.Network.from(net.chainId), { staticNetwork: true },
);

// One receipt read raced against the time left, so an RPC that accepts the
// socket and never answers cannot hold the wait past its deadline. The race
// holds both promises, so a late rejection is handled, never left floating.
const readReceipt = (rpc, txHash, ms) => {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(resolve, ms, null); });
  return Promise.race([rpc.getTransactionReceipt(txHash), late]).finally(() => clearTimeout(timer));
};

/**
 * Poll for a transaction's receipt until it lands or the time runs out.
 * Always asks at least once; never throws — an RPC failure is remembered
 * (URL redacted: it can carry the operator's key) and the next poll retries.
 *
 * @param {{ rpc: object, txHash: string, timeoutMs: number, intervalMs?: number }} args
 * @returns {Promise<{ receipt: object|null, error: string|null }>}
 */
export const pollForReceipt = async ({ rpc, txHash, timeoutMs, intervalMs = POLL_INTERVAL_MS }) => {
  const deadline = Date.now() + timeoutMs;
  let error = null;
  for (;;) {
    try {
      const receipt = await readReceipt(rpc, txHash, Math.max(deadline - Date.now(), intervalMs));
      if (receipt) return { receipt, error: null };
      error = null;
    } catch (err) {
      error = redactRpcUrl(err.shortMessage || err.message);
    }
    const left = deadline - Date.now();
    if (left <= 0) return { receipt: null, error };
    await new Promise((resolve) => { setTimeout(resolve, Math.min(intervalMs, left)); });
  }
};

/**
 * The operator's words for a wait that ran out: the transaction was sent and
 * may still land, so this is a pending confirmation, never a failure.
 *
 * PURE.
 *
 * @param {number} timeoutMs
 * @param {string|null} error  the last RPC failure, if the RPC was failing
 * @returns {string}
 */
export const receiptPendingMessage = (timeoutMs, error) => (
  `sent — confirmation pending: no receipt within ${Math.round(timeoutMs / 1000)}s`
  + (error ? ` (the RPC answered: ${error})` : '')
  + '. Check again before sending anything new.'
);
