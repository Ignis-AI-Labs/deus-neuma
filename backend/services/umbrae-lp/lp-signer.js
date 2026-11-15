// lp-signer.js — the only place a house member's LP wallet key signs.
//
// Two acts, each behind its own pure rule:
//   · a transaction (Umbrae-built, or a swap or send from lp-trade.js), signed
//     only when core/wallet/lp-tx-policy.js names it, only when it is the
//     action that was asked for, only when Base says it would succeed, and
//     only when its gas stays under a fixed ceiling;
//   · Umbrae's sign-in challenge, signed only when
//     core/wallet/lp-message-policy.js matches it whole.
//
// The signer never broadcasts and never talks to Umbrae: it returns signed
// bytes. The key arrives as an ethers signer held by the caller; nothing here
// reads, stores or logs it.

import { ethers } from 'ethers';
import { classifyLpTransaction, checkLpIntent, UMBRAE_BASE } from '../../../core/wallet/lp-tx-policy.js';
import { checkAgentAuthChallenge } from '../../../core/wallet/lp-message-policy.js';
import { redactRpcUrl } from '../chain/chain-registry.js';

/** The most gas one LP transaction may be signed to spend. Base position
 *  actions cost a small fraction of this; a fee reading far above it is wrong. */
export const MAX_GAS_COST_WEI = ethers.parseEther('0.002');

const refuse = (reason) => Object.freeze({ ok: false, reason });

/**
 * Sign one Umbrae-built transaction with the LP wallet. Never throws. impure
 * — reads nonce, fees and a gas estimate from Base.
 *
 * @param {{signer: ethers.Wallet, provider: ethers.Provider,
 *   tx: {to: string, data: string, chainId: number, value?: string}, asked: object,
 *   maxApprove?: Record<string, string>, tokens?: Set<string>, recipients?: Set<string>, maxGasCostWei?: bigint}} args
 *   tokens, recipients — the tokens Umbrae's pools trade and the addresses a send may reach (lp-tx-policy.js)
 *   asked — what was asked for (checkLpIntent); a transaction of another kind,
 *   size or position is not signed
 *   maxApprove — per token address, the largest raw allowance this deposit may grant
 * @returns {Promise<Readonly<{ok: true, verdict: object, signedTransaction: string, hash: string}
 *   | {ok: false, reason: string}>>}
 */
export const signLpTransaction = async ({ signer, provider, tx, asked, maxApprove, tokens, recipients, maxGasCostWei = MAX_GAS_COST_WEI } = {}) => {
  if (!signer?.address || !provider) return refuse('No LP wallet or Base connection was given.');
  const verdict = classifyLpTransaction(tx, { wallet: signer.address, maxApprove, tokens, recipients });
  if (!verdict.ok) return verdict;
  const intended = checkLpIntent(verdict, asked);
  if (!intended.ok) return intended;
  if (verdict.kind === 'deposit' || verdict.kind === 'exit') {
    const now = Math.floor(Date.now() / 1000);
    const deadline = BigInt(verdict.deadline);
    if (deadline < BigInt(now) || deadline > BigInt(now + 600)) return refuse('The position action has an expired or unbounded deadline.');
  }
  // ETH leaves only on a plain send to the house; the rule refused any other value.
  const value = verdict.action === 'send-eth' ? BigInt(verdict.amount) : 0n;
  let request;
  try {
    // The nonce is asked of the node directly: getTransactionCount answers from
    // a short cache, and two signatures inside it would share one nonce.
    const [nonceHex, fees, gas] = await Promise.all([
      provider.send('eth_getTransactionCount', [signer.address, 'pending']),
      provider.getFeeData(),
      provider.estimateGas({ from: signer.address, to: tx.to, data: tx.data, value }),
    ]);
    if (fees.maxFeePerGas === null || fees.maxPriorityFeePerGas === null) return refuse('Base gave no fee to pay.');
    const gasLimit = (gas * 12n) / 10n;
    if (gasLimit * fees.maxFeePerGas > maxGasCostWei) {
      return refuse(`The gas for this transaction could reach ${ethers.formatEther(gasLimit * fees.maxFeePerGas)} ETH, over the ${ethers.formatEther(maxGasCostWei)} ETH ceiling.`);
    }
    request = {
      type: 2, chainId: UMBRAE_BASE.chainId, to: tx.to, data: tx.data, value, nonce: Number(BigInt(nonceHex)), gasLimit,
      maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    };
  } catch (err) {
    return refuse(`Base would not run this transaction: ${redactRpcUrl(err.shortMessage || err.message)}`);
  }
  const signedTransaction = await signer.signTransaction(request);
  return Object.freeze({ ok: true, verdict, signedTransaction, hash: ethers.keccak256(signedTransaction) });
};

/**
 * Sign Umbrae's agent sign-in challenge with the LP wallet. Never throws.
 * impure — reads the clock.
 *
 * @param {{signer: ethers.Wallet, message: string}} args
 * @returns {Promise<Readonly<{ok: true, signature: string, timestamp: number, nonce: string}
 *   | {ok: false, reason: string}>>}
 */
export const signAgentAuth = async ({ signer, message } = {}) => {
  if (!signer?.address) return refuse('No LP wallet was given.');
  const checked = checkAgentAuthChallenge(message, { wallet: signer.address, nowMs: Date.now() });
  if (!checked.ok) return checked;
  return Object.freeze({ ok: true, signature: await signer.signMessage(message), timestamp: checked.timestamp, nonce: checked.nonce });
};
