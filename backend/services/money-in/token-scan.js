// Token receipts — ERC-20 Transfer logs whose `to` topic is a house address,
// walked over a block range in chunks.
//
// One eth_getLogs per chunk covers every pinned token and every watched
// address at once: address = the token list, topics = [Transfer, any sender,
// any of our addresses]. Providers cap a log query's block span (some at
// 10 blocks, some at 10,000) and say so with an error, so the chunk ADAPTS:
// a refused chunk halves and retries, down to one block; the size that
// worked is handed back so the next scan starts there. A one-block chunk
// that still fails is a real failure, and the walk stops with the cursor at
// the last fully scanned block — never past a window it did not read.
//
// impure (RPC through the caller's chain-registry provider).

import { TRANSFER_TOPIC, addressTopic, decodeTransferLog } from './receipt-rows.js';
import { redactRpcUrl } from '../chain/chain-registry.js';

/** The chunk a fresh network starts with (blocks); evm-rpc's default window. */
export const START_CHUNK = 2_000;

/**
 * Walk Transfer logs to `addresses` from `fromBlock` to `toBlock`
 * inclusive. impure.
 * @param {object} args
 * @param {import('ethers').JsonRpcProvider} args.provider
 * @param {Array<{address: string}>} args.tokens - the pinned erc20 assets
 * @param {string[]} args.addresses - watched addresses
 * @param {number} args.fromBlock
 * @param {number} args.toBlock
 * @param {number} [args.chunk]
 * @returns {Promise<{ transfers: Array<{token: string, from: string, to: string, amountRaw: string,
 *   block: number, txHash: string, logIndex: number}>, scannedTo: number, chunk: number, error: string|null }>}
 */
export const walkTokenTransfers = async ({ provider, tokens, addresses, fromBlock, toBlock, chunk = START_CHUNK }) => {
  const transfers = [];
  if (tokens.length === 0 || addresses.length === 0 || toBlock < fromBlock) {
    return { transfers, scannedTo: toBlock, chunk, error: null };
  }
  const filterBase = {
    address: tokens.map((t) => t.address),
    topics: [TRANSFER_TOPIC, null, addresses.map(addressTopic)],
  };
  let size = Math.max(1, chunk);
  let from = fromBlock;
  while (from <= toBlock) {
    const to = Math.min(from + size - 1, toBlock);
    let logs;
    try {
      logs = await provider.getLogs({ ...filterBase, fromBlock: from, toBlock: to });
    } catch (err) {
      if (size > 1) { size = Math.max(1, Math.floor(size / 2)); continue; }
      return { transfers, scannedTo: from - 1, chunk: size, error: redactRpcUrl(err.message) };
    }
    for (const log of logs) {
      // A log that is not a well-formed ERC-20 Transfer is not money; the
      // `removed` flag marks a log a reorg took back.
      const decoded = log.removed ? null : decodeTransferLog(log);
      if (!decoded) continue;
      transfers.push({
        token: log.address, ...decoded, block: log.blockNumber, txHash: log.transactionHash, logIndex: log.index,
      });
    }
    from = to + 1;
  }
  return { transfers, scannedTo: toBlock, chunk: size, error: null };
};
