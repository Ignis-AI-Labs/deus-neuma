// Receipt proof — every money-in row is confirmed by a SECOND, independent
// node before it enters the ledger (audit P6-43). The scan reads one node; a
// node that lies can hand it a transfer that never happened, and the ledger
// is what marks invoices paid and closes a raise. So each row found is asked
// for again elsewhere: the same transaction, mined in the same block, moving
// the same amount of the same asset between the same two addresses, and at
// least the network's confirmation depth under THAT node's own head.
//
// Nothing here guesses: a row the second node does not show, shows
// differently, or shows too fresh is not confirmed, and the scan keeps its
// place and asks again next time.
//
// READ-ONLY: receipt, transaction, block number and chain id — no signer.
//
// impure (RPC).

import { decodeTransferLog } from './receipt-rows.js';
import { secondSourceFor, secondSourceEnvName } from '../chain/second-source.js';
import { chainEntry, redactRpcUrl } from '../chain/chain-registry.js';

const lower = (v) => String(v ?? '').toLowerCase();

// pure — does the second node's receipt carry this token row's own log?
const tokenRowShown = (row, receipt) => (receipt.logs ?? []).some((log) => {
  if (Number(log.logIndex) !== row.logIndex || lower(log.address) !== lower(row.token)) return false;
  const moved = decodeTransferLog(log);
  return Boolean(moved) && lower(moved.from) === lower(row.from) && lower(moved.to) === lower(row.to) && moved.amountRaw === row.amountRaw;
});

// impure — one row against the second node; null when it stands, else why not.
const rowRefusal = async (second, row, head, confirmations) => {
  if (row.block + confirmations > head) return 'the second node has not yet seen it deep enough';
  const receipt = await second.send('eth_getTransactionReceipt', [row.txHash]);
  if (!receipt || Number(receipt.status) !== 1 || Number(receipt.blockNumber) !== row.block) return 'the second node shows no such successful transaction in that block';
  if (row.assetKind === 'erc20') return tokenRowShown(row, receipt) ? null : 'the second node shows no such token transfer in that transaction';
  const tx = await second.send('eth_getTransactionByHash', [row.txHash]);
  const same = tx && lower(tx.to) === lower(row.to) && lower(tx.from) === lower(row.from) && BigInt(tx.value).toString() === row.amountRaw;
  return same ? null : 'the second node shows a different payment in that transaction';
};

/**
 * Confirm a network's fresh rows against its second source. Never throws.
 * impure.
 * @param {object} args
 * @param {object[]} args.rows - receipt rows of ONE network (receipt-rows.js makeReceipt)
 * @param {string} args.network - chain-registry key
 * @param {import('ethers').JsonRpcProvider} args.primary - the node the rows were read from
 * @param {number} args.confirmations
 * @param {Record<string, string|undefined>} [args.env]
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
export const confirmReceipts = async ({ rows, network, primary, confirmations, env = process.env }) => {
  if (rows.length === 0) return { ok: true };
  const second = secondSourceFor(network, primary, env);
  if (!second) return { ok: false, reason: `no second node to confirm ${network} receipts against — set ${secondSourceEnvName(network)} to another node's https address` };
  try {
    if (Number(await second.send('eth_chainId', [])) !== chainEntry(network).chainId) return { ok: false, reason: `the second ${network} node answers for another chain` };
    const head = Number(await second.send('eth_blockNumber', []));
    for (const row of rows) {
      const refusal = await rowRefusal(second, row, head, confirmations);
      if (refusal) return { ok: false, reason: `${row.amount} ${row.asset} in ${row.txHash}: ${refusal}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `the second ${network} node did not answer: ${redactRpcUrl(err.shortMessage || err.message)}` };
  } finally {
    second.destroy();
  }
};
