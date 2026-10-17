// Spot USD prices for money-in rows — the SAME feed the wallet's price route
// reads (CoinGecko /simple/price, keyless), behind the SAME isolation door
// (NEUMA_COINGECKO_URL, read per call).
//
// Why spot and not the price at the receipt's block: the existing source
// serves spot prices only. CoinGecko's historical endpoints are daily or
// rate-bound on the keyless tier, and a figure at the wrong granularity
// labelled "historical" would be a quieter lie than an honest spot price
// labelled with WHEN it was read. So each priced row carries
// `price.basis = 'spot-at-detection'` and `price.priceAt`; its own
// `timestamp` is the block time, and the distance between the two is on
// view.
//
// Every failure returns no price for that id (the row's usd stays null) —
// never a stand-in figure, and stablecoins are not assumed to be $1.
//
// impure (network).

import { createLogger } from '../logger.js';

const log = createLogger('MoneyIn.Price');

const FETCH_MS = 6000;
const ID_RE = /^[a-z0-9-]{1,64}$/;

/** The feed's name as written on each row. */
export const PRICE_SOURCE = 'coingecko';

const feedBase = () => process.env.NEUMA_COINGECKO_URL || 'https://api.coingecko.com/api/v3';

/**
 * Spot USD for a set of CoinGecko ids. impure.
 * @param {string[]} ids
 * @returns {Promise<Record<string, number>>} only the ids that priced
 */
export const spotUsd = async (ids) => {
  const wanted = [...new Set(ids)].filter((id) => ID_RE.test(id));
  if (wanted.length === 0) return {};
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const res = await fetch(`${feedBase()}/simple/price?ids=${encodeURIComponent(wanted.join(','))}&vs_currencies=usd`, {
      signal: ctrl.signal, headers: { accept: 'application/json' },
    });
    if (!res.ok) {
      log.warn('price feed HTTP error — rows stay unpriced', { status: res.status });
      return {};
    }
    const body = await res.json();
    const out = {};
    for (const id of wanted) {
      const usd = body?.[id]?.usd;
      // null first: Number(null) is 0, and a missing price must never read as $0.
      if (usd !== null && usd !== undefined && Number.isFinite(Number(usd))) out[id] = Number(usd);
    }
    return out;
  } catch (err) {
    log.warn('price feed unreachable — rows stay unpriced', { err: err?.message });
    return {};
  } finally {
    clearTimeout(timer);
  }
};
