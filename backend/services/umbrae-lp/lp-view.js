// lp-view.js — what a house member (and its operator) can read about its LP
// wallet: the address to fund, what it holds, the budget, what waits for the
// operator, and its positions on Umbrae. Read-only: nothing here signs.

import { isConnectionOn } from '../connections/connection-switches.js';
import { ethers } from 'ethers';
import { readHoldings } from './lp-holdings.js';
import { bookTick, bookLines } from './lp-book.js';
import { callUmbrae, UMBRAE_LP_CONNECTION } from './umbrae-lp-client.js';
import { lpWalletAddress, readUmbraeKey } from './lp-wallet.js';
import { readLpBudget, listPendingDeposits } from './lp-budget.js';
import { houseRecipients } from './lp-house.js';
import { positionStrings } from '../../../core/wallet/lp-book-math.js';

// pure — one line per position, from Umbrae's positions answer.
// (amounts in whole tokens: Umbrae gives raw units with each token's decimals, lp-book-math.js positionStrings)
const brief = (v) => String(Number(Number(v).toPrecision(8)));
const positionLines = (pools) => pools.flatMap((pool) => (pool?.positions?.userPositions ?? []).map((p) => {
  const d = p.positionData ?? {};
  const s = positionStrings(pool, d);
  const name = pool.poolInfo?.name ?? pool.lbPairAddress;
  const [nameX, nameY] = String(pool.poolInfo?.name ?? '').split('-');
  const x = pool.poolInfo?.tokenX?.symbol ?? (nameX || 'X');
  const y = pool.poolInfo?.tokenY?.symbol ?? (nameY || 'Y');
  return `#${p.publicKey} in ${name} (${pool.lbPairAddress}): ${brief(s.x)} ${x} + ${brief(s.y)} ${y}, fees waiting ${brief(s.feeX)} ${x} + ${brief(s.feeY)} ${y}, bins ${d.lowerBinId}..${d.upperBinId}, pool now at bin ${pool.positions?.activeBin?.binId ?? '?'}`;
}));

/** At most this many pools are listed, and token balances read for theirs. */
const POOLS_SHOWN = 12;

// pure — Umbrae's pool list flattened to the fields a choice needs.
const flattenPools = (payload) => (Array.isArray(payload?.groups) ? payload.groups : []).flatMap((group) => (group.pairs ?? []).map((pair) => ({
  name: group.name, address: pair.address, binStep: pair.bin_step, tvlUsd: pair.liquidity, aprPct: pair.aprPct ?? null,
  tokens: [[pair.mint_x ?? group.mint_x, group.tokenX], [pair.mint_y ?? group.mint_y, group.tokenY]],
  prices: [group.tokenXPrice ?? null, group.tokenYPrice ?? null],
}))).filter((p) => ethers.isAddress(p.address)).slice(0, POOLS_SHOWN);

// impure — Umbrae's pool list (a public read), null when off or unanswered.
const readPoolList = async () => {
  if (!isConnectionOn(UMBRAE_LP_CONNECTION)) return null;
  const out = await callUmbrae('pools');
  return out.ok ? out.payload : null;
};

/**
 * The positions, or the plain reason they cannot be read now. impure — reads Umbrae with the member's key.
 * @param {string} neumaId
 * @returns {Promise<{pools?: Array<object>, note?: string}>}
 */
export const readPositions = async (neumaId) => {
  if (!isConnectionOn(UMBRAE_LP_CONNECTION)) return { note: 'not read: the Umbrae liquidity connection is off' };
  const key = await readUmbraeKey(neumaId);
  if (!key) return { note: 'none yet (the wallet signs in to Umbrae on its first action)' };
  const out = await callUmbrae('positions', { token: key, body: {} });
  if (!out.ok) return { note: `not read: ${out.error}` };
  return { pools: Array.isArray(out.payload) ? out.payload : [out.payload] };
};

/**
 * The LP wallet as a plain record, or null when the house member has none.
 * impure — reads the keys and config folders, Base, and Umbrae.
 *
 * @param {string} neumaId
 * @returns {Promise<null | Readonly<{address: string, balanceEth: string|null, budgetUsd: number|null,
 *   pending: Array<object>, positions: Array<object>|null, positionsNote: string|null, connectionOn: boolean,
 *   pools: Array<object>, tokens: Array<{token: string, symbol: string, amount: string, priceUsd: number|null}>|null,
 *   house: Array<object>, book: object|null, bookLines: string[]}>>}
 *   tokens — null when they could not be read; book — the earnings book (lp-book.js) as just looked at
 */
export const readLpView = async (neumaId) => {
  const address = await lpWalletAddress(neumaId);
  if (!address) return null;
  const payload = await readPoolList();
  const [holdings, budgetUsd, pending, held, house] = await Promise.all([
    readHoldings(address, { pools: payload ?? { groups: [] } }).catch(() => null),
    readLpBudget(neumaId),
    listPendingDeposits(neumaId),
    readPositions(neumaId),
    houseRecipients(neumaId).catch(() => []),
  ]);
  const pools = payload ? flattenPools(payload) : [];
  const eth = holdings?.find((h) => h.key === 'ETH');
  // The book is looked at only with what it is figured from: prices (the pool list) and the holdings; the
  // positions join when they were read. Without them it is not read, never shown as $0.
  const looked = payload && holdings ? await bookTick(neumaId, { holdings, positions: held.pools ?? null }).catch(() => null) : null;
  return Object.freeze({
    address, balanceEth: eth ? ethers.formatEther(eth.raw) : null, ethPriceUsd: eth?.priceUsd ?? null, budgetUsd, pending,
    positions: held.pools ?? null, positionsNote: held.note ?? null,
    connectionOn: isConnectionOn(UMBRAE_LP_CONNECTION),
    // Token balances are found through the pool list; without it they were not read.
    pools,
    tokens: payload && holdings ? holdings.filter((h) => h.key !== 'ETH' && BigInt(h.raw) > 0n).map((h) => ({ token: h.key, symbol: h.symbol, priceUsd: h.priceUsd, amount: ethers.formatUnits(h.raw, h.decimals) })) : null,
    house,
    book: looked ? { ...looked.figures, priced: Boolean(payload), journal: (looked.book.journal ?? []).slice(-12).reverse(), days: looked.book.days, pools: looked.book.pools } : null,
    bookLines: looked ? bookLines(looked.book, looked.figures) : [],
  });
};

/**
 * The LP wallet's lines for the house member's own wallet view. Pure.
 *
 * @param {object|null} view - from readLpView
 * @returns {string[]}
 */
export const lpViewLines = (view) => {
  if (!view) return [];
  const held = view.positions ? positionLines(view.positions) : [];
  const waiting = view.pending.map((r) => `${r.id}: ${r.action.type} in ${r.action.pool} for $${r.depositUsd} (${r.reason})`);
  return [
    '',
    'LP wallet (your second wallet, for liquidity on Umbrae only):',
    `  Address: ${view.address} — your operator funds it by sending to this address.`,
    `  ETH balance (pays gas): ${view.balanceEth ?? 'unavailable — Base did not answer'}`,
    `  Tokens: ${view.tokens === null ? 'not read (the pool list did not answer)' : view.tokens.length ? view.tokens.map((t) => `${t.amount} ${t.symbol}`).join(', ') : 'none'}`,
    `  Budget: ${view.budgetUsd === null ? 'no cap set; you deposit on your own' : `a $${view.budgetUsd} cap on positions at once; a deposit past it waits for your operator`}`,
    "  On your own: claim, withdraw, close; swap at the best of Umbrae's router and KyberSwap (lp/swap); send inside the house (lp/send); open a NEW pool Umbrae lacks and be its first liquidity (lp/create-pool, check: true first). What you take out or buy returns to this wallet.",
    `  House wallets you can send to: ${(view.house ?? []).length ? view.house.map((r) => `${r.name}${r.wallet === 'main' || r.wallet === 'liquidity' ? ` ${r.wallet}` : ''} ${r.address}`).join('; ') : 'none read'}`,
    ...(view.bookLines ?? []).map((line) => `  ${line}`),
    `  Positions: ${view.positionsNote ?? (held.length ? '' : 'none')}`,
    ...held.map((line) => `    ${line}`),
    `  Deposits waiting for your operator: ${waiting.length ? '' : 'none'}`,
    ...waiting.map((line) => `    ${line}`),
    ...(view.pools.length ? ['  Pools on Umbrae (name, address, bin step, TVL, trailing APR):',
      ...view.pools.map((p) => `    ${p.name} ${p.address} step ${p.binStep}, $${Number.isFinite(Number(p.tvlUsd)) ? Number(p.tvlUsd).toFixed(2) : '?'}, ${p.aprPct === null ? 'no APR yet' : `${Number(p.aprPct).toFixed(1)}%`}`)] : []),
    ...(view.connectionOn ? [] : ['  The Umbrae liquidity connection is off: your operator turns it on in Connections before you can act.']),
  ];
};
