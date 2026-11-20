import { describe, expect, test } from 'vitest';
import { Interface, ZeroAddress } from 'ethers';
import { KYBER_ABI, KYBER_EXECUTOR, KYBER_ROUTER, classifyAggregatorSwap } from '../../core/wallet/aggregator-policy.js';
import { UMBRAE_BASE, checkLpIntent, classifyLpTransaction } from '../../core/wallet/lp-tx-policy.js';

const WALLET = '0x1111111111111111111111111111111111111111';
const THIEF = '0x2222222222222222222222222222222222222222';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const WETH = '0x4200000000000000000000000000000000000006';
const POOL = '0x3333333333333333333333333333333333333333';
const KYBER = new Interface(KYBER_ABI);
const ERC20 = new Interface(['function approve(address spender,uint256 amount)']);
const NFT = new Interface(['function setApprovalForAll(address spender,bool approved)']);

const kyberTx = ({ execution = {}, desc = {}, simple = false } = {}) => {
  const description = {
    srcToken: USDC, dstToken: WETH, srcReceivers: [KYBER_EXECUTOR], srcAmounts: [10n],
    feeReceivers: [], feeAmounts: [], dstReceiver: WALLET, amount: 10n,
    minReturnAmount: 9n, flags: 0n, permit: '0x', ...desc,
  };
  const data = simple
    ? KYBER.encodeFunctionData('swapSimpleMode', [KYBER_EXECUTOR, description, '0x', '0x'])
    : KYBER.encodeFunctionData('swap', [{ callTarget: KYBER_EXECUTOR, approveTarget: ZeroAddress, targetData: '0x', desc: description, clientData: '0x', ...execution }]);
  return { to: KYBER_ROUTER, chainId: 8453, value: '0', data };
};

const approvalTx = (spender = UMBRAE_BASE.positionManager, amount = 10n) => ({
  to: USDC, chainId: 8453, value: '0', data: ERC20.encodeFunctionData('approve', [spender, amount]),
});
const poolTx = (approved) => ({
  to: POOL, chainId: 8453, value: '0', data: NFT.encodeFunctionData('setApprovalForAll', [UMBRAE_BASE.positionManager, approved]),
});

describe('P6-23 aggregator routing is part of the signed intent', () => {
  test('the pinned full swap and exact source total are accepted', () => {
    expect(classifyAggregatorSwap(kyberTx(), { wallet: WALLET, tokens: new Set([USDC, WETH]) })).toMatchObject({
      ok: true, action: 'kyberswap.swap', amountIn: '10', amountOutMin: '9',
    });
    expect(classifyAggregatorSwap(kyberTx({ desc: { srcReceivers: [KYBER_EXECUTOR, KYBER_EXECUTOR], srcAmounts: [4n, 6n] } }), { wallet: WALLET, tokens: new Set([USDC, WETH]) }).ok).toBe(true);
  });

  test.each([
    ['executor', { execution: { callTarget: THIEF } }, /executor/],
    ['approval target', { execution: { approveTarget: THIEF } }, /approval target/],
    ['source receiver', { desc: { srcReceivers: [THIEF] } }, /source receivers/],
    ['source total', { desc: { srcAmounts: [9n] } }, /do not sum/],
    ['flag 0x200', { desc: { flags: 0x200n } }, /flags/],
  ])('a hostile %s is refused', (_name, change, reason) => {
    expect(classifyAggregatorSwap(kyberTx(change), { wallet: WALLET, tokens: new Set([USDC, WETH]) }).reason).toMatch(reason);
  });

  test('simple mode is default-denied even with a safe receiver', () => {
    expect(classifyAggregatorSwap(kyberTx({ simple: true }), { wallet: WALLET, tokens: new Set([USDC, WETH]) }).reason).toMatch(/full swap/);
  });
});

describe('P6-24 approvals are bound and decoders refuse rather than throw', () => {
  test('a token allowance succeeds only for its asked spender and token', () => {
    const verdict = classifyLpTransaction(approvalTx(), { wallet: WALLET, maxApprove: { [USDC]: '10' } });
    expect(verdict).toMatchObject({ ok: true, spender: UMBRAE_BASE.positionManager, target: USDC });
    expect(checkLpIntent(verdict, { kind: 'approval', spender: UMBRAE_BASE.positionManager, token: USDC })).toEqual({ ok: true });
    expect(checkLpIntent(verdict, { kind: 'approval', spender: THIEF, token: USDC }).reason).toMatch(/different spender/);
    expect(checkLpIntent(verdict, { kind: 'approval', spender: UMBRAE_BASE.positionManager, token: WETH }).reason).toMatch(/different token/);
  });

  test('zero token allowance and pool revocation are explicit successful cleanup', () => {
    const token = classifyLpTransaction(approvalTx(UMBRAE_BASE.positionManager, 0n), { wallet: WALLET, maxApprove: { [USDC]: '0' } });
    expect(checkLpIntent(token, { kind: 'approval', spender: UMBRAE_BASE.positionManager, token: USDC, revoke: true })).toEqual({ ok: true });
    const grant = classifyLpTransaction(approvalTx(), { wallet: WALLET, maxApprove: { [USDC]: '10' } });
    expect(checkLpIntent(grant, { kind: 'approval', spender: UMBRAE_BASE.positionManager, token: USDC, revoke: true }).reason).toMatch(/not the zero-allowance cleanup/);
    const pool = classifyLpTransaction(poolTx(false), { wallet: WALLET });
    expect(pool).toMatchObject({ ok: true, action: 'pool-revocation', spender: UMBRAE_BASE.positionManager });
    expect(checkLpIntent(pool, { kind: 'approval', pool: POOL, spender: UMBRAE_BASE.positionManager, revoke: true })).toEqual({ ok: true });
    expect(checkLpIntent(pool, { kind: 'approval', pool: POOL, spender: UMBRAE_BASE.positionManager }).reason).toMatch(/must be the cleanup/);
  });

  test('a wrong pool spender and malformed address are ordinary refusals', () => {
    const pool = classifyLpTransaction(poolTx(true), { wallet: WALLET });
    expect(checkLpIntent(pool, { kind: 'approval', pool: POOL, spender: THIEF }).ok).toBe(false);
    const malformed = { ...approvalTx(), to: '0x833589fCd6eDb6E08f4c7C32D4f71b54bdA0291A' };
    expect(() => classifyLpTransaction(malformed, { wallet: WALLET, maxApprove: {} })).not.toThrow();
    expect(classifyLpTransaction(malformed, { wallet: WALLET, maxApprove: {} }).ok).toBe(false);
  });
});
