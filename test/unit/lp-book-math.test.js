import { describe, test, expect } from 'vitest';
import {
  tokens, walletUsd, positionsUsd, changeUsd, heldAfter, bookFigures, signedUsd, earnedSince, trimDays,
} from '../../core/wallet/lp-book-math.js';
import { lpWakeLine } from '../../backend/services/umbrae-lp/lp-wake-line.js';
import { wakeThought } from '../../backend/services/house-clock/wake-thought.js';

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const eth = (raw, priceUsd = 3000) => ({ key: 'ETH', symbol: 'ETH', decimals: 18, raw, priceUsd });
const usdc = (raw, priceUsd = 1) => ({ key: USDC, symbol: 'USDC', decimals: 6, raw, priceUsd });

describe('the book\'s arithmetic', () => {
  test('raw amounts read as whole tokens, signed', () => {
    expect(tokens('1500000', 6)).toBe(1.5);
    expect(tokens('-250000', 6)).toBe(-0.25);
    expect(tokens('1000000000000000000', 18)).toBe(1);
    expect(tokens('not a number', 6)).toBe(0);
  });

  test('a wallet is worth its priced holdings; an unpriced one is named, never guessed', () => {
    const w = walletUsd([eth('500000000000000000'), usdc('20000000'), { key: '0xabc', symbol: 'ODD', decimals: 18, raw: '5', priceUsd: null }]);
    expect(w.usd).toBe(1520);
    expect(w.unpriced).toEqual(['ODD']);
  });

  test('positions are worth their amounts and the fees waiting in them', () => {
    const pools = [{ poolInfo: { tokenXPriceUsd: 3000, tokenYPriceUsd: 1 }, positions: { userPositions: [{ positionData: { totalXAmount: '0.01', totalYAmount: '10', feeX: '0.001', feeY: '1' } }] } }];
    expect(positionsUsd(pools)).toBeCloseTo(44, 6);
    expect(positionsUsd(null)).toBe(0);
  });

  test('a change between two reads counts only holdings read both times', () => {
    const before = { ETH: '1000000000000000000', [USDC]: '0' };
    const after = [eth('1000000000000000000'), usdc('50000000')];
    expect(changeUsd(before, after)).toEqual({ usd: 50, moved: [{ symbol: 'USDC', amount: 50, usd: 50 }] });
    // USDC missing from the second read is not taken for a balance of zero
    expect(changeUsd({ ...before, [USDC]: '50000000' }, [eth('1000000000000000000')]).usd).toBe(0);
    expect(heldAfter({ ETH: '1', [USDC]: '7' }, [eth('2')])).toEqual({ ETH: '2', [USDC]: '7' });
  });

  test('earned = value + returned + rewards − funded; free never passes value or what rewards already took', () => {
    expect(bookFigures({ fundedUsd: 100, returnedUsd: 0, rewardsUsd: 0 }, 112.345)).toMatchObject({ earnedUsd: 12.35, freeUsd: 12.35 });
    // gave $50 back to the house: earned unchanged
    expect(bookFigures({ fundedUsd: 100, returnedUsd: 50, rewardsUsd: 0 }, 62.345).earnedUsd).toBe(12.35);
    // a $10 reward paid: earned unchanged, free shrinks by it
    expect(bookFigures({ fundedUsd: 100, returnedUsd: 0, rewardsUsd: 10 }, 102.345)).toMatchObject({ earnedUsd: 12.35, freeUsd: 2.35 });
    // a loss frees nothing
    expect(bookFigures({ fundedUsd: 100 }, 90).freeUsd).toBe(0);
  });

  test('signed figures and change since a past day', () => {
    expect(signedUsd(3.456)).toBe('+$3.46');
    expect(signedUsd(-0.4)).toBe('−$0.40');
    const days = { '2026-11-10': { earnedUsd: 1 }, '2026-11-12': { earnedUsd: 4 }, '2026-11-13': { earnedUsd: 9 } };
    expect(earnedSince(days, '2026-11-13', 10, 1)).toBe(6);
    expect(earnedSince(days, '2026-11-13', 10, 7)).toBeNull();
    expect(earnedSince(days, '2026-11-13', 10, 2)).toBe(9);
    expect(Object.keys(trimDays(days, 2))).toEqual(['2026-11-12', '2026-11-13']);
  });
});

describe('what a woken member reads for its LP wallet', () => {
  test('each event in its own words, with the book and the tools to act', () => {
    const round = lpWakeLine({ ref: 'round-60m-1', detail: { event: 'round', everyMinutes: 60, brief: 'value $10.00 · earned +$1.00' } });
    expect(round).toMatch(/portfolio round \(every 60 min\)/);
    expect(round).toMatch(/Your book: value \$10\.00/);
    expect(round).toMatch(/lp_book and lp_market/);
    expect(lpWakeLine({ ref: 'r', detail: { event: 'out-of-range', position: '77', name: 'WETH-USDC', bins: '1..5', active: 9 } })).toMatch(/#77 in WETH-USDC left its range \(bins 1\.\.5; the pool is at bin 9\)/);
    expect(lpWakeLine({ ref: 'r', detail: { event: 'reward-answered', answer: 'declined', what: 'A GPU', note: 'next month' } })).toMatch(/DECLINED your reward "A GPU" for now \[r\]: "next month"/);
  });

  test('the wake\'s note carries the line', () => {
    const note = wakeThought({ items: [{ seat: 'tenekom', reason: 'lp', ref: 'spread-WETH-USDC-1', detail: { event: 'spread', pct: 5, pair: 'WETH-USDC', low: '0xa', high: '0xb' } }], charter: { goal: 'earn', escalate: [] } });
    expect(note).toMatch(/A 5% price spread opened on WETH-USDC/);
  });
});

describe('the price a token is booked at', () => {
  test('each token takes the price of the DEEPEST Umbrae group that prices it, not the last one listed', async () => {
    const { poolTokens } = await import('../../backend/services/umbrae-lp/lp-holdings.js');
    const W = '0x4200000000000000000000000000000000000006';
    const U1 = '0x14a4e80d633aF55Ace1160c320f5a36D41CCEd3E';
    // the live shape of 2026-11-13: WETH $1,954.82 in a $33k group, $2,133.29 in a $560 one listed last
    const payload = { groups: [
      { name: 'U1-USDC', tokenX: 'U1', tokenY: 'USDC', tokenXPrice: 0.0711, tokenYPrice: 1, mint_x: U1, mint_y: USDC, pairs: [{ liquidity: '43033' }] },
      { name: 'U1-WETH', tokenX: 'U1', tokenY: 'WETH', tokenXPrice: 0.0433, tokenYPrice: 1954.82, mint_x: U1, mint_y: W, pairs: [{ liquidity: '33234' }] },
      { name: 'WETH-USDC', tokenX: 'WETH', tokenY: 'USDC', tokenXPrice: 2133.29, tokenYPrice: 1, mint_x: W, mint_y: USDC, pairs: [{ liquidity: '470' }, { liquidity: '90' }] },
    ] };
    const book = poolTokens(payload);
    expect(book.get(W)).toEqual({ symbol: 'WETH', priceUsd: 1954.82 });
    expect(book.get(U1)).toEqual({ symbol: 'U1', priceUsd: 0.0711 });
    expect(book.get(USDC).priceUsd).toBe(1);
  });
});
