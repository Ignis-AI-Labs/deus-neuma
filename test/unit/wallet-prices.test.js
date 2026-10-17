// Pure price conversion; HTTP failure proof lives in wallet-price-browser.test.js.
import { describe, it, expect } from 'vitest';
import { normalizeEthPrice } from '../../frontend/app/RelinkShell/wallet-price-value.js';

describe('normalizeEthPrice', () => {
  it('maps a real price + 24h change', () => {
    expect(normalizeEthPrice({ usd: 1752.21, change24h: 1.37, asOf: 'x' })).toEqual({ usd: 1752.21, change24h: 1.37 });
  });

  it('{ usd: null } from the proxy → null (never a coerced $0)', () => {
    expect(normalizeEthPrice({ usd: null })).toBeNull();
  });

  it('missing 24h change → change24h null but price kept', () => {
    expect(normalizeEthPrice({ usd: 1752.21 })).toEqual({ usd: 1752.21, change24h: null });
  });

  it('explicit change24h:null stays null (not coerced to a fake 0%)', () => {
    expect(normalizeEthPrice({ usd: 1752.21, change24h: null })).toEqual({ usd: 1752.21, change24h: null });
  });

  it('a genuine flat market (change24h:0) is preserved as 0', () => {
    expect(normalizeEthPrice({ usd: 1752.21, change24h: 0 })).toEqual({ usd: 1752.21, change24h: 0 });
  });

  it('a non-numeric usd → null', () => {
    expect(normalizeEthPrice({ usd: 'not-a-number' })).toBeNull();
  });
});
