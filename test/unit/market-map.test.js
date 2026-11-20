/**
 * The market map's shaping (backend/services/market-map/market-map.js), on the
 * REAL answers captured 2026-11-14 (test/fixtures/market-map/live-samples.json).
 */
import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import { poolRow, poolLine, suspectOf, umbraeCoverage, umbraeGaps, pickYields, yieldLine, marketLine, usdShort, gapLine } from '../../backend/services/market-map/market-map.js';

const S = JSON.parse(fs.readFileSync(new URL('../fixtures/market-map/live-samples.json', import.meta.url), 'utf8'));
const WETH = '0x4200000000000000000000000000000000000006';
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const CBBTC = '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf';
// Umbrae's pool list as it stood 2026-11-14: WETH-USDC among others, no cbBTC
const UMBRAE = { groups: [
  { name: 'WETH-USDC', tokenX: 'WETH', tokenY: 'USDC', mint_x: WETH, mint_y: USDC, pairs: [{ mint_x: WETH, mint_y: USDC }] },
  { name: 'VIRTUAL-WETH', tokenX: 'VIRTUAL', tokenY: 'WETH', mint_x: '0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b', mint_y: WETH, pairs: [{}] },
] };
const rows = S.geckoTop.data.map(poolRow);

describe('a network\'s pools, read whole', () => {
  test('GeckoTerminal\'s pool: its pair by address, volume, TVL, fee from its name and the fees it pays its LPs', () => {
    expect(rows[0]).toMatchObject({ name: 'cbBTC / WETH 0.16%', dex: 'aero-slipstream-base', base: CBBTC, quote: WETH, feePct: 0.16 });
    expect(rows[0].feesPerDay).toBeCloseTo(rows[0].vol24 * 0.0016, 2);
    expect(rows[1].feePct).toBeNull(); // a v2 pool names no fee
    expect(poolLine(rows[0], Date.parse('2026-11-14T08:00:00Z'))).toMatch(/^cbBTC \/ WETH 0\.16% on aero-slipstream-base · 24h volume \$204\.\dM · TVL \$3\.8M · fees ~\$327\.\dK\/day to its LPs/);
  });

  test('fee parsing stays bounded on a hostile pool name and keeps ordinary fees', () => {
    const name = `${'1'.repeat(100000)}.x`;
    const hostile = poolRow({ attributes: { name } });
    expect(hostile.name).toBe(name);
    expect(hostile.feePct).toBeNull();
    expect(poolRow({ attributes: { name: 'TOKEN / WETH 0.3%   ' } }).feePct).toBe(0.3);
  });

  test('volume made by a few huge trades is marked SUSPECT; real demand is not', () => {
    const pons = rows.find((r) => r.name.startsWith('PONS'));
    expect(suspectOf(pons)).toMatch(/a trade over 234 trades: wash trading or a trap/);
    expect(poolLine(pons)).toMatch(/^SUSPECT \(/);
    expect(suspectOf(rows[0])).toBeNull();
    expect(suspectOf({ vol24: 50_000, trades24: 3 })).toBeNull(); // too small to matter
  });
});

describe('the Umbrae gaps', () => {
  test('pairs that trade with no Umbrae pool; the ones Umbrae can host first (USDC or WETH as their quote), the suspect last; Umbrae\'s own pairs left out', () => {
    const gaps = umbraeGaps(rows, umbraeCoverage(UMBRAE));
    expect(gaps.some((g) => g.base === WETH && g.quote === USDC)).toBe(false); // Umbrae has WETH-USDC
    expect(gaps[0]).toMatchObject({ name: 'cbBTC / WETH 0.16%', umbraeBase: CBBTC, umbraeQuote: WETH });
    expect(gaps.find((g) => g.name.startsWith('cbBTC / USDC'))).toMatchObject({ umbraeBase: CBBTC, umbraeQuote: USDC });
    expect(gaps.find((g) => g.name.startsWith('PONS')).umbraeQuote).toBeNull();
    // every suspect gap ranks below every real one
    const suspect = gaps.map((g, i) => (suspectOf(g) ? i : null)).filter((i) => i !== null);
    const real = gaps.map((g, i) => (suspectOf(g) ? null : i)).filter((i) => i !== null);
    expect(suspect.length).toBeGreaterThan(0);
    expect(Math.min(...suspect)).toBeGreaterThan(Math.max(...real));
  });
});

describe('a gap the factory already holds', () => {
  test('pools on Umbrae\'s factory that its list leaves out are named, with the stale-price warning; an empty gap gets the create-pool plan', () => {
    const gap = { ...rows[0], umbraeBase: CBBTC, umbraeQuote: WETH };
    const held = gapLine({ ...gap, factoryPools: ['0x47aEf5Ec12D8D4Db4e920a65f7C87D50D7116F42'] });
    expect(held).toMatch(/Umbrae's factory already has 1 pool\(s\) for this pair that its public list does not show: 0x47aEf5Ec12D8D4Db4e920a65f7C87D50D7116F42/);
    expect(held).toMatch(/compare its price to the market FIRST/);
    expect(gapLine(gap)).toMatch(/Umbrae has no pool for this pair: lp\/create-pool \{baseToken: "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf", quoteToken: "0x4200000000000000000000000000000000000006", check: true\} plans one/);
  });
});

describe('yields and markets', () => {
  test('DefiLlama\'s rows filtered by chain, TVL and stablecoin, highest APY first; rewards and outliers said', () => {
    const base = pickYields(S.llama.data, { chain: 'base', minTvlUsd: 1_000_000 });
    expect(base.map((r) => r.symbol)).toEqual(['WETH-VVV', 'USDC-AERO', 'ZBU', 'WETH-FAI']);
    expect(pickYields(S.llama.data, { chain: 'Ethereum', minTvlUsd: 1e8 }).every((r) => r.chain === 'Ethereum')).toBe(true);
    expect(pickYields(S.llama.data, { chain: 'Base', minTvlUsd: 0 }).some((r) => r.tvlUsd < 1e4)).toBe(true);
    expect(yieldLine(base[0])).toMatch(/^Base · aerodrome-v1 · WETH-VVV · APY 651\.\d% \(base \? \+ rewards 651\.\d%, paid in its reward token\) · TVL \$6\.5M/);
  });

  test('a DexScreener market as a line, and short dollars', () => {
    expect(marketLine(S.dexTokenPairs[0])).toMatch(/^base · pancakeswap · cbBTC\/WETH · liquidity \$4\.3M/);
    expect([usdShort(1_234_567_890), usdShort(45_300), usdShort(812), usdShort(null)]).toEqual(['$1.23B', '$45.3K', '$812', '?']);
  });
});
