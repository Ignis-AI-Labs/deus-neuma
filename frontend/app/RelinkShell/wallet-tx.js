// wallet-tx.js — pure helpers for composing a witness send. No IO: every
// function is input → output, so the live send flow and the Base fork test
// build the exact same transaction bytes from the same code.

import { ethers } from 'ethers';

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

/**
 * True when `a` is a 0x-prefixed 20-byte hex address.
 * @param {string} a
 * @returns {boolean}
 */
export const isAddress = (a) => ADDRESS_RE.test((a || '').trim());

/**
 * Parse a human ETH amount to wei. Rejects empty, non-numeric, and non-positive
 * values so the caller never has to second-guess the result.
 * @param {string|number} amountEth
 * @returns {{ok:true,wei:bigint}|{ok:false,error:string}}
 */
export const parseEthToWei = (amountEth) => {
  const s = String(amountEth ?? '').trim();
  if (s === '') return { ok: false, error: 'Enter an amount.' };
  let wei;
  try {
    wei = ethers.parseEther(s);
  } catch {
    return { ok: false, error: 'Enter a valid ETH amount.' };
  }
  if (wei <= 0n) return { ok: false, error: 'Amount must be greater than zero.' };
  return { ok: true, wei };
};

/**
 * Validate a send form. When `balanceEth` is provided, the value (gas excluded —
 * the provider estimates gas at sign time) must not exceed it.
 * @param {{to:string,amountEth:string|number,balanceEth?:string|number|null}} form
 * @returns {{ok:true,wei:bigint}|{ok:false,error:string}}
 */
export const validateSendForm = ({ to, amountEth, balanceEth = null }) => {
  if (!isAddress(to)) return { ok: false, error: 'Enter a valid 0x recipient address.' };
  const parsed = parseEthToWei(amountEth);
  if (!parsed.ok) return parsed;
  if (balanceEth != null && Number.isFinite(Number(balanceEth))) {
    let balWei;
    try { balWei = ethers.parseEther(String(balanceEth)); } catch { balWei = null; }
    if (balWei != null && parsed.wei > balWei) {
      return { ok: false, error: 'Amount exceeds your balance.' };
    }
  }
  return { ok: true, wei: parsed.wei };
};

/**
 * Build the EIP-1193 `eth_sendTransaction` params object. `value` is a
 * 0x-prefixed hex wei string — the encoding every provider expects.
 * @param {{from:string,to:string,wei:bigint}} args
 * @returns {Readonly<{from:string,to:string,value:string}>}
 */
export const buildSendTx = ({ from, to, wei }) => Object.freeze({
  from,
  to,
  value: '0x' + wei.toString(16),
});

/**
 * Render an ETH amount as a compact human string: up to 6 decimals, trailing
 * zeros trimmed, never scientific notation. Pure display grammar.
 * @param {number} amt
 * @returns {string}
 */
export const trimEth = (amt) => {
  if (!Number.isFinite(amt) || amt <= 0) return '0';
  return amt.toFixed(6).replace(/\.?0+$/, '');
};

/**
 * Allocate a fraction of the balance for a send. The MAX case (fraction ≥ 1)
 * spends everything above the gas reserve — sending the literal full balance
 * always fails at sign time because the gas has nothing to come from. Partial
 * fractions are taken of the raw balance but still clamped under the reserve
 * ceiling, so no chip or slider position can ever compose an unsendable value.
 * @param {string|number|null} balanceEth
 * @param {number} fraction - 0..1 (≥1 = MAX)
 * @param {number} [reserveEth] - gas headroom MAX leaves untouched
 * @returns {string} human ETH amount ('0' when nothing is spendable)
 */
export const allocAmount = (balanceEth, fraction, reserveEth = 0) => {
  const b = Number(balanceEth);
  if (!Number.isFinite(b) || b <= 0 || !Number.isFinite(fraction) || fraction <= 0) return '0';
  const spendable = Math.max(0, b - reserveEth);
  const v = fraction >= 1 ? spendable : Math.min(b * fraction, spendable);
  return trimEth(v);
};

/**
 * The inverse instrument read: what fraction of the balance does this amount
 * allocate? Drives the slider position and the ALLOC readout — a gauge that
 * gauges. Clamped 0..1; 0 when either side is unusable.
 * @param {string|number} amountEth
 * @param {string|number|null} balanceEth
 * @returns {number}
 */
export const allocFraction = (amountEth, balanceEth) => {
  const a = Number(amountEth);
  const b = Number(balanceEth);
  if (!Number.isFinite(a) || a <= 0 || !Number.isFinite(b) || b <= 0) return 0;
  return Math.min(1, a / b);
};
