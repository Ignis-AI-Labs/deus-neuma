import { describe, test, expect } from 'vitest';
import { Interface, getAddress } from 'ethers';
import { UMBRAE_FACTORY, binIdFor, orientPair, classifyCreatePair } from '../../core/wallet/pool-policy.js';
import { classifyLpTransaction, checkLpIntent } from '../../core/wallet/lp-tx-policy.js';

const FACTORY = new Interface(['function createPair(address tokenX, address tokenY, uint24 activeId, uint16 binStep, uint16 baseFactor, uint256 amountX, uint256 amountY)', 'function setFlashLoanFee(address pair, uint256 feeBps)']);
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const CBBTC = getAddress('0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf');
const pairTx = (args, extra = {}) => ({ to: UMBRAE_FACTORY, data: FACTORY.encodeFunctionData('createPair', args), chainId: 8453, ...extra });

describe('a new pool\'s start bin', () => {
  test('Umbrae\'s whole-token rule, matching three live pools read 2026-11-14 to the bin', () => {
    expect(binIdFor(2133.293288872658, 25)).toBe(8391678); // WETH-USDC, decimals 18/6
    expect(binIdFor(0.00026272410212970404, 50)).toBe(8386955); // VIRTUAL-WETH
    expect(binIdFor(0.07106245573998599, 25)).toBe(8387549); // U1-USDC, decimals 18/6
    expect(binIdFor(1, 25)).toBe(8388608);
    expect(binIdFor(0, 25)).toBeNull();
    expect(binIdFor(2, 2.5)).toBeNull();
  });

  test('the factory\'s order: tokenX sorts below tokenY by address', () => {
    expect(orientPair(CBBTC, USDC)).toEqual({ tokenX: USDC, tokenY: CBBTC, baseIsX: false });
    expect(orientPair(USDC, CBBTC)).toEqual({ tokenX: USDC, tokenY: CBBTC, baseIsX: true });
  });
});

describe('what is signed on Umbrae\'s factory', () => {
  const planned = { kind: 'create-pool', tokenX: USDC, tokenY: CBBTC, binStep: 25, baseFactor: 30, amountX: '5000000', amountY: '0', activeId: binIdFor(1 / 95000, 25) };
  const good = [USDC, CBBTC, planned.activeId, 25, 30, 5_000_000n, 0n];

  test('createPair at the pinned factory reads whole, and passes for the pool that was planned', () => {
    const verdict = classifyLpTransaction(pairTx(good), { wallet: USDC, tokens: new Set() });
    expect(verdict).toEqual({ ok: true, kind: 'create-pool', action: 'createPair', tokenX: USDC, tokenY: CBBTC, activeId: planned.activeId, binStep: 25, baseFactor: 30, amountX: '5000000', amountY: '0' });
    expect(checkLpIntent(verdict, planned)).toEqual({ ok: true });
  });

  test('another pair, another tier, another price, a bigger seed: refused', () => {
    const judge = (args) => checkLpIntent(classifyCreatePair(pairTx(args)), planned);
    expect(judge([USDC, CBBTC, planned.activeId, 25, 50, 5_000_000n, 0n]).reason).toMatch(/not the pair or fee tier/);
    expect(judge([USDC, CBBTC, planned.activeId + 3, 25, 30, 5_000_000n, 0n]).reason).toMatch(/another price/);
    expect(judge([USDC, CBBTC, planned.activeId + 2, 25, 30, 5_000_000n, 0n])).toEqual({ ok: true }); // within 2 bins of the planned price
    expect(judge([USDC, CBBTC, planned.activeId, 25, 30, 5_000_001n, 0n]).reason).toMatch(/seed is larger/);
    expect(judge([USDC, CBBTC, planned.activeId, 25, 30, 5_000_000n, 1n]).reason).toMatch(/seed is larger/);
  });

  test('ETH sent with it, unsorted tokens, no seed, any other factory call: refused', () => {
    expect(classifyCreatePair(pairTx(good, { value: '1' })).reason).toMatch(/sends no ETH/);
    expect(classifyCreatePair(pairTx([CBBTC, USDC, 1, 25, 30, 1n, 0n])).reason).toMatch(/factory's order/);
    expect(classifyCreatePair(pairTx([USDC, CBBTC, 1, 25, 30, 0n, 0n])).reason).toMatch(/needs a seed/);
    expect(classifyCreatePair({ to: UMBRAE_FACTORY, data: FACTORY.encodeFunctionData('setFlashLoanFee', [USDC, 1n]) }).reason).toMatch(/only factory call/);
  });

  test('an approval may name the factory, for at most what the action calls for', () => {
    const approve = new Interface(['function approve(address spender, uint256 amount)']);
    const tx = (amount) => ({ to: USDC, data: approve.encodeFunctionData('approve', [UMBRAE_FACTORY, amount]), chainId: 8453 });
    expect(classifyLpTransaction(tx(10n), { wallet: CBBTC, tokens: new Set(), maxApprove: { [USDC]: '10' } })).toMatchObject({ ok: true, kind: 'approval' });
    expect(classifyLpTransaction(tx(11n), { wallet: CBBTC, tokens: new Set(), maxApprove: { [USDC]: '10' } }).reason).toMatch(/larger than this action calls for/);
  });
});
