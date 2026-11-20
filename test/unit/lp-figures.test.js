import { describe, test, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  positionRows, budgetBar, poolNamed, heldTokens, lpTotals, waitingLine, usd, nameCase, signedUsd, earnedBack, goalRows, lpPortfolioOf,
} from '../../frontend/app/RelinkShell/lp-figures.js';
import { WaitingCard } from '../../frontend/app/RelinkShell/WalletLiquidityCards.jsx';

const POOL = '0x1cc9f4498dc2c12e385bc417658f339acf820293';
const pool = (positions, active = 100) => [{
  lbPairAddress: POOL,
  positions: { userPositions: positions, activeBin: active === null ? undefined : { binId: active } },
  poolInfo: { name: 'WETH-USDC', tokenXPriceUsd: 3000, tokenYPriceUsd: 1 },
}];
const at = (lower, upper, extra = {}) => ({ publicKey: '7', positionData: { lowerBinId: lower, upperBinId: upper, totalXAmount: '0.001', totalYAmount: '2', feeX: '0', feeY: '0.5', ...extra } });

describe('lp-figures — the numbers behind the LIQUIDITY pictures', () => {
  test('a position is valued at the pool\'s prices, with its fees', () => {
    const [row] = positionRows(pool([at(90, 110)]));
    expect(row).toMatchObject({ id: '7', name: 'WETH-USDC', x: '0.001', y: '2', inRange: true });
    expect(row.usd).toBeCloseTo(5);
    expect(row.feesUsd).toBeCloseTo(0.5);
  });

  test('the range bar puts the pool\'s bin inside the band when in range, outside when not', () => {
    const [inside] = positionRows(pool([at(90, 110)], 100));
    expect(inside.range.at).toBeGreaterThan(inside.range.from);
    expect(inside.range.at).toBeLessThan(inside.range.to);
    const [below] = positionRows(pool([at(120, 140)], 100));
    expect(below.inRange).toBe(false);
    expect(below.range.at).toBeLessThan(below.range.from);
    for (const v of [below.range.from, below.range.to, below.range.at]) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(100);
    }
  });

  test('a pool with no active bin read has an unknown range state, never a guess', () => {
    const [row] = positionRows(pool([at(90, 110)], null));
    expect(row.inRange).toBeNull();
    expect(row.range.at).toBeNull();
  });

  test('positions, wallet and total read as null when not read; zero only when read as zero', () => {
    expect(lpTotals({ positions: null, tokens: null, pending: [] })).toEqual({ inPositions: null, inWallet: null, total: null, waiting: 0 });
    expect(lpTotals({ positions: [], tokens: [], pending: [] })).toEqual({ inPositions: 0, inWallet: 0, total: 0, waiting: 0 });
    const unpriced = lpTotals({ positions: [], tokens: [{ symbol: 'USDC', amount: '25', priceUsd: null }], pending: [] });
    expect(unpriced.inWallet).toBeNull();
    expect(unpriced.total).toBeNull();
    const full = lpTotals({ positions: pool([at(90, 110)]), tokens: [{ symbol: 'USDC', amount: '25', priceUsd: 1 }], pending: [{ depositUsd: '30.0' }] });
    expect(full.total).toBeCloseTo(30);
    expect(full.waiting).toBe(30);
  });

  test('the budget bar scales to whichever is larger, the budget or what is used and waiting', () => {
    expect(budgetBar({ budgetUsd: 10, inPositionsUsd: 5, waitingUsd: 0 })).toEqual({ scale: 10, used: 50, waiting: 0, budgetAt: 100, over: false });
    const past = budgetBar({ budgetUsd: 10, inPositionsUsd: 5, waitingUsd: 15 });
    expect(past.scale).toBe(20);
    expect(past.budgetAt).toBe(50);
    expect(budgetBar({ budgetUsd: 10, inPositionsUsd: 12, waitingUsd: 0 }).over).toBe(true);
    expect(budgetBar({ budgetUsd: null, inPositionsUsd: 0, waitingUsd: 0 })).toMatchObject({ budgetAt: null, scale: 1 });
  });

  test('a listed pool is named from the list; an unlisted one keeps its full address and verified symbols', () => {
    const pools = [{ address: POOL, name: 'WETH-USDC', tokens: [['0xa', 'WETH'], ['0xb', 'USDC']] }];
    expect(poolNamed(pools, POOL.toUpperCase().replace('0X', '0x'))).toEqual({ name: 'WETH-USDC', symbolX: 'WETH', symbolY: 'USDC', known: true });
    expect(poolNamed([], POOL, { tokenXSymbol: 'WETH', tokenYSymbol: 'USDC' })).toEqual({ name: POOL, symbolX: 'WETH', symbolY: 'USDC', known: false });
    expect(poolNamed([], POOL)).toEqual({ name: POOL, symbolX: '', symbolY: '', known: false });
  });

  test('a waiting deposit reads as what goes in and why it waits, zero sides left out', () => {
    const known = { name: 'WETH-USDC', symbolX: 'WETH', symbolY: 'USDC', known: true };
    const req = (reason, amountX = '0', amountY = '25') => ({ action: { amountX, amountY }, reason });
    expect(waitingLine(req('This deposit of $25.0 would take the total past the $10 budget.'), known, 10)).toBe('25 USDC · past the $10.00 budget');
    expect(waitingLine(req('No budget is set for this house member yet.', '0.01', '25'), known, null)).toBe('0.01 WETH + 25 USDC · no budget set');
    expect(waitingLine(req('No budget is set for this house member yet.', '0.01', '25'), { name: POOL, symbolX: 'WETH', symbolY: 'USDC', known: false }, null)).toBe('0.01 WETH + 25 USDC · no budget set');
    expect(waitingLine(req('The deposit could not be sized in dollars.'), { name: POOL, symbolX: '', symbolY: '', known: false }, 10)).toBe('25 · could not be sized in dollars');
  });

  test('held tokens are the non-zero ones, priced where a price is known', () => {
    expect(heldTokens([{ symbol: 'USDC', amount: '0.0', priceUsd: 1 }, { symbol: 'WETH', amount: '0.002', priceUsd: 3000 }, { symbol: 'U1', amount: '5', priceUsd: null }]))
      .toEqual([{ symbol: 'WETH', amount: '0.002', usd: 6 }, { symbol: 'U1', amount: '5', usd: null }]);
  });

  test('dollars to the cent, a dash when unread; names as a person reads them', () => {
    expect(usd(1234.5)).toBe('$1,234.50');
    expect(usd(null)).toBe('—');
    expect(nameCase('TENEKOM')).toBe('Tenekom');
    expect(nameCase('ROSE-MARIE')).toBe('Rose-Marie');
  });
});

describe('earnings and goals, as the desk draws them', () => {
  test('signed dollars, and what was earned since an earlier day', () => {
    expect(signedUsd(2.345)).toBe('+$2.35');
    expect(signedUsd(-0.5)).toBe('−$0.50');
    expect(signedUsd(undefined)).toBe('—');
    const days = { '2026-11-06': { earnedUsd: 1 }, '2026-11-12': { earnedUsd: 4 } };
    const now = new Date(2026, 10, 13, 15);
    expect(earnedBack(days, 10, 1, now)).toBe(6);
    expect(earnedBack(days, 10, 7, now)).toBe(9);
    expect(earnedBack(days, 10, 30, now)).toBeNull();
  });

  test('goals carry their progress; a request comes first, dropped goals leave', () => {
    const rows = goalRows([
      { id: 'a', what: 'GPU', costUsd: 100, status: 'working' },
      { id: 'b', what: 'Server', costUsd: 40, status: 'requested' },
      { id: 'c', what: 'Old', costUsd: 5, status: 'dropped' },
      { id: 'd', what: 'Model', costUsd: 10, status: 'delivered' },
    ], 50);
    expect(rows.map((g) => [g.id, g.pct])).toEqual([['b', 100], ['a', 50], ['d', 100]]);
    expect(goalRows([{ id: 'a', costUsd: 10, status: 'working' }], -5)[0].pct).toBe(0);
  });
});

describe('the LP wallet\'s token list', () => {
  const lp = { address: '0x42037cF29b5F482e1E1dC2c5dba97e3577bA1F9b', balanceEth: '0.02', ethPriceUsd: 1954.82, tokens: [
    { token: '0xusdc', symbol: 'USDC', amount: '12.5', priceUsd: 1 },
    { token: '0xweth', symbol: 'WETH', amount: '0.3', priceUsd: 1954.82 },
    { token: '0xodd', symbol: 'ODD', amount: '7', priceUsd: null },
    { token: '0xzero', symbol: 'U1', amount: '0', priceUsd: 0.07 },
  ] };

  test('every token it holds shows, largest first after ETH; an unpriced one shows its amount, never $0', () => {
    const pf = lpPortfolioOf(lp, { usd: 1955.17, change24h: -4.03 });
    expect(pf.rows.map((r) => r.symbol)).toEqual(['ETH', 'WETH', 'USDC', 'ODD']);
    expect(pf.rows[0]).toMatchObject({ priceUsd: 1955.17, change24h: -4.03 });
    expect(pf.rows[1].usd).toBeCloseTo(586.446, 3);
    expect(pf.rows[3]).toMatchObject({ balance: 7, usd: null });
    expect(pf.usdTotal).toBeCloseTo(39.1034 + 586.446 + 12.5, 3);
  });

  test('without the desk\'s ETH price, ETH takes Umbrae\'s; no wallet, no list', () => {
    expect(lpPortfolioOf(lp, null).rows[0].priceUsd).toBe(1954.82);
    expect(lpPortfolioOf(null, null)).toBeNull();
  });
});

describe('what sits in its positions is on the list too', () => {
  test('each token of a position, fees included, as "SYMBOL · IN POSITIONS" at the pool\'s price; the total is everything it holds', () => {
    const POOL_V = '0x05de9d85b9a32e4a97814b6c4ede8768536d3ec5';
    const lp = {
      address: '0x42037cF29b5F482e1E1dC2c5dba97e3577bA1F9b', balanceEth: '0.02', ethPriceUsd: 1954.82, tokens: [],
      pools: [{ address: POOL_V, name: 'VIRTUAL-WETH', tokens: [['0xv', 'VIRTUAL'], ['0xw', 'WETH']] }],
      positions: [{ lbPairAddress: POOL_V, poolInfo: { name: 'VIRTUAL-WETH', tokenXPriceUsd: 0.5187, tokenYPriceUsd: 1954.82 },
        positions: { userPositions: [{ publicKey: '9', positionData: { totalXAmount: '472.89', totalYAmount: '0.13', feeX: '0.11', feeY: '0' } }] } }],
    };
    const pf = lpPortfolioOf(lp, null);
    expect(pf.rows.map((r) => [r.symbol, r.balance])).toEqual([['ETH', 0.02], ['VIRTUAL · IN POSITIONS', 473], ['WETH · IN POSITIONS', 0.13]]);
    expect(pf.usdTotal).toBeCloseTo(0.02 * 1954.82 + 473 * 0.5187 + 0.13 * 1954.82, 6);
  });

  test('the real waiting card flags an unlisted pool and renders its full address and token amounts', () => {
    const request = { action: { type: 'open', pool: POOL, amountX: '0.01', amountY: '25', tokenXSymbol: 'WETH', tokenYSymbol: 'USDC' }, reason: 'No budget is set for this house member yet.', depositUsd: '30' };
    const html = renderToStaticMarkup(createElement(WaitingCard, { request, pools: [], budgetUsd: null, busy: false, onAnswer: String }));
    expect(html).toContain(`UNLISTED POOL · ${POOL}`);
    expect(html).toContain('0.01 WETH + 25 USDC · no budget set');
    expect(html).not.toContain('0x1cc9…0293');
  });
});
