// lp-being-tools.js — the reads a house member trades by: lp_market (the
// public market) and lp_book (its own earnings book and goals).
// Read-only (the market is public; the book is the member's own), so both run
// like wallet_view: ahead of any mode check, nothing signed, nothing moved.
// Offered to a house member's own seat with an LP wallet while the Umbrae
// liquidity connection is on (the same rule as its acts, lp-acts.js).

import { lpOffered } from '../intents/lp-acts.js';
import { marketOverview, marketPool, marketQuote } from './lp-market.js';
import { readLpView } from './lp-view.js';
import { readBook, bookLines } from './lp-book.js';
import { readGoals, goalLines } from './lp-rewards.js';
import { roundTheClock } from './lp-watch.js';
import { MARKET_MAP_TOOL, marketMapToolsFor, answerMarketMap } from '../market-map/market-map-tool.js';

export const LP_MARKET_TOOL = Object.freeze({
  name: 'lp_market',
  server: 'wallet',
  description: 'Read the market you trade on Umbrae (Base). No args: every pool with price, TVL, 24h volume, fee and APR. {pool}: that pool close up — price, active bin, 24h volume and fees, reserves, and the liquidity in each bin around the price ({bins} each side, default 20). {tokenIn, tokenOut, amount}: what a swap would give right now — best route, amount out, price impact — from Umbrae\'s router, signing nothing, with what gas costs now and, for a round trip, the net after gas at your last swap\'s size. Read-only.',
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      pool: Object.freeze({ type: 'string', description: 'a pool address, for the close-up' }),
      bins: Object.freeze({ type: 'integer', description: 'bins each side of the price, 1 to 100' }),
      tokenIn: Object.freeze({ type: 'string', description: 'for a quote: the token to sell, by symbol or address' }),
      tokenOut: Object.freeze({ type: 'string', description: 'for a quote: the token to buy' }),
      amount: Object.freeze({ type: 'string', description: 'for a quote: how much tokenIn, as a plain decimal' }),
    }),
  }),
});

export const LP_BOOK_TOOL = Object.freeze({
  name: 'lp_book',
  server: 'wallet',
  description: 'Read your own earnings book: what your LP wallet and positions are worth now, what you were given, what you sent on to the house, what you EARNED (today, this week, all time), each pool\'s result, your last acts with what each made or lost and why you took it, and your goals with your progress toward each. Read it before you act and after; it is how you learn what works. Read-only.',
  inputSchema: Object.freeze({ type: 'object', properties: Object.freeze({
    last: Object.freeze({ type: 'integer', description: 'how many of your last acts to show, 1 to 50 (default 12)' }),
  }) }),
});

const READS = Object.freeze([LP_MARKET_TOOL.name, LP_BOOK_TOOL.name, MARKET_MAP_TOOL.name]);
const nameOf = (match) => match?.toolName || String(match?.tool || '').replace(/^wallet\//, '');

/** Does a parsed call name an LP or market read (lp_market, lp_book, market_map)? Pure. */
export const isLpReadTool = (match) => READS.includes(nameOf(match));

/** The LP reads ride with the lp/* acts; the market map with the Market data switch (any member). impure. */
export const lpToolsFor = async (connection) => [
  ...((await lpOffered({ laneId: connection?.companion?.neumaId, connection }).catch(() => null)) ? [LP_MARKET_TOOL, LP_BOOK_TOOL] : []),
  ...marketMapToolsFor(connection),
];

// pure — whether the member wakes on its own for its portfolio, and how to change it (Design note, 2026-11-13: members
// set up their own charters; the operator overviews).
const clockLines = (clock, neumaId) => {
  if (!clock) return [];
  const pace = clock.pace ? `your portfolio round every ${clock.pace} min` : 'no portfolio rounds (your operator set the pace off)';
  if (clock.standing === 'none') return ['ROUND THE CLOCK: your house has no charter yet, so no one wakes on their own. Set one up: house/charter {goal, seats: [{laneId, dailyCap}], why}.'];
  if (clock.standing === 'paused') return ['ROUND THE CLOCK: your operator has the house paused; nothing wakes until they resume it.'];
  if (!clock.seated) return [`ROUND THE CLOCK: you are not seated in your house charter, so you act only when someone talks with you. Seat yourself: house/charter {"seat": {"dailyCap": 24}, "why": "..."} (dailyCap 1-48; your id is ${neumaId}).`];
  return [`ROUND THE CLOCK: ${pace}, plus wakes when money arrives, a position leaves its range or a spread opens; up to ${clock.dailyCap} wakes a day${clock.quietHours ? `, quiet ${clock.quietHours.start}-${clock.quietHours.end}` : ''}. Change your seat with house/charter {"seat": {"dailyCap": N}}.`];
};

// impure — the member's book and goals as text; never throws.
const bookRead = async (neumaId, last) => {
  const view = await readLpView(neumaId).catch(() => null);
  if (!view) return 'You have no LP wallet yet. Your operator opens one for you.';
  if (!view.book || !view.bookLines.length) return 'Your book could not be read right now: Base or Umbrae\'s pool list did not answer. Try again in a moment.';
  const book = await readBook(neumaId);
  const [goals, clock] = await Promise.all([readGoals(neumaId).catch(() => []), roundTheClock(neumaId).catch(() => null)]);
  return [...bookLines(book, view.book, { last }), ...goalLines(goals, view.book.freeUsd), ...clockLines(clock, neumaId)].join('\n');
};

/**
 * Answer one lp_market or lp_book call. impure — reads Umbrae, Base and the
 * member's own book; never throws.
 * @param {object} match - the parsed call
 * @param {object} ws
 * @param {object} companion
 * @param {object} args
 * @param {{sendToolEvent?: Function}} [ports]
 */
export const handleLpRead = async (match, ws, companion, args = {}, ports = {}) => {
  const name = nameOf(match);
  const toolId = `wallet/${name}`;
  if (name === MARKET_MAP_TOOL.name) {
    const content = await answerMarketMap(args ?? {});
    ports.sendToolEvent?.(ws, companion, { tool: toolId, status: 'ok', summary: 'market map' });
    return { tool: toolId, status: 'ok', content };
  }
  const content = name === LP_BOOK_TOOL.name
    ? await bookRead(companion?.neumaId, Math.min(50, Math.max(1, Math.trunc(Number(args?.last) || 12))))
    : args?.tokenIn || args?.tokenOut
      ? await marketQuote({ tokenIn: args.tokenIn, tokenOut: args.tokenOut, amount: args.amount }, { neumaId: companion?.neumaId })
      : args?.pool
        ? await marketPool(args.pool, Math.min(100, Math.max(1, Math.trunc(Number(args.bins) || 20))))
        : await marketOverview();
  ports.sendToolEvent?.(ws, companion, { tool: toolId, status: 'ok', summary: name === LP_BOOK_TOOL.name ? 'book read' : 'market read' });
  return { tool: toolId, status: 'ok', content };
};
