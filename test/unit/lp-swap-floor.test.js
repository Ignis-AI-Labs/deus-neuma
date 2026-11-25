import { describe, expect, test } from 'vitest';
import { ethers } from 'ethers';
import { marketOutputFloor } from '../../backend/services/umbrae-lp/lp-swap-floor.js';
import { resolveToken, PINNED_TOKENS } from '../../backend/services/umbrae-lp/lp-tokens.js';

describe('PR20 H-04/H-05 token identity and independent swap floor', () => {
  test.each(['USDC\u200b', 'USD\u0421', 'WET\u202eH'])('look-alike symbol %j is refused even when listed', (symbol) => {
    const attacker = ethers.getAddress('0x5555555555555555555555555555555555555555');
    const verdict = resolveToken([[attacker, symbol], [PINNED_TOKENS.USDC, 'USDC'], [PINNED_TOKENS.WETH, 'WETH']], symbol);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('plain printable ASCII');
  });

  test('market floor uses the input/output prices, decimal scale, slippage and fee buffer', () => {
    const priced = marketOutputFloor({ amountIn: 1_000_000n, decimalsIn: 6, decimalsOut: 18, priceInUsd: 1, priceOutUsd: 3200, slippagePct: 1 });
    expect(priced).toEqual({ ok: true, expectedOut: 312500000000000n, floor: 306250000000000n });
    expect(marketOutputFloor({ amountIn: 1n, decimalsIn: 6, decimalsOut: 18, priceInUsd: null, priceOutUsd: 3200, slippagePct: 1 })).toBeNull();
  });
});
