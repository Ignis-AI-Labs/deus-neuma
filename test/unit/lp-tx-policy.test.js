import { describe, test, expect } from 'vitest';
import { Interface, parseUnits } from 'ethers';
import {
  UMBRAE_BASE, classifyLpTransaction, depositMicroUsd, classifyDeposit,
  checkLpIntent, positionsMicroUsd,
} from '../../core/wallet/lp-tx-policy.js';

// Real calldata, encoded here from the position manager's published
// signatures (https://www.umbrae.io/docs/dev/abi/v2/PositionNFTManagerV2.json).
const manager = new Interface([
  'function createPositionWithStrategy(address tokenX, address tokenY, uint16 binStep, uint16 baseFactor, uint256 amountX, uint256 amountY, uint8 strategy, uint24 binRange, uint8 bidAskRatio, uint24 centerBinId, bool skipActiveBin, uint24 activeIdDesired, uint24 idSlippage, uint256 minTotalLiquidity, address recipient, uint256 deadline)',
  'function increasePositionWithStrategy(uint256 tokenId, uint256 amountX, uint256 amountY, uint24 centerBinId, bool skipActiveBin, uint24 activeIdDesired, uint24 idSlippage, uint256 minTotalLiquidity, uint256 deadline)',
  'function claimFees(uint256 tokenId, address recipient, uint256 deadline)',
  'function claimFeesRange(uint256 tokenId, uint256 startIndex, uint256 binCount, address recipient, uint256 deadline)',
  'function closePosition(uint256 tokenId, uint256 amountXMin, uint256 amountYMin, address recipient, uint256 deadline)',
  'function decreasePosition(uint256 tokenId, uint24[] binIds, uint256[] lpAmounts, uint256 amountXMin, uint256 amountYMin, address recipient, uint256 deadline)',
  'function decreasePositionByPercent(uint256 tokenId, uint16 bps, uint256 amountXMin, uint256 amountYMin, address recipient, uint256 deadline)',
  'function approve(address to, uint256 tokenId)',
  'function setApprovalForAll(address operator, bool approved)',
  'function transferFrom(address from, address to, uint256 tokenId)',
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
  'function upgradeToAndCall(address newImplementation, bytes data)',
  'function rescuePairLp(address pair, uint256[] ids, uint256[] amounts, address to)',
]);
const erc20 = new Interface([
  'function approve(address spender, uint256 amount)',
  'function transfer(address to, uint256 amount)',
]);
const pool = new Interface(['function setApprovalForAll(address spender, bool approved)']);

const WALLET = '0x1111111111111111111111111111111111111111';
const THIEF = '0x2222222222222222222222222222222222222222';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const WETH = '0x4200000000000000000000000000000000000006';
const POOL = '0x3333333333333333333333333333333333333333';
const MANAGER = UMBRAE_BASE.positionManager;
const DEADLINE = 1_800_000_000n;

const toManager = (name, args, extra = {}) => ({
  to: MANAGER, chainId: 8453, value: '0', data: manager.encodeFunctionData(name, args), ...extra,
});
const createArgs = (recipient) => [WETH, USDC, 25, 5000, 0n, 5_000_000n, 0, 10, 50, 0, false, 8_388_608, 10, 1n, recipient, DEADLINE];
const judge = (tx, ctx = {}) => classifyLpTransaction(tx, { wallet: WALLET, ...ctx });

describe('lp-tx-policy — what the LP wallet may sign', () => {
  test('a new position paid back to the signing wallet is a deposit, with its tokens and raw amounts', () => {
    expect(judge(toManager('createPositionWithStrategy', createArgs(WALLET)))).toMatchObject({
      ok: true, kind: 'deposit', action: 'createPositionWithStrategy', tokenId: null,
      tokenX: WETH, tokenY: USDC, amountX: '0', amountY: '5000000',
    });
  });

  test('adding to a position is a deposit that names its position', () => {
    const verdict = judge(toManager('increasePositionWithStrategy', [42n, 7n, 9n, 0, false, 8_388_608, 5, 0n, DEADLINE]));
    expect(verdict).toMatchObject({ ok: true, kind: 'deposit', tokenId: '42', amountX: '7', amountY: '9', tokenX: null });
  });

  test.each([
    ['claimFees', [42n, WALLET, DEADLINE]],
    ['claimFeesRange', [42n, 0n, 20n, WALLET, DEADLINE]],
    ['closePosition', [42n, 0n, 0n, WALLET, DEADLINE]],
    ['decreasePosition', [42n, [8_388_600, 8_388_601], [10n, 11n], 0n, 0n, WALLET, DEADLINE]],
    ['decreasePositionByPercent', [42n, 10_000, 0n, 0n, WALLET, DEADLINE]],
  ])('%s paid to the signing wallet is an exit', (name, args) => {
    expect(judge(toManager(name, args))).toMatchObject({ ok: true, kind: 'exit', action: name, tokenId: '42' });
  });

  test.each([
    ['createPositionWithStrategy', createArgs(THIEF)],
    ['claimFees', [42n, THIEF, DEADLINE]],
    ['claimFeesRange', [42n, 0n, 20n, THIEF, DEADLINE]],
    ['closePosition', [42n, 0n, 0n, THIEF, DEADLINE]],
    ['decreasePosition', [42n, [8_388_600], [10n], 0n, 0n, THIEF, DEADLINE]],
    ['decreasePositionByPercent', [42n, 10_000, 0n, 0n, THIEF, DEADLINE]],
  ])('%s paying another wallet is refused', (name, args) => {
    const verdict = judge(toManager(name, args));
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/different wallet/);
  });

  test.each([
    ['approve', [THIEF, 42n]],
    ['setApprovalForAll', [THIEF, true]],
    ['setApprovalForAll', [MANAGER, true]],
    ['transferFrom', [WALLET, THIEF, 42n]],
    ['safeTransferFrom', [WALLET, THIEF, 42n]],
    ['upgradeToAndCall', [THIEF, '0x']],
    ['rescuePairLp', [POOL, [1n], [1n], THIEF]],
  ])('the manager\'s %s is never signed', (name, args) => {
    expect(judge(toManager(name, args)).ok).toBe(false);
  });

  test('a token approval for the manager, inside the stated ceiling, is signed', () => {
    const tx = { to: USDC, chainId: 8453, data: erc20.encodeFunctionData('approve', [MANAGER, 10_000_000n]) };
    expect(judge(tx, { maxApprove: { [USDC]: '10000000' } })).toEqual({
      ok: true, kind: 'approval', action: 'token-approval', target: USDC, spender: MANAGER, amount: '10000000',
    });
  });

  test('a token approval over the ceiling, with no ceiling, or for another token is refused', () => {
    const tx = { to: USDC, chainId: 8453, data: erc20.encodeFunctionData('approve', [MANAGER, 10_000_001n]) };
    expect(judge(tx, { maxApprove: { [USDC]: '10000000' } }).ok).toBe(false);
    expect(judge(tx).ok).toBe(false);
    expect(judge(tx, { maxApprove: { [WETH]: '99999999999' } }).ok).toBe(false);
  });

  test('a token approval for any other spender is refused, whatever the amount', () => {
    const tx = { to: USDC, chainId: 8453, data: erc20.encodeFunctionData('approve', [THIEF, 1n]) };
    expect(judge(tx, { maxApprove: { [USDC]: '10000000' } }).reason).toMatch(/spender other than/);
  });

  test('a pool grant or revocation names the manager; anyone else is refused', () => {
    const grant = (spender, approved) => ({ to: POOL, chainId: 8453, data: pool.encodeFunctionData('setApprovalForAll', [spender, approved]) });
    expect(judge(grant(MANAGER, true))).toEqual({ ok: true, kind: 'approval', action: 'pool-approval', target: POOL, spender: MANAGER });
    expect(judge(grant(MANAGER, false))).toEqual({ ok: true, kind: 'approval', action: 'pool-revocation', target: POOL, spender: MANAGER });
    expect(judge(grant(THIEF, true)).ok).toBe(false);
    expect(judge(grant(THIEF, false)).ok).toBe(false);
  });

  test('a plain token transfer is refused', () => {
    const tx = { to: USDC, chainId: 8453, data: erc20.encodeFunctionData('transfer', [THIEF, 1n]) };
    expect(judge(tx, { maxApprove: { [USDC]: '10000000' } }).ok).toBe(false);
  });

  test('another chain, any ETH value, empty data, a missing target or a missing wallet is refused', () => {
    const good = toManager('claimFees', [42n, WALLET, DEADLINE]);
    expect(judge({ ...good, chainId: 1 }).reason).toMatch(/not Base/);
    expect(judge({ ...good, value: '1' }).reason).toMatch(/sends ETH/);
    expect(judge({ ...good, value: '0x01' }).ok).toBe(false);
    expect(judge({ ...good, data: '0x' }).ok).toBe(false);
    expect(judge({ ...good, to: undefined }).ok).toBe(false);
    expect(judge(null).ok).toBe(false);
    expect(classifyLpTransaction(good, {}).ok).toBe(false);
    expect(judge({ ...good, value: undefined }).ok).toBe(true);
    expect(judge({ ...good, value: '0x0' }).ok).toBe(true);
  });

  test('calldata with a known selector and broken arguments is refused', () => {
    const good = toManager('claimFees', [42n, WALLET, DEADLINE]);
    expect(judge({ ...good, data: good.data.slice(0, 40) }).ok).toBe(false);
  });
});

describe('lp-tx-policy — the budget', () => {
  const usd = (n) => parseUnits(String(n), 6);
  const five = { amountX: '0', amountY: '5000000', decimalsX: 18, decimalsY: 6, priceXUsd: 3200.5, priceYUsd: 1 };

  test('a deposit is sized in dollars from raw amounts and the pool\'s prices', () => {
    expect(depositMicroUsd(five)).toBe(usd(5));
    expect(depositMicroUsd({ ...five, amountX: parseUnits('0.01', 18).toString() })).toBe(usd(37.005));
  });

  test('a deposit with a missing or unusable figure has no size', () => {
    expect(depositMicroUsd({ ...five, priceYUsd: undefined })).toBeNull();
    expect(depositMicroUsd({ ...five, priceXUsd: -1 })).toBeNull();
    expect(depositMicroUsd({ ...five, decimalsY: 6.5 })).toBeNull();
    expect(depositMicroUsd({ ...five, amountY: 'lots' })).toBeNull();
    expect(depositMicroUsd()).toBeNull();
  });

  test('inside the budget runs free, to the cent', () => {
    expect(classifyDeposit({ budgetUsd: 100, deployedMicroUsd: usd(95), depositMicroUsd: usd(5) })).toBe('free');
    expect(classifyDeposit({ budgetUsd: '100', deployedMicroUsd: usd(95), depositMicroUsd: usd(5) + 1n })).toBe('pending');
  });

  test('with no cap set, every deposit runs, sized or not (Design note, 2026-11-13, "total control")', () => {
    expect(classifyDeposit({ deployedMicroUsd: 0n, depositMicroUsd: usd(5_000) })).toBe('free');
    expect(classifyDeposit({ budgetUsd: null, deployedMicroUsd: null, depositMicroUsd: null })).toBe('free');
    expect(classifyDeposit()).toBe('free');
  });

  test('with a cap set: a zero cap, an unreadable cap or figure waits for the operator', () => {
    const base = { deployedMicroUsd: 0n, depositMicroUsd: usd(5) };
    expect(classifyDeposit({ ...base, budgetUsd: 0 })).toBe('pending');
    expect(classifyDeposit({ ...base, budgetUsd: 'plenty' })).toBe('pending');
    expect(classifyDeposit({ ...base, budgetUsd: -50 })).toBe('pending');
    expect(classifyDeposit({ budgetUsd: 100, deployedMicroUsd: null, depositMicroUsd: usd(5) })).toBe('pending');
    expect(classifyDeposit({ budgetUsd: 100, deployedMicroUsd: 0n, depositMicroUsd: null })).toBe('pending');
    expect(classifyDeposit({ budgetUsd: 100, deployedMicroUsd: 0n, depositMicroUsd: 0n })).toBe('pending');
  });

  test('what is already in positions is totalled from Umbrae\'s amounts and prices', () => {
    const pools = [
      { positions: { userPositions: [{ positionData: { totalXAmount: '0.01', totalYAmount: '5' } }, { positionData: { totalXAmount: '0', totalYAmount: '2.5' } }] }, poolInfo: { tokenXPriceUsd: 3200.5, tokenYPriceUsd: 1 } },
      { positions: { userPositions: [] }, poolInfo: { tokenXPriceUsd: 1, tokenYPriceUsd: 1 } },
    ];
    expect(positionsMicroUsd(pools)).toBe(usd(39.505));
    expect(positionsMicroUsd([])).toBe(0n);
  });

  test('a positions answer that cannot be read whole has no total', () => {
    const good = { positionData: { totalXAmount: '1', totalYAmount: '1' } };
    expect(positionsMicroUsd(undefined)).toBeNull();
    expect(positionsMicroUsd({})).toBeNull();
    expect(positionsMicroUsd([{ poolInfo: { tokenXPriceUsd: 1, tokenYPriceUsd: 1 } }])).toBeNull();
    expect(positionsMicroUsd([{ positions: { userPositions: [good] }, poolInfo: { tokenXPriceUsd: 1 } }])).toBeNull();
    expect(positionsMicroUsd([{ positions: { userPositions: [{ positionData: { totalXAmount: '1e3', totalYAmount: '1' } }] }, poolInfo: { tokenXPriceUsd: 1, tokenYPriceUsd: 1 } }])).toBeNull();
    expect(positionsMicroUsd([{ positions: { userPositions: [{ positionData: { totalXAmount: 5, totalYAmount: '1' } }] }, poolInfo: { tokenXPriceUsd: 1, tokenYPriceUsd: 1 } }])).toBeNull();
  });
});

describe('lp-tx-policy — the transaction must be the one that was asked for', () => {
  const deposit = judge(toManager('createPositionWithStrategy', createArgs(WALLET)));
  const askedDeposit = {
    kind: 'deposit', action: 'createPositionWithStrategy', tokenX: WETH, tokenY: USDC, amountX: '0', amountY: '5000000',
    binStep: 25, baseFactor: 5000, strategy: 0, binRange: 10, bidAskRatio: 50, centerBinId: 0,
    skipActiveBin: false, activeIdDesired: 8_388_608, idSlippage: 10, minTotalLiquidity: '1',
  };
  const exit = judge(toManager('claimFees', [42n, WALLET, DEADLINE]));

  test('the deposit that was sized, or a smaller one, is the one asked for', () => {
    expect(deposit.ok).toBe(true);
    expect(checkLpIntent(deposit, askedDeposit)).toEqual({ ok: true });
    expect(checkLpIntent(deposit, { ...askedDeposit, amountY: '9000000' })).toEqual({ ok: true });
  });

  test('a larger deposit, other tokens, or a deposit where an exit was asked is refused', () => {
    expect(checkLpIntent(deposit, { ...askedDeposit, amountY: '4999999' }).reason).toMatch(/larger/);
    expect(checkLpIntent(deposit, { ...askedDeposit, tokenY: THIEF }).reason).toMatch(/different tokens/);
    expect(checkLpIntent(deposit, { ...askedDeposit, amountX: undefined }).ok).toBe(false);
    expect(checkLpIntent(deposit, { kind: 'exit', tokenId: '42' }).reason).toMatch(/not the kind/);
    expect(checkLpIntent(exit, askedDeposit).reason).toMatch(/not the kind/);
  });

  test('an exit or a top-up must name the position and exact action that were asked', () => {
    const askedExit = { kind: 'exit', tokenId: '42', actions: ['claimFees'] };
    expect(checkLpIntent(exit, askedExit)).toEqual({ ok: true });
    expect(checkLpIntent(exit, { ...askedExit, tokenId: 42 })).toEqual({ ok: true });
    expect(checkLpIntent(exit, { ...askedExit, tokenId: '43' }).reason).toMatch(/different position/);
    expect(checkLpIntent(exit, { kind: 'exit', tokenId: '42' }).reason).toMatch(/exit action/);
    const topUp = judge(toManager('increasePositionWithStrategy', [42n, 0n, 5_000_000n, 0, false, 8_388_608, 10, 1n, DEADLINE]));
    expect(topUp.ok).toBe(true);
    const askedTopUp = { kind: 'deposit', action: 'increasePositionWithStrategy', tokenId: '42', amountX: '0', amountY: '5000000', centerBinId: 0, skipActiveBin: false, activeIdDesired: 8_388_608, idSlippage: 10, minTotalLiquidity: '1' };
    expect(checkLpIntent(topUp, askedTopUp)).toEqual({ ok: true });
    expect(checkLpIntent(topUp, { ...askedTopUp, tokenId: '7' }).reason).toMatch(/different position/);
  });

  test('a pool and token approval must be for the pool and spender that were named', () => {
    const poolApproval = judge({ to: POOL, chainId: 8453, data: pool.encodeFunctionData('setApprovalForAll', [MANAGER, true]) });
    expect(checkLpIntent(poolApproval, { kind: 'approval', pool: POOL, spender: MANAGER })).toEqual({ ok: true });
    expect(checkLpIntent(poolApproval, { kind: 'approval', pool: THIEF, spender: MANAGER }).reason).toMatch(/different pool/);
    expect(checkLpIntent(poolApproval, { kind: 'approval', pool: POOL, spender: THIEF }).reason).toMatch(/different spender/);
    expect(checkLpIntent(poolApproval, { kind: 'approval', pool: POOL }).ok).toBe(false);
    const tokenApproval = judge({ to: USDC, chainId: 8453, data: erc20.encodeFunctionData('approve', [MANAGER, 10n]) }, { maxApprove: { [USDC]: '10' } });
    expect(checkLpIntent(tokenApproval, { kind: 'approval', pool: POOL, spender: MANAGER, token: USDC })).toEqual({ ok: true });
  });

  test('a claim cannot become a close, and altered deposit economics are refused', () => {
    const close = judge(toManager('closePosition', [42n, 0n, 0n, WALLET, DEADLINE]));
    expect(checkLpIntent(close, { kind: 'exit', tokenId: '42', actions: ['claimFees'], amountXMin: '0', amountYMin: '0' }).reason).toMatch(/exit action/);
    for (const [field, value] of [['strategy', 2], ['binRange', 35], ['activeIdDesired', 8_388_609], ['minTotalLiquidity', 0n]]) {
      const args = createArgs(WALLET);
      const index = { strategy: 6, binRange: 8, activeIdDesired: 11, minTotalLiquidity: 13 }[field];
      args[index] = value;
      const altered = judge(toManager('createPositionWithStrategy', args));
      expect(checkLpIntent(altered, askedDeposit).ok).toBe(false);
    }
  });

  test('nothing asked, or nothing classified, is refused', () => {
    expect(checkLpIntent(exit).ok).toBe(false);
    expect(checkLpIntent({ ok: false, reason: 'no' }, { kind: 'exit', tokenId: '42' }).ok).toBe(false);
    expect(checkLpIntent().ok).toBe(false);
  });
});
