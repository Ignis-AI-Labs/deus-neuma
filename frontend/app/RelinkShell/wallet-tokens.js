// wallet-tokens.js — read ERC-20 balances for an owner in ONE Base RPC call.
//
// impure (reads through our Base RPC gateway, readBaseRpc). Uses Multicall3 —
// deployed at the same address on Base as every chain — so the whole curated list
// is a single eth_call: fewer round trips, reliable on the public node, and every
// balance is […]. Degrades to [] on any failure.

import { ethers } from 'ethers';
import { readBaseRpc } from './wallet-client.js';
import { BASE_TOKENS } from './base-tokens.js';

const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const erc20 = new ethers.Interface(['function balanceOf(address) view returns (uint256)']);
const mc3 = new ethers.Interface([
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) view returns ((bool success, bytes returnData)[])',
]);

/**
 * Read the owner's balance of each curated Base token in one Multicall3 call.
 * Returns only NON-ZERO holdings; `balance` is a decimal string in token units.
 * Each holding carries its `coingeckoId` so the caller can price it. Per-token
 * decode failures are skipped (allowFailure), never thrown.
 * @param {string} owner
 * @param {Array<{address:string,symbol:string,name:string,decimals:number,coingeckoId:string}>} [tokens=BASE_TOKENS]
 * @returns {Promise<Array<{address:string,symbol:string,name:string,decimals:number,coingeckoId:string,balance:string}>>}
 */
export const listTokenBalances = async (owner, tokens = BASE_TOKENS) => {
  if (!owner) return [];
  try {
    const calls = tokens.map((t) => ({
      target: t.address,
      allowFailure: true,
      callData: erc20.encodeFunctionData('balanceOf', [owner]),
    }));
    const data = mc3.encodeFunctionData('aggregate3', [calls]);
    const ret = await readBaseRpc('eth_call', [{ to: MULTICALL3, data }, 'latest']);
    const [results] = mc3.decodeFunctionResult('aggregate3', ret);

    const out = [];
    results.forEach((r, i) => {
      if (!r.success) return;
      let raw;
      try {
        raw = erc20.decodeFunctionResult('balanceOf', r.returnData)[0];
      } catch {
        return; // unexpected return shape — skip this token, never poison the list
      }
      if (raw > 0n) {
        const t = tokens[i];
        out.push({
          address: t.address,
          symbol: t.symbol,
          name: t.name,
          decimals: t.decimals,
          coingeckoId: t.coingeckoId,
          balance: ethers.formatUnits(raw, t.decimals),
        });
      }
    });
    return out;
  } catch {
    return [];
  }
};
