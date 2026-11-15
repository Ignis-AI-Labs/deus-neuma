import { describe, test, expect } from 'vitest';
import { Interface, getAddress } from 'ethers';
import { UMBRAE_ROUTER } from '../../core/wallet/trade-policy.js';
import { classifyLpTransaction, checkLpIntent, UMBRAE_BASE } from '../../core/wallet/lp-tx-policy.js';

// Real calldata from the router's published signature
// (https://www.umbrae.io/docs/dev/abi/v2/UmbraeLBRouterUpgradeable.json, sha256 c07775b9…).
const router = new Interface([
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, uint16[] binSteps, address[] pools, address to, uint256 deadline)',
  'function swapTokensForExactTokens(uint256, uint256, address[], uint16[], address[], address, uint256)',
  'function upgradeToAndCall(address newImplementation, bytes data)',
  'function rescuePairLp(address pair, uint256[] ids, uint256[] amounts, address to)',
]);
const erc20 = new Interface(['function transfer(address to, uint256 amount)', 'function approve(address spender, uint256 amount)', 'function transferFrom(address from, address to, uint256 amount)']);

const WALLET = '0x1111111111111111111111111111111111111111';
const HOUSE = '0x3333333333333333333333333333333333333333';
const THIEF = '0x2222222222222222222222222222222222222222';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const WETH = '0x4200000000000000000000000000000000000006';
const SCAM = '0x4444444444444444444444444444444444444444';
const POOL = getAddress('0x39460a75a7459fd694514b8847569ca136894b3e');
const tokens = new Set([USDC, WETH]);
const recipients = new Set([HOUSE]);
const ctx = { wallet: WALLET, tokens, recipients };
const judge = (tx, extra = {}) => classifyLpTransaction({ chainId: 8453, value: '0', ...tx }, { ...ctx, ...extra });
const swap = (overrides = {}) => {
  const a = { amountIn: 1_000_000n, min: 300_000_000_000_000n, path: [USDC, WETH], steps: [25], pools: [POOL], to: WALLET, ...overrides };
  return { to: UMBRAE_ROUTER, data: router.encodeFunctionData('swapExactTokensForTokens', [a.amountIn, a.min, a.path, a.steps, a.pools, a.to, 1_900_000_000n]) };
};

describe('trade-policy — swaps through Umbrae\'s router only', () => {
  test('the router is pinned beside the manager', () => {
    expect(UMBRAE_BASE.router).toBe(UMBRAE_ROUTER);
    expect(getAddress(UMBRAE_ROUTER)).toBe('0x5A7673d413f510f4b5c191d96837694C5942bF38');
  });

  test('an exact-in swap between pool tokens, paid to the wallet, under a minimum, is signable', () => {
    expect(judge(swap())).toEqual({
      ok: true, kind: 'swap', action: 'swapExactTokensForTokens', tokenIn: USDC, tokenOut: WETH, amountIn: '1000000', amountOutMin: '300000000000000',
    });
    expect(judge(swap({ path: [USDC, WETH, USDC], steps: [25, 25], pools: [POOL, POOL] })).ok).toBe(true);
  });

  test.each([
    ['paid to another wallet', swap({ to: THIEF }), /different wallet/],
    ['no minimum out', swap({ min: 0n }), /no minimum out/],
    ['a token no pool trades', swap({ path: [USDC, SCAM] }), /none of Umbrae's pools trade/],
    ['a malformed route', swap({ steps: [25, 25] }), /not well formed/],
    ['nothing moved', swap({ amountIn: 0n }), /moves nothing/],
  ])('a swap %s is refused', (_, tx, reason) => {
    expect(judge(tx).reason).toMatch(reason);
  });

  test('no other router function is signable: exact-out, upgrades, rescues', () => {
    for (const data of [
      router.encodeFunctionData('swapTokensForExactTokens', [1n, 1n, [USDC, WETH], [25], [POOL], WALLET, 1n]),
      router.encodeFunctionData('upgradeToAndCall', [THIEF, '0x']),
      router.encodeFunctionData('rescuePairLp', [POOL, [1n], [1n], WALLET]),
    ]) expect(judge({ to: UMBRAE_ROUTER, data }).ok).toBe(false);
  });

  test('a token approval may name the router, inside its ceiling; a pool approval may not', () => {
    const approve = (spender, amount) => judge({ to: USDC, data: erc20.encodeFunctionData('approve', [spender, amount]) }, { maxApprove: { [USDC]: '1000000' } });
    expect(approve(UMBRAE_ROUTER, 1_000_000n)).toMatchObject({ ok: true, kind: 'approval', action: 'token-approval' });
    expect(approve(UMBRAE_ROUTER, 1_000_001n).reason).toMatch(/larger than this action/);
    expect(approve(THIEF, 1n).reason).toMatch(/spender other than/);
    const pool = new Interface(['function setApprovalForAll(address spender, bool approved)']);
    expect(judge({ to: POOL, data: pool.encodeFunctionData('setApprovalForAll', [UMBRAE_ROUTER, true]) }).ok).toBe(false);
  });
});

describe('trade-policy — sends stay inside the house', () => {
  test('ETH to a house wallet is signable; to anyone else it is refused', () => {
    expect(judge({ to: HOUSE, data: '0x', value: '1000' })).toEqual({ ok: true, kind: 'transfer', action: 'send-eth', token: null, to: HOUSE, amount: '1000' });
    expect(judge({ to: THIEF, data: '0x', value: '1000' }).reason).toMatch(/not in the house/);
    expect(judge({ to: HOUSE, data: '0x', value: '0' }).reason).toMatch(/moves nothing/);
  });

  test('a pool token to a house wallet is signable; to anyone else, or of another token, it is refused', () => {
    const send = (token, to, amount = 5n) => judge({ to: token, data: erc20.encodeFunctionData('transfer', [to, amount]) });
    expect(send(USDC, HOUSE)).toEqual({ ok: true, kind: 'transfer', action: 'send-token', token: USDC, to: HOUSE, amount: '5' });
    expect(send(USDC, THIEF).reason).toMatch(/not in the house/);
    expect(send(SCAM, HOUSE).reason).toMatch(/does not deal with/);
    expect(send(USDC, HOUSE, 0n).reason).toMatch(/moves nothing/);
  });

  test('ETH riding on a contract call, transferFrom, and a send with no lists are refused', () => {
    expect(judge({ ...swap(), value: '1' }).reason).toMatch(/sends ETH with a contract call/);
    expect(judge({ to: USDC, data: erc20.encodeFunctionData('transferFrom', [WALLET, HOUSE, 1n]) }).ok).toBe(false);
    expect(classifyLpTransaction({ to: HOUSE, data: '0x', value: '1', chainId: 8453 }, { wallet: WALLET }).ok).toBe(false);
  });
});

describe('trade-policy — the transaction must be the one asked for', () => {
  test('a swap must trade the tokens asked for no more than asked', () => {
    const v = judge(swap());
    expect(checkLpIntent(v, { kind: 'swap', tokenIn: USDC, tokenOut: WETH, amountIn: '1000000' })).toEqual({ ok: true });
    expect(checkLpIntent(v, { kind: 'swap', tokenIn: USDC, tokenOut: WETH, amountIn: '999999' }).reason).toMatch(/spends more/);
    expect(checkLpIntent(v, { kind: 'swap', tokenIn: WETH, tokenOut: USDC, amountIn: '1000000' }).reason).toMatch(/other tokens/);
    expect(checkLpIntent(v, { kind: 'transfer', to: HOUSE, amount: '1' }).reason).toMatch(/not the kind/);
  });

  test('a send must reach the address asked, with the token asked, for no more than asked', () => {
    const eth = judge({ to: HOUSE, data: '0x', value: '1000' });
    expect(checkLpIntent(eth, { kind: 'transfer', to: HOUSE, token: null, amount: '1000' })).toEqual({ ok: true });
    expect(checkLpIntent(eth, { kind: 'transfer', to: HOUSE, token: null, amount: '999' }).reason).toMatch(/moves more/);
    expect(checkLpIntent(eth, { kind: 'transfer', to: THIEF, token: null, amount: '1000' }).reason).toMatch(/different address/);
    expect(checkLpIntent(eth, { kind: 'transfer', to: HOUSE, token: USDC, amount: '1000' }).reason).toMatch(/different token/);
    const usdc = judge({ to: USDC, data: erc20.encodeFunctionData('transfer', [HOUSE, 5n]) });
    expect(checkLpIntent(usdc, { kind: 'transfer', to: HOUSE, token: USDC, amount: '5' })).toEqual({ ok: true });
    expect(checkLpIntent(usdc, { kind: 'transfer', to: HOUSE, token: null, amount: '5' }).reason).toMatch(/different token/);
  });
});
