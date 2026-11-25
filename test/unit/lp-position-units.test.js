/**
 * A position's amounts, in the units Umbrae REALLY sends them. Read live
 * 2026-11-13 from Tenekom's position #156 (VIRTUAL-WETH, step 50): totals and
 * fees in RAW on-chain units with each token's decimals on poolInfo, per-bin
 * rows in whole tokens. The stand-in had sent whole tokens everywhere, so the
 * book valued this position at $499,427,388,367,537,831,936 (10^18 too high)
 * while every test passed. Every reader of these amounts is held to it here.
 */
import { describe, test, expect } from 'vitest';
import { positionStrings, positionAmounts, positionsUsd } from '../../core/wallet/lp-book-math.js';
import { positionsMicroUsd } from '../../core/wallet/lp-tx-policy.js';
import { lpViewLines } from '../../backend/services/umbrae-lp/lp-view.js';
import { composeLpReport } from '../../backend/services/umbrae-lp/lp-report.js';
import { positionRows, lpPortfolioOf } from '../../frontend/app/RelinkShell/lp-figures.js';

const POOL = '0x05de9d85b9a32e4a97814b6c4ede8768536d3ec5';
const REAL = Object.freeze([{
  lbPairAddress: POOL,
  positions: {
    userPositions: [{
      publicKey: '156',
      positionData: {
        lowerBinId: 8386947, upperBinId: 8386967, lastUpdatedAt: '2026-11-13T13:15:46.000Z',
        totalXAmount: '472889999999999963762', totalYAmount: '129999999999999985', feeX: '2500000000000000000', feeY: '0',
        feeScope: 'position', valuationComplete: true, snapshotComplete: true,
      },
      positionBinData: [{ binId: 8386947, pricePerToken: '0.00025244770241847933', positionXAmount: '0', positionYAmount: '0.033240506329113923' }],
      creationTime: 1794575746000, custodied: false,
    }],
    activeBin: { binId: 8386957 },
  },
  poolInfo: {
    name: 'VIRTUAL-WETH', mint_x: '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b', mint_y: '0x4200000000000000000000000000000000000006',
    tokenX: { symbol: 'VIRTUAL', decimals: 18 }, tokenY: { symbol: 'WETH', decimals: 18 },
    tokenXPriceUsd: 0.5216253212008001, tokenYPriceUsd: 1965.74248997, binStep: 50,
  },
}]);
const data = REAL[0].positions.userPositions[0].positionData;
// 472.89 VIRTUAL + 2.5 VIRTUAL of fees at $0.5216 + 0.13 WETH at $1,965.74
const WORTH = (472.889999999999963762 + 2.5) * 0.5216253212008001 + 0.129999999999999985 * 1965.74248997;

describe('a real Umbrae position, in whole tokens', () => {
  test('raw totals and fees are scaled by each token\'s decimals, exactly', () => {
    expect(positionStrings(REAL[0], data)).toEqual({ x: '472.889999999999963762', y: '0.129999999999999985', feeX: '2.5', feeY: '0' });
    expect(positionAmounts(REAL[0], data).x).toBeCloseTo(472.89, 9);
  });

  test('an amount already in whole tokens, or with no decimals given, is left as it is', () => {
    expect(positionStrings({ poolInfo: { tokenX: { decimals: 18 }, tokenY: { decimals: 6 } } }, { totalXAmount: '0.0011', totalYAmount: '2.4' })).toMatchObject({ x: '0.0011', y: '2.4' });
    expect(positionStrings({ poolInfo: {} }, { totalXAmount: '3', totalYAmount: '0' })).toMatchObject({ x: '3', y: '0' });
    expect(positionStrings({ poolInfo: { tokenX: { decimals: 6 }, tokenY: { decimals: 6 } } }, { totalXAmount: '5', totalYAmount: '1000000' })).toMatchObject({ x: '0.000005', y: '1' });
  });

  test('the book, the budget check, the member\'s lines, the daily card and the desk all read ~$500, never 10^18 more', () => {
    expect(positionsUsd(REAL)).toBeCloseTo(WORTH, 6);
    expect(Number(positionsMicroUsd(REAL)) / 1e6).toBeCloseTo(472.889999999999963762 * 0.5216253212008001 + 0.129999999999999985 * 1965.74248997, 2);
    const lines = lpViewLines({ address: '0xA', balanceEth: '0.02', budgetUsd: null, pending: [], positions: REAL, positionsNote: null, connectionOn: true, pools: [], tokens: [], house: [], bookLines: [] });
    expect(lines.join('\n')).toContain(`#156 in VIRTUAL-WETH (${POOL}): 472.89 VIRTUAL + 0.13 WETH, fees waiting 2.5 VIRTUAL + 0 WETH, bins 8386947..8386967, pool now at bin 8386957`);
    expect(composeLpReport('Tenekom', { positions: REAL, pending: [], budgetUsd: null, balanceEth: '0.02' }, []).title).toBe('Tenekom: 1 liquidity position(s), $1.30 in fees waiting');
    const [row] = positionRows(REAL);
    expect(row).toMatchObject({ x: '472.89', y: '0.13', inRange: true });
    expect(row.usd).toBeCloseTo(472.889999999999963762 * 0.5216253212008001 + 0.129999999999999985 * 1965.74248997, 6);
    const pf = lpPortfolioOf({ address: '0xA', balanceEth: '0.02', ethPriceUsd: 1965.74, tokens: [], pools: [], positions: REAL }, null);
    expect(pf.rows.map((r) => r.symbol)).toEqual(['ETH', 'VIRTUAL · IN POSITIONS', 'WETH · IN POSITIONS']);
    expect(pf.usdTotal).toBeCloseTo(0.02 * 1965.74 + WORTH, 6);
  });
});
