// wallet-prices.js — spot prices for the portfolio. impure.
//
// Prices are NOT on-chain data; they come from a public price feed proxied by our
// own backend (backend/routes/price-routes.js) so the request is same-origin
// (CSP connect-src 'self'), cached server-side, and auth-gated. Always degrades to
// null on any failure — the caller then renders "—", never a fabricated number.

import { normalizeEthPrice } from './wallet-price-value.js';
import { apiCall } from '../../utils/http.js';

/** @returns {Promise<{usd:number,change24h:number|null}|null>} */
export const fetchEthPrice = async () => {
  try {
    const body = await apiCall('GET', '/api/v1/prices/eth', {
      headers: { accept: 'application/json' },
      strictJson: true,
    });
    return normalizeEthPrice(body);
  } catch (err) {
    // An HTTP refusal is an expected degrade (null renders "—"), not a fault:
    // only a transport or parse failure earns the console breadcrumb.
    if (err?.http) return null;
    // Degrade to null (the UI shows "—"); surface the reason — no renderer logger,
    // so console.warn is the available channel (Rule 3: no silent failures).
    console.warn('ETH price fetch failed:', err?.message);
    return null;
  }
};

/**
 * Spot prices for a set of CoinGecko ids, in one request. Returns a map
 * { <id>: {usd, change24h} } containing only ids that resolved to a price;
 * degrades to {} on any failure (the caller then shows "—" for those holdings).
 * @param {string[]} ids
 * @returns {Promise<Record<string,{usd:number,change24h:number|null}>>}
 */
export const fetchTokenPrices = async (ids = []) => {
  const clean = [...new Set((ids || []).filter(Boolean))];
  if (clean.length === 0) return {};
  try {
    const body = await apiCall('GET', `/api/v1/prices/tokens?ids=${encodeURIComponent(clean.join(','))}`, {
      headers: { accept: 'application/json' },
      strictJson: true,
    });
    return body && typeof body === 'object' ? body : {};
  } catch (err) {
    // Same degrade discipline as fetchEthPrice: an HTTP refusal is silent.
    if (err?.http) return {};
    console.warn('Token price fetch failed:', err?.message);
    return {};
  }
};
