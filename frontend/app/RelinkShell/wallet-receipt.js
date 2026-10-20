// wallet-receipt.js — the full post-send breakdown. Capital never gets a
// partial readout: after a send, the wallet shows the COMPLETE on-chain truth
// of the transaction (value, gas used, effective price, fee, total debit,
// block, nonce, endpoints) read back through our own RPC — and a direct road
// to the same record on the network's explorer. The grammar is pure
// (raw RPC objects in → human breakdown out); only fetchTxBreakdown touches IO.

import { ethers } from 'ethers';
import { EXPLORER_BY_NETWORK as EXPLORERS, explorerName as knownExplorerName } from '../../utils/explorer.js';

/**
 * The explorer's name for the link text, from the same mapping as the links;
 * an unknown key names Base, where its link lands. Pure.
 * @param {string|null|undefined} networkKey
 * @returns {'ETHERSCAN'|'BASESCAN'}
 */
export const explorerName = (networkKey) => knownExplorerName(networkKey) || knownExplorerName('base');

/**
 * The explorer page for a transaction on the selected network. Unknown keys
 * fall to Base mainnet — home chain, never a dead link.
 * @param {string|null|undefined} networkKey
 * @param {string} hash
 * @returns {string}
 */
export const explorerTxUrl = (networkKey, hash) =>
  `${EXPLORERS[networkKey] || EXPLORERS.base}/tx/${hash}`;

/**
 * The explorer page for an address — the wallet's complete history, every
 * transaction it ever made, reviewable off-platform at all times.
 * @param {string|null|undefined} networkKey
 * @param {string} address
 * @returns {string}
 */
export const explorerAddressUrl = (networkKey, address) =>
  `${EXPLORERS[networkKey] || EXPLORERS.base}/address/${address}`;

const wei = (h) => { try { return h == null ? null : BigInt(h); } catch { return null; } };
const eth = (w) => (w == null ? null : ethers.formatEther(w));
const gwei = (w) => (w == null ? null : ethers.formatUnits(w, 'gwei'));
const int = (h) => { const w = wei(h); return w == null ? null : Number(w); };

/**
 * Assemble the human breakdown from the raw eth_getTransactionByHash +
 * eth_getTransactionReceipt objects. Pure: every field is derived or null —
 * nothing is invented, a missing receipt honestly reads as pending.
 * @param {{tx: object|null, receipt: object|null}} raw
 * @returns {{status: 'pending'|'success'|'reverted', from: string|null,
 *   to: string|null, nonce: number|null, block: number|null,
 *   valueEth: string|null, gasUsed: string|null, gasPriceGwei: string|null,
 *   feeEth: string|null, totalEth: string|null}}
 */
export const buildTxBreakdown = ({ tx, receipt }) => {
  const value = wei(tx?.value);
  const gasUsed = wei(receipt?.gasUsed);
  const gasPrice = wei(receipt?.effectiveGasPrice ?? tx?.gasPrice);
  const fee = gasUsed != null && gasPrice != null ? gasUsed * gasPrice : null;
  const total = fee != null && value != null ? value + fee : null;
  return {
    status: receipt == null ? 'pending' : (wei(receipt.status) === 1n ? 'success' : 'reverted'),
    from: tx?.from ?? receipt?.from ?? null,
    to: tx?.to ?? receipt?.to ?? null,
    nonce: int(tx?.nonce),
    block: int(receipt?.blockNumber),
    valueEth: eth(value),
    gasUsed: gasUsed != null ? gasUsed.toString() : null,
    gasPriceGwei: gwei(gasPrice),
    feeEth: eth(fee),
    totalEth: eth(total),
  };
};

/**
 * One live read of a transaction's current truth through our configured RPC.
 * Both legs degrade to null independently, so a still-propagating tx renders
 * as an honest pending breakdown rather than an error.
 * @param {string} hash
 * @returns {Promise<ReturnType<typeof buildTxBreakdown>>}
 */
// impure — two RPC reads. wallet-client is imported lazily: its module graph
// needs a window, and the pure grammar above must stay importable anywhere.
export const fetchTxBreakdown = async (hash) => {
  const { readBaseRpc } = await import('./wallet-client.js');
  const [tx, receipt] = await Promise.all([
    readBaseRpc('eth_getTransactionByHash', [hash]).catch(() => null),
    readBaseRpc('eth_getTransactionReceipt', [hash]).catch(() => null),
  ]);
  return buildTxBreakdown({ tx, receipt });
};
