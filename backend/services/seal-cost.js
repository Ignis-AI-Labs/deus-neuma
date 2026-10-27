// seal-cost.js — what sealing a birth on Ethereum costs right now, and whether the operator's wallet holds it.
//
// A person who does not know Ethereum meets the seal's fee here, so the numbers are real: the measured gas
// of a seal times the network's live fee, and the wallet's real balance. Before the operator signs, the
// contract cannot estimate a seal (it checks both signatures), so the quote uses the measured top; once the
// transaction is whole, sealTxCost asks the chain itself. Measured 2026-10-05 against the live mainnet
// Natalis with the chain's own estimateGas (docs/protocols/identity/seal-bundle.md §4b): the compact record
// 3.6–3.7M gas, the hex record 12.1–13.0M.
//
// Wei travels as decimal strings (JSON has no bigint). impure where marked.

import { ethers } from 'ethers';
import { sealLawFor } from './seal-law.js';

const MEASURED_GAS = Object.freeze({ compact: 3_700_000n, hex: 13_000_000n });

// A house's founding on chain (establishHouse): 774k gas measured for a four-founder house (2026-07-11, the first
// real founding), rounded up. The quote before signing only; the chain's own estimate decides at the sign step.
export const FOUNDING_GAS = 800_000n;

/** The gas a seal under this contract law is measured to use (the top of the range). Pure. */
export const sealGasUnits = (sealLaw) => (sealLawFor(sealLaw)?.compactRecord ? MEASURED_GAS.compact : MEASURED_GAS.hex);

/**
 * The funding facts. `need` is what a node requires the wallet to hold before it accepts the transaction
 * (gas × the max fee per gas a wallet offers), never below `floor`; `likely` is what the seal will most
 * likely pay (gas × base fee + tip). Pure.
 * @param {{gasUnits: bigint, maxFeePerGas: bigint, likelyFeePerGas: bigint, balance: bigint, floor?: bigint}} f
 */
export const fundingFacts = ({ gasUnits, maxFeePerGas, likelyFeePerGas, balance, floor = 0n }) => {
  const quoted = gasUnits * maxFeePerGas;
  const need = quoted > floor ? quoted : floor;
  const short = balance >= need ? 0n : need - balance;
  return Object.freeze({
    gasUnits: String(gasUnits),
    needWei: String(need),
    likelyWei: String(gasUnits * likelyFeePerGas),
    balanceWei: String(balance),
    shortWei: String(short),
    enough: short === 0n,
  });
};

/** The refusal's words, for a person: what the wallet holds, what the seal needs, how much more. Pure. */
export const fundingWords = (facts) => {
  const eth = (wei) => Number(ethers.formatEther(wei)).toFixed(4);
  return `Your wallet ${facts.payer} holds ${eth(facts.balanceWei)} ETH; sealing on Ethereum needs about ${eth(facts.needWei)} ETH `
    + `right now (${eth(facts.shortWei)} more).`;
};

// impure — the live fee: what a wallet offers up front, and what a seal will most likely pay
const liveFees = async (rpc) => {
  const [fee, block] = await Promise.all([rpc.getFeeData(), rpc.getBlock('latest')]);
  const maxFeePerGas = fee.maxFeePerGas ?? fee.gasPrice;
  if (maxFeePerGas == null) throw new Error('the network quoted no fee');
  const tip = fee.maxPriorityFeePerGas ?? 0n;
  const likelyFeePerGas = block?.baseFeePerGas != null ? block.baseFeePerGas + tip : (fee.gasPrice ?? maxFeePerGas);
  return { maxFeePerGas, likelyFeePerGas };
};

/**
 * The quote before the operator signs: a seal's measured gas (or `gasUnits`, e.g. FOUNDING_GAS) × the live fee.
 * impure (RPC).
 * @param {{net: {rpcUrl: string, chainId: number, label: string, sealLaw: string}, network: string, payer: string, floor?: bigint, gasUnits?: bigint, provider?: object}} args
 */
export const sealCost = async ({ net, network, payer, floor = 0n, gasUnits = null, provider = null }) => {
  const rpc = provider || new ethers.JsonRpcProvider(net.rpcUrl);
  const [fees, balance] = await Promise.all([liveFees(rpc), rpc.getBalance(payer)]);
  return Object.freeze({
    network, networkLabel: net.label, chainId: net.chainId, payer: ethers.getAddress(payer),
    ...fundingFacts({ gasUnits: gasUnits ?? sealGasUnits(net.sealLaw), ...fees, balance, floor }),
  });
};

/**
 * The exact cost once the transaction is whole: the chain's own estimate for this calldata from this payer.
 * A seal the chain would revert throws here, before the wallet is asked to broadcast. impure (RPC).
 * @param {{net: object, network: string, tx: {to: string, data: string}, payer: string, provider?: object}} args
 */
export const sealTxCost = async ({ net, network, tx, payer, provider = null }) => {
  const rpc = provider || new ethers.JsonRpcProvider(net.rpcUrl);
  const [gasUnits, fees, balance] = await Promise.all([
    rpc.estimateGas({ from: payer, to: tx.to, data: tx.data }), liveFees(rpc), rpc.getBalance(payer),
  ]);
  return Object.freeze({
    network, networkLabel: net.label, chainId: net.chainId, payer: ethers.getAddress(payer),
    ...fundingFacts({ gasUnits, ...fees, balance }),
  });
};
