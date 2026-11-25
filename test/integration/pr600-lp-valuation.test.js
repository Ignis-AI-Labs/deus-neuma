import fs from 'node:fs/promises';
import { ethers } from 'ethers';
import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'vitest';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { createTempDir } from '../helpers/temp-fs.js';
import { startAnvil } from '../helpers/money-in-kit.js';
import { connectionsOn } from '../helpers/connections-kit.js';
import { startUmbraeStandIn, POOL, WETH, USDC } from '../helpers/umbrae-stand-in.js';
import { installLpManager, installLpPool } from '../helpers/lp-chain-kit.js';
import { returnContract } from '../helpers/evm-return-contract.js';
import { UMBRAE_BASE } from '../../core/wallet/lp-tx-policy.js';
import { binIdFor } from '../../core/wallet/pool-policy.js';
import { openLpWallet } from '../../backend/services/umbrae-lp/lp-wallet.js';
import { addPendingDeposit, listPendingDeposits, writeLpBudget, MAX_PENDING_DEPOSITS } from '../../backend/services/umbrae-lp/lp-budget.js';
import { answerWaitingDeposit } from '../../backend/services/umbrae-lp/lp-run.js';
import { depositWithinSnapshot } from '../../backend/services/umbrae-lp/lp-budget-independent.js';
import { verifiedPoolPrice } from '../../backend/services/umbrae-lp/lp-price-feeds.js';
import { callUmbrae } from '../../backend/services/umbrae-lp/umbrae-lp-client.js';
import { clearMarketCache } from '../../backend/services/market-map/market-data.js';

const LANE = 'pr600-lp-valuation';
const activeFor = (price) => binIdFor(price, 25);
const open = { type: 'open', pool: POOL, amountY: '5', strategy: 0, binRange: 10 };
let anvil; let provider; let root; let priorRoot; let umbrae; let connections; let wallet;

beforeAll(async () => {
  anvil = await startAnvil({ chainId: 8453 });
  provider = new ethers.JsonRpcProvider(anvil.url, ethers.Network.from(8453), { staticNetwork: true, pollingInterval: 60 });
  root = await createTempDir('pr600-lp-valuation');
  priorRoot = getWorkspacesRoot();
  setWorkspacesRoot(root);
  await workspace.create(LANE);
  wallet = (await openLpWallet(LANE)).address;
  await provider.send('anvil_setBalance', [wallet, ethers.toQuantity(ethers.parseEther('1'))]);
  umbrae = await startUmbraeStandIn({ provider });
  for (const [token, units, symbol] of [[WETH, 18, 'WETH'], [USDC, 6, 'USDC']]) {
    await provider.send('anvil_setCode', [token, returnContract({
      fallback: ethers.AbiCoder.defaultAbiCoder().encode(['uint8'], [units]),
      routes: { [ethers.id('symbol()').slice(0, 10)]: ethers.AbiCoder.defaultAbiCoder().encode(['string'], [symbol]) },
    })]);
  }
}, 30000);

afterAll(async () => {
  connections?.restore();
  await umbrae?.close();
  provider?.destroy();
  await anvil?.stop();
  setWorkspacesRoot(priorRoot);
  if (root) await fs.rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  umbrae.reset();
  clearMarketCache();
  connections?.restore();
  connections = connectionsOn(['umbrae-liquidity', 'market-data']);
  await installLpPool(provider, POOL, 5000, WETH, USDC, 25, activeFor(3200));
  await installLpManager(provider, UMBRAE_BASE.positionManager);
  for (const { id } of await listPendingDeposits(LANE)) {
    const { takePendingDeposit } = await import('../../backend/services/umbrae-lp/lp-budget.js');
    await takePendingDeposit(LANE, id, 'declined');
  }
});

describe('P6-32 — bounded, snapshot-bound deposits', () => {
  test('25 deposits wait, the 26th refuses without changing the list', async () => {
    for (let index = 0; index < MAX_PENDING_DEPOSITS; index += 1) {
      await addPendingDeposit(LANE, { action: open, depositUsd: '5', reason: `request ${index}` });
    }
    await expect(addPendingDeposit(LANE, { action: open, depositUsd: '5', reason: 'one too many' })).rejects.toThrow(/Too many deposits/);
    expect(await listPendingDeposits(LANE)).toHaveLength(25);
  });

  test('the snapshot comparison is exact at 2% and refuses a larger move or unknown value', () => {
    expect(depositWithinSnapshot(ethers.parseUnits('5.1', 6), '5')).toBe(true);
    expect(depositWithinSnapshot(ethers.parseUnits('5.11', 6), '5')).toBe(false);
    expect(depositWithinSnapshot(null, '5')).toBe(false);
    expect(depositWithinSnapshot(ethers.parseUnits('5', 6), 'unknown')).toBe(false);
  });

  test('a valid waiting approval mines once through the real LP path', async () => {
    await writeLpBudget(LANE, 9);
    umbrae.state.positions = [{ positions: { userPositions: [{ publicKey: '42', positionData: { totalXAmount: '0', totalYAmount: '6' } }] }, poolInfo: { mint_x: WETH, mint_y: USDC, tokenXPriceUsd: 3200, tokenYPriceUsd: 1 } }];
    await installLpManager(provider, UMBRAE_BASE.positionManager, 1n, { pair: POOL, owner: wallet });
    const pending = await import('../../backend/services/umbrae-lp/lp-run.js').then(({ runLpAction }) => runLpAction(LANE, open, { provider, receiptProvider: provider, receiptConfirmations: 1, pollMs: 50 }));
    expect(pending).toMatchObject({ ok: false, pending: true });
    const yes = await answerWaitingDeposit(LANE, pending.requestId, 'approved', { provider, receiptProvider: provider, receiptConfirmations: 1, pollMs: 50 });
    expect(yes.ok, yes.reason).toBe(true);
    expect(yes).toMatchObject({ type: 'open', tokenId: '77' });
    expect((await provider.getTransactionReceipt(yes.txHashes.at(-1))).status).toBe(1);
    expect((await answerWaitingDeposit(LANE, pending.requestId, 'approved', { provider })).ok).toBe(false);
  }, 60000);

  test('a moved or unknown approved value refuses before any LP transaction', async () => {
    const moved = await addPendingDeposit(LANE, { action: open, depositUsd: '4', reason: 'snapshot was four dollars' });
    const movedResult = await answerWaitingDeposit(LANE, moved.id, 'approved', { provider, receiptProvider: provider, receiptConfirmations: 1, pollMs: 50 });
    expect(movedResult.ok).toBe(false);
    expect(movedResult.reason).toMatch(/no longer has the dollar value/);
    const unknown = await addPendingDeposit(LANE, { action: open, depositUsd: 'unknown', reason: 'no honest value' });
    const unknownResult = await answerWaitingDeposit(LANE, unknown.id, 'approved', { provider, receiptProvider: provider, receiptConfirmations: 1, pollMs: 50 });
    expect(unknownResult.ok).toBe(false);
    expect(umbrae.seen.filter((row) => row.url === '/api/v1/base/send')).toEqual([]);
  }, 60000);
});

describe('P6-32 — independent book price evidence', () => {
  test('agreeing independent markets and the real active bin price WETH conservatively', async () => {
    const pools = await callUmbrae('pools');
    expect(pools.ok).toBe(true);
    expect(await verifiedPoolPrice(provider, WETH, pools.payload)).toBeCloseTo(3196.8358471323163, 8);
    expect(await verifiedPoolPrice(provider, USDC, pools.payload)).toBe(1);
  });

  test('pool-list inflation is ignored and manipulated market or on-chain evidence is unpriced', async () => {
    umbrae.state.wethPrice = 999_999;
    const pools = await callUmbrae('pools');
    expect(pools.payload.groups[0].tokenXPrice).toBe(999_999);
    expect(await verifiedPoolPrice(provider, WETH, pools.payload)).toBeCloseTo(3196.8358471323163, 8);
    umbrae.state.dexPriceUsd = 0.001;
    clearMarketCache();
    expect(await verifiedPoolPrice(provider, WETH, pools.payload)).toBeNull();
    umbrae.reset();
    clearMarketCache();
    await installLpPool(provider, POOL); // active bin 1 USDC/WETH, not the independent $3200 market
    expect(await verifiedPoolPrice(provider, WETH, pools.payload)).toBeNull();
  });
});
