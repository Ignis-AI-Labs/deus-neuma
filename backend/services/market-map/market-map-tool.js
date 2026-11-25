// market-map-tool.js — market_map, the read a house member maps the field by
// (Design note, 2026-11-14. Read-only and public, like lp_market: it runs ahead of any
// mode check, nothing signed. Offered to any house member's own seat (an LP
// wallet is not needed to research) while the Market data connection is on.
// Dispatched beside the LP reads (umbrae-lp/lp-being-tools.js).

import { isConnectionOn } from '../connections/connection-switches.js';
import { seatOf } from '../flight-check.js';
import { MARKET_DATA_CONNECTION } from './market-data.js';
import { fieldMap, newPoolsMap, tokenMap, yieldMap } from './market-map.js';

export const MARKET_MAP_TOOL = Object.freeze({
  name: 'market_map',
  server: 'wallet',
  description: 'Map the market OUTSIDE Umbrae to find where money can be made, then bring it home. No args: Base\'s busiest pools on every DEX, what is trending, and the UMBRAE GAPS: pairs with real trading and no Umbrae pool, each with the lp/create-pool that would plan one. {network}: the same for any network (eth, solana, arbitrum, robinhood, bsc…). {network, new: true}: its newest pools (early and risky). {token, chain?}: every market a token trades in, on every chain (symbol, name or address). {yields: true, chain?, project?, symbol?, minTvlUsd?, stable?, limit?}: yields across every chain and protocol, highest first. Pools whose volume comes from a few huge trades are marked SUSPECT. Read-only, signs nothing.',
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      network: Object.freeze({ type: 'string', description: 'GeckoTerminal network id; default base' }),
      new: Object.freeze({ type: 'boolean', description: 'the network\'s newest pools' }),
      token: Object.freeze({ type: 'string', description: 'a token symbol, name or address: every market it trades in' }),
      chain: Object.freeze({ type: 'string', description: 'for a token address: its chain (DexScreener id); for yields: a chain name (Base, Ethereum…)' }),
      yields: Object.freeze({ type: 'boolean', description: 'yields across every chain and protocol' }),
      project: Object.freeze({ type: 'string', description: 'for yields: a protocol (aerodrome, uniswap-v3, aave…)' }),
      symbol: Object.freeze({ type: 'string', description: 'for yields: a token or pair (USDC, WETH-USDC…)' }),
      minTvlUsd: Object.freeze({ type: 'number', description: 'for yields: the least TVL, default 1,000,000' }),
      stable: Object.freeze({ type: 'boolean', description: 'for yields: stablecoin pools only (true) or none (false)' }),
      limit: Object.freeze({ type: 'integer', description: 'for yields: how many, 1 to 50 (default 15)' }),
    }),
  }),
});

/** Offered to a house member's own seat while Market data is on. Pure but for the switch read. */
export const marketMapToolsFor = (connection) => (
  connection?.companion?.neumaId && seatOf(connection) !== 'witness' && isConnectionOn(MARKET_DATA_CONNECTION) ? [MARKET_MAP_TOOL] : []);

/**
 * Answer one market_map call. impure — reads the market; never throws.
 * @param {object} args
 * @returns {Promise<string>}
 */
export const answerMarketMap = async (args = {}) => {
  const network = typeof args.network === 'string' && args.network.trim() ? args.network.trim().toLowerCase() : 'base';
  try {
    if (args.yields === true) {
      return await yieldMap({
        chain: args.chain, project: args.project, symbol: args.symbol, stable: typeof args.stable === 'boolean' ? args.stable : undefined,
        minTvlUsd: Number.isFinite(Number(args.minTvlUsd)) ? Number(args.minTvlUsd) : undefined,
        limit: Number.isInteger(Number(args.limit)) ? Number(args.limit) : undefined,
      });
    }
    if (typeof args.token === 'string' && args.token.trim()) return await tokenMap({ token: args.token.trim(), chain: (args.chain || 'base').toLowerCase() });
    if (args.new === true) return await newPoolsMap({ network });
    return await fieldMap({ network });
  } catch (err) {
    return `The market map stopped: ${err.message}`;
  }
};
