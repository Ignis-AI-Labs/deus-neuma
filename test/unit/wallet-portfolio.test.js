// Unit tests for the pure portfolio assembler + the USD/percent formatters.
// These own the honest-stats guarantees: an unknown price never becomes a
// fabricated dollar figure, and the aggregate 24h move is derived, not invented.

import { describe, it, expect } from 'vitest';
import { priceRow, buildPortfolio } from '../../frontend/app/RelinkShell/wallet-portfolio.js';
import { formatUsd, formatPct, formatTokenAmount, formatPrice } from '../../frontend/utils/format.js';

describe('priceRow', () => {
  it('prices a normal holding (balance × price)', () => {
    const r = priceRow({ symbol: 'ETH', balance: 0.5, price: { usd: 2000, change24h: 1.5 } });
    expect(r.balance).toBe(0.5);
    expect(r.priceUsd).toBe(2000);
    expect(r.change24h).toBe(1.5);
    expect(r.usd).toBe(1000);
  });

  it('returns a frozen object', () => {
    const r = priceRow({ symbol: 'ETH', balance: 1, price: { usd: 1, change24h: 0 } });
    expect(Object.isFrozen(r)).toBe(true);
  });

  it('null price → usd null, no fabricated value', () => {
    const r = priceRow({ symbol: 'ETH', balance: 2, price: null });
    expect(r.priceUsd).toBeNull();
    expect(r.change24h).toBeNull();
    expect(r.usd).toBeNull();
    expect(r.balance).toBe(2);
  });

  it('missing 24h change is null but the holding still prices', () => {
    const r = priceRow({ symbol: 'X', balance: 3, price: { usd: 10 } });
    expect(r.usd).toBe(30);
    expect(r.change24h).toBeNull();
  });

  it('unknown balance (null/NaN) → balance 0 and usd null', () => {
    expect(priceRow({ symbol: 'ETH', balance: null, price: { usd: 2000, change24h: 0 } }).usd).toBeNull();
    expect(priceRow({ symbol: 'ETH', balance: 'x', price: { usd: 2000, change24h: 0 } }).balance).toBe(0);
  });

  it('negative balance is rejected as invalid', () => {
    const r = priceRow({ symbol: 'ETH', balance: -1, price: { usd: 2000, change24h: 0 } });
    expect(r.balance).toBe(0);
    expect(r.usd).toBeNull();
  });

  it('zero balance with a price is a real $0.00 holding', () => {
    const r = priceRow({ symbol: 'ETH', balance: 0, price: { usd: 2000, change24h: 0 } });
    expect(r.usd).toBe(0);
  });

  it('price.usd:null → unpriced (usd null), never a coerced $0', () => {
    const r = priceRow({ symbol: 'X', balance: 5, price: { usd: null, change24h: null } });
    expect(r.priceUsd).toBeNull();
    expect(r.usd).toBeNull();
  });

  it('price.change24h:null stays null while the holding still prices', () => {
    const r = priceRow({ symbol: 'X', balance: 5, price: { usd: 2, change24h: null } });
    expect(r.usd).toBe(10);
    expect(r.change24h).toBeNull();
  });

  it('price.change24h:0 (genuine flat) is preserved', () => {
    const r = priceRow({ symbol: 'X', balance: 5, price: { usd: 2, change24h: 0 } });
    expect(r.change24h).toBe(0);
  });
});

describe('buildPortfolio', () => {
  it('single ETH holding: total = its USD, aggregate change = its change', () => {
    const pf = buildPortfolio([{ symbol: 'ETH', balance: 0.08, price: { usd: 1750, change24h: 1.39 } }]);
    expect(pf.usdTotal).toBeCloseTo(140, 6);
    expect(pf.change24h).toBeCloseTo(1.39, 6);
    expect(pf.rows).toHaveLength(1);
    expect(Object.isFrozen(pf)).toBe(true);
  });

  it('no priced holding → total null (not $0.00) and change null', () => {
    const pf = buildPortfolio([{ symbol: 'ETH', balance: 1, price: null }]);
    expect(pf.usdTotal).toBeNull();
    expect(pf.change24h).toBeNull();
  });

  it('empty / missing input → null total, no rows', () => {
    expect(buildPortfolio([]).usdTotal).toBeNull();
    expect(buildPortfolio().rows).toEqual([]);
  });

  it('computes a USD-weighted aggregate 24h change across holdings', () => {
    const pf = buildPortfolio([
      { symbol: 'ETH', balance: 1, price: { usd: 2000, change24h: 10 } },   // now 2000, prev 1818.18
      { symbol: 'USDC', balance: 1000, price: { usd: 1, change24h: 0 } },   // now 1000, prev 1000
    ]);
    expect(pf.usdTotal).toBeCloseTo(3000, 6);
    // (3000 / (2000/1.1 + 1000) - 1) * 100
    const expected = (3000 / (2000 / 1.1 + 1000) - 1) * 100;
    expect(pf.change24h).toBeCloseTo(expected, 6);
    expect(expected).toBeGreaterThan(6); // ~6.45% — between the two holdings, weighted toward ETH
  });

  it('a priced holding WITHOUT 24h data does not distort the aggregate change', () => {
    // Regression for the numerator/denominator-mismatch bug: today's FULL total
    // must not be divided by yesterday's PARTIAL baseline. A=$100/+10%, B=$50/no-%
    // → the change reflects only A (+10%), NOT (150/90.91-1)≈+65%.
    const pf = buildPortfolio([
      { symbol: 'A', balance: 100, price: { usd: 1, change24h: 10 } }, // $100 today, $90.91 yesterday
      { symbol: 'B', balance: 50, price: { usd: 1 } },                 // $50 today, no 24h data
    ]);
    expect(pf.usdTotal).toBe(150);          // total still counts every priced holding
    expect(pf.change24h).toBeCloseTo(10, 6); // change measured only over the subset with 24h data
  });

  it('priced holdings with no 24h % anywhere → total set, change null', () => {
    const pf = buildPortfolio([{ symbol: 'X', balance: 5, price: { usd: 2 } }]);
    expect(pf.usdTotal).toBe(10);
    expect(pf.change24h).toBeNull();
  });

  it('mixes priced and unpriced: total counts only what is priced', () => {
    const pf = buildPortfolio([
      { symbol: 'ETH', balance: 1, price: { usd: 2000, change24h: 0 } },
      { symbol: 'MYSTERY', balance: 99, price: null },
    ]);
    expect(pf.usdTotal).toBe(2000);
    expect(pf.rows).toHaveLength(2);
  });
});

describe('formatUsd', () => {
  it('formats with thousands separators + 2 decimals', () => {
    expect(formatUsd(41673.14)).toBe('$41,673.14');
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(1)).toBe('$1.00');
  });

  it('null / NaN → em dash, never a fake $0.00', () => {
    expect(formatUsd(null)).toBe('—');
    expect(formatUsd(undefined)).toBe('—');
    expect(formatUsd(NaN)).toBe('—');
  });
});

describe('formatPct', () => {
  it('signs the value; minus is intrinsic, plus is explicit', () => {
    expect(formatPct(1.29)).toBe('+1.29%');
    expect(formatPct(-22.63)).toBe('-22.63%');
    expect(formatPct(0)).toBe('0.00%');
  });

  it('null / NaN → empty string', () => {
    expect(formatPct(null)).toBe('');
    expect(formatPct(NaN)).toBe('');
  });
});

describe('formatTokenAmount', () => {
  it('groups and trims a long 18-decimal string to a readable figure', () => {
    expect(formatTokenAmount('25605.327876')).toBe('25,605.327876');
    expect(formatTokenAmount('4.00042859772215713')).toBe('4.000429'); // capped at 6 frac digits
    expect(formatTokenAmount('1350.8381')).toBe('1,350.8381');
    expect(formatTokenAmount('0')).toBe('0');
  });

  it('null / NaN → em dash', () => {
    expect(formatTokenAmount(null)).toBe('—');
    expect(formatTokenAmount('x')).toBe('—');
  });
});

describe('formatPrice', () => {
  it('adapts precision to magnitude (sub-dollar keeps more digits)', () => {
    expect(formatPrice(1754.49)).toBe('$1,754.49');
    expect(formatPrice(1)).toBe('$1.00');
    expect(formatPrice(0.5424)).toBe('$0.5424');
    expect(formatPrice(0.0199)).toBe('$0.0199');
    expect(formatPrice(0)).toBe('$0.00');
  });

  it('null / NaN → em dash', () => {
    expect(formatPrice(null)).toBe('—');
    expect(formatPrice(NaN)).toBe('—');
  });
});
