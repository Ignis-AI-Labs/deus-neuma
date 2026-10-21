// wallet-portfolio-load.js — assemble a wallet's full portfolio. impure
// orchestration that sits ABOVE the clients (importing it into wallet-client.js
// would cycle, since wallet-tokens reads through wallet-client): read non-zero
// token balances in one Multicall3 call, price the native ETH (the /eth
// primitive) and the tokens (one /tokens call), then hand it all to the PURE
// buildPortfolio. Lives outside WalletApp so the composition is unit-testable
// and reviewable on its own.

import { listTokenBalances } from './wallet-tokens.js';
import { fetchEthPrice, fetchTokenPrices } from './wallet-prices.js';
import { buildPortfolio } from './wallet-portfolio.js';

/**
 * Assemble {rows, usdTotal, change24h} for an address: native ETH first, then
 * every non-zero curated token. Honest by construction — an unpriced holding
 * carries usd:null (via buildPortfolio), never a fabricated value.
 * @param {string} address the wallet address to read
 * @param {string|number|null} ethBalanceEth native ETH balance (already read), or null if unknown
 * @param {{tokens?: boolean}} [opts] tokens: false skips the token read (the
 *   balance came from another network than the one the token read would use)
 * @returns {Promise<Readonly<{rows:Array,usdTotal:(number|null),change24h:(number|null)}>|null>}
 */
export const buildWalletPortfolio = async (address, ethBalanceEth, { tokens: readTokens = true } = {}) => {
  if (!address) return null;
  // Each leaf read degrades internally (→ [] / null / {}) and never throws, so
  // Promise.all is safe: one failing feed cannot reject the whole build.
  const [tokens, ethPrice] = await Promise.all([readTokens ? listTokenBalances(address) : [], fetchEthPrice()]);
  const tokenPrices = await fetchTokenPrices(tokens.map((t) => t.coingeckoId));
  // Pure composition — ETH-first ordering is structural, not procedural.
  const ethHolding = ethBalanceEth != null ? [{ symbol: 'ETH', balance: ethBalanceEth, price: ethPrice }] : [];
  const tokenHoldings = tokens.map((t) => ({
    symbol: t.symbol,
    balance: t.balance,
    price: tokenPrices[t.coingeckoId] || null,
  }));
  return buildPortfolio([...ethHolding, ...tokenHoldings]);
};
