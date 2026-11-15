/**
 * What the LP wallet signs through KyberSwap's aggregator (core/wallet/aggregator-policy.js),
 * judged on KyberSwap's REAL build answer (test/fixtures/kyber-build-weth-virtual.json,
 * captured 2026-11-13 for a dummy recipient) and on calls built from the router's own ABI.
 */
import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import { Interface, getAddress } from 'ethers';
import { KYBER_ROUTER, KYBER_ABI, classifyAggregatorSwap } from '../../core/wallet/aggregator-policy.js';
import { classifyLpTransaction, checkLpIntent } from '../../core/wallet/lp-tx-policy.js';

const REAL = JSON.parse(fs.readFileSync(new URL('../fixtures/kyber-build-weth-virtual.json', import.meta.url), 'utf8'));
const WETH = '0x4200000000000000000000000000000000000006';
const VIRTUAL = getAddress('0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b');
const DUMMY = '0x1111111111111111111111111111111111111111';
const THIEF = '0x2222222222222222222222222222222222222222';
const TOKENS = new Set([WETH, VIRTUAL]);
const KYBER = new Interface(KYBER_ABI);
const real = { to: REAL.routerAddress, data: REAL.data, value: '0' };

// A swap call built from the router's own ABI, with one field changed.
const built = (patch = {}, name = 'swap') => {
  const desc = { srcToken: WETH, dstToken: VIRTUAL, srcReceivers: [DUMMY], srcAmounts: [10n], feeReceivers: [], feeAmounts: [], dstReceiver: DUMMY, amount: 10n, minReturnAmount: 9n, flags: 0n, permit: '0x', ...patch };
  const data = name === 'swap'
    ? KYBER.encodeFunctionData('swap', [{ callTarget: DUMMY, approveTarget: '0x0000000000000000000000000000000000000000', targetData: '0x', desc, clientData: '0x' }])
    : KYBER.encodeFunctionData('swapSimpleMode', [DUMMY, desc, '0x', '0x']);
  return { to: KYBER_ROUTER, data, value: '0' };
};

describe('a swap through KyberSwap\'s router', () => {
  test('KyberSwap\'s real answer reads whole: tokens, amount, who is paid, the least it may pay', () => {
    expect(REAL.routerAddress).toBe(KYBER_ROUTER);
    expect(classifyAggregatorSwap(real, { wallet: DUMMY, tokens: TOKENS })).toEqual({
      ok: true, kind: 'swap', action: 'kyberswap.swap', via: 'kyberswap', tokenIn: WETH, tokenOut: VIRTUAL,
      amountIn: '130000000000000000', amountOutMin: '482263704026952214117',
    });
  });

  test('through the whole signing rule: signed only at the pinned router, for the wallet that signs, under the floor asked', () => {
    const verdict = classifyLpTransaction({ ...real, chainId: 8453 }, { wallet: DUMMY, tokens: TOKENS });
    expect(verdict).toMatchObject({ ok: true, via: 'kyberswap' });
    expect(checkLpIntent(verdict, { kind: 'swap', tokenIn: WETH, tokenOut: VIRTUAL, amountIn: '130000000000000000', amountOutMin: '480000000000000000000' })).toEqual({ ok: true });
    expect(checkLpIntent(verdict, { kind: 'swap', tokenIn: WETH, tokenOut: VIRTUAL, amountIn: '130000000000000000', amountOutMin: '485000000000000000000' }).reason).toMatch(/minimum out is lower than the floor/);
    expect(classifyLpTransaction({ ...real, chainId: 8453 }, { wallet: THIEF, tokens: TOKENS }).reason).toMatch(/pay a different wallet/);
    expect(classifyLpTransaction({ ...real, to: THIEF, chainId: 8453 }, { wallet: DUMMY, tokens: TOKENS }).ok).toBe(false);
    expect(classifyLpTransaction({ ...real, value: '1', chainId: 8453 }, { wallet: DUMMY, tokens: TOKENS }).ok).toBe(false);
  });

  test('a token none of Umbrae\'s pools trade, a fee to anyone, a permit, an unsafe flag, no minimum: refused', () => {
    const ctx = { wallet: DUMMY, tokens: TOKENS };
    expect(classifyAggregatorSwap(real, { wallet: DUMMY, tokens: new Set([WETH]) }).reason).toMatch(/token none of Umbrae's pools trade/);
    expect(classifyAggregatorSwap(built({ feeReceivers: [THIEF], feeAmounts: [1n] }), ctx).reason).toMatch(/pays a fee/);
    expect(classifyAggregatorSwap(built({ permit: '0x1234' }), ctx).reason).toMatch(/permit/);
    for (const flag of [0x01n, 0x02n, 0x04n, 0x08n, 0x10n, 0x20n]) expect(classifyAggregatorSwap(built({ flags: flag }), ctx).reason).toMatch(/known Kyber route flag/);
    expect(classifyAggregatorSwap(built({ flags: 512n }), ctx).ok).toBe(true);
    expect(classifyAggregatorSwap(built({ minReturnAmount: 0n }), ctx).reason).toMatch(/no minimum out/);
    expect(classifyAggregatorSwap(built({ amount: 0n }), ctx).reason).toMatch(/moves nothing/);
    expect(classifyAggregatorSwap({ ...built(), value: '5' }, ctx).reason).toMatch(/sends no ETH/);
    expect(classifyAggregatorSwap({ to: KYBER_ROUTER, data: '0xdeadbeef' }, ctx).reason).toMatch(/only KyberSwap call/);
  });

  test('the simple-mode swap is held to the same law', () => {
    expect(classifyAggregatorSwap(built({}, 'swapSimpleMode'), { wallet: DUMMY, tokens: TOKENS })).toMatchObject({ ok: true, action: 'kyberswap.swapSimpleMode' });
    expect(classifyAggregatorSwap(built({ dstReceiver: THIEF }, 'swapSimpleMode'), { wallet: DUMMY, tokens: TOKENS }).ok).toBe(false);
  });

  test('an approval may name KyberSwap\'s router, for exactly the swap\'s amount', () => {
    const approve = new Interface(['function approve(address spender, uint256 amount)']);
    const tx = (amount) => ({ to: WETH, data: approve.encodeFunctionData('approve', [KYBER_ROUTER, amount]), chainId: 8453 });
    expect(classifyLpTransaction(tx(10n), { wallet: DUMMY, tokens: TOKENS, maxApprove: { [WETH]: '10' } })).toMatchObject({ ok: true, kind: 'approval' });
    expect(classifyLpTransaction(tx(11n), { wallet: DUMMY, tokens: TOKENS, maxApprove: { [WETH]: '10' } }).reason).toMatch(/larger than this action calls for/);
  });
});
