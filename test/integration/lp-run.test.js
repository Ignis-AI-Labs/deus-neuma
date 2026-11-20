/**
 * One LP action, start to finish (backend/services/umbrae-lp/lp-run.js), over
 * REAL parts (RULE 0): a real workspace on disk, a real chain node (anvil as
 * chain 8453) that mines every signed transaction, and a real HTTP listener
 * in Umbrae's place, reached through the client's own origin door. The
 * listener builds calldata from the position manager's published signatures,
 * forwards signed bytes to the node, and reads receipts back from it, so
 * […] is the node's word.
 *
 * NOT proven here: Umbrae's own server and its real position manager. Plain
 * anvil has no code at the manager's address. That is the fork proof and the
 * funded run (docs/work/umbrae-lp.md).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import { startAnvil } from '../helpers/money-in-kit.js';
import { returnContract } from '../helpers/evm-return-contract.js';
import { installLpManager, installLpPool } from '../helpers/lp-chain-kit.js';
import { connectionsOn } from '../helpers/connections-kit.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { startUmbraeStandIn, POOL, NEW_TOKEN } from '../helpers/umbrae-stand-in.js';
import { UMBRAE_BASE } from '../../core/wallet/lp-tx-policy.js';
import { openLpWallet, lpWalletAddress, readUmbraeKey } from '../../backend/services/umbrae-lp/lp-wallet.js';
import { writeLpBudget, listPendingDeposits } from '../../backend/services/umbrae-lp/lp-budget.js';
import { runLpAction, answerWaitingDeposit } from '../../backend/services/umbrae-lp/lp-run.js';
import { clearMarketCache } from '../../backend/services/market-map/market-data.js';

const NEUMA_ID = 'lprunecho';

let anvil;
let provider;
let root;
let originalRoot;
let umbrae;
let connections;
let wallet;
let seen;

beforeAll(async () => {
  anvil = await startAnvil({ chainId: 8453 });
  provider = new ethers.JsonRpcProvider(anvil.url, ethers.Network.from(8453), { staticNetwork: true, pollingInterval: 100 });
  root = await createTempDir('lp-run');
  originalRoot = getWorkspacesRoot();
  setWorkspacesRoot(root);
  await workspace.create(NEUMA_ID);
  wallet = (await openLpWallet(NEUMA_ID)).address;
  await provider.send('anvil_setBalance', [wallet, ethers.toQuantity(ethers.parseEther('1'))]);
  umbrae = await startUmbraeStandIn({ provider });
  await installLpPool(provider, POOL);
  await installLpManager(provider, UMBRAE_BASE.positionManager);
  for (const [token, units, symbol] of [['0x4200000000000000000000000000000000000006', 18, 'WETH'], ['0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 6, 'USDC']]) {
    await provider.send('anvil_setCode', [token, returnContract({
      fallback: ethers.AbiCoder.defaultAbiCoder().encode(['uint8'], [units]),
      routes: { [ethers.id('symbol()').slice(0, 10)]: ethers.AbiCoder.defaultAbiCoder().encode(['string'], [symbol]) },
    })]);
  }
  seen = umbrae.seen;
}, 30000);

afterAll(async () => {
  connections?.restore();
  await umbrae?.close();
  provider?.destroy();
  await anvil?.stop();
  setWorkspacesRoot(originalRoot);
  await fs.rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  umbrae.reset();
  clearMarketCache();
  connections?.restore();
  connections = connectionsOn(['umbrae-liquidity', 'market-data']);
  await installLpManager(provider, UMBRAE_BASE.positionManager);
  await installLpPool(provider, POOL);
});

const run = (action, opts = {}) => runLpAction(NEUMA_ID, action, { provider, receiptProvider: provider, receiptConfirmations: 1, pollMs: 50, ...opts });
const sends = () => seen.filter((r) => r.url === '/api/v1/base/send');
const minedFrom = async (hashes) => Promise.all(hashes.map(async (h) => (await provider.getTransactionReceipt(h))?.from));
const audit = () => fs.readFile(path.join(workspace._path(NEUMA_ID), 'audit', 'audit.jsonl'), 'utf8');

describe('getting money out never waits', () => {
  test('a claim signs in once, approves the pool, and is mined from the LP wallet', async () => {
    const out = await run({ type: 'claim', pool: POOL, tokenId: '42' });
    expect(out).toMatchObject({ ok: true, type: 'claim', tokenId: '42', approvals: 1 });
    expect(await minedFrom(out.txHashes)).toEqual([wallet]);
    expect(await readUmbraeKey(NEUMA_ID)).toBe('umbr_testkey_0');
    // The earnings book's independent pool/market price reads aside.
    expect(seen.map((r) => r.url).filter((u) => u !== '/api/v1/base/pools' && !u.startsWith('/api/v2/simple/') && !u.startsWith('/token-pairs/'))).toEqual([
      `/api/v1/base/pools/${POOL}`, '/api/auth/challenge', '/api/auth/wallet-auth', '/api/account/api-keys',
      '/api/v1/base/build', '/api/v1/base/approvals', '/api/v1/base/send', '/api/v1/base/status',
      '/api/v1/base/send', '/api/v1/base/status', '/api/v1/base/sync', '/api/v1/base/send', '/api/v1/base/status',
    ]);
    expect(await audit()).toContain('"type":"claim"');
  }, 60000);

  test('a wide close runs every round Umbrae asks for, with the saved key and no new sign-in', async () => {
    const out = await run({ type: 'close', pool: POOL, tokenId: '42' });
    expect(out.ok, out.reason).toBe(true);
    expect(out.txHashes).toHaveLength(3);
    expect(await minedFrom(out.txHashes)).toEqual([wallet, wallet, wallet]);
    expect(seen.some((r) => r.url.startsWith('/api/auth'))).toBe(false);
  }, 60000);

  test('a lapsed key is replaced by signing in again, once', async () => {
    umbrae.state.mode = 'lapsed-key';
    const before = await readUmbraeKey(NEUMA_ID);
    expect(before).toBe('umbr_testkey_0');
    await workspace._writeJSON(path.join(workspace._path(NEUMA_ID), 'keys', 'lp-umbrae-key.json'), { key: 'umbr_testkey_1', wallet, savedAt: new Date().toISOString() });
    const out = await run({ type: 'claim', pool: POOL, tokenId: '42' });
    expect(out.ok, out.reason).toBe(true);
    expect(seen.filter((r) => r.url === '/api/auth/wallet-auth')).toHaveLength(1);
    expect(await readUmbraeKey(NEUMA_ID)).not.toBe('umbr_testkey_1');
  }, 60000);
});

describe('a deposit runs on its own unless a budget cap holds it', () => {
  const open = { type: 'open', pool: POOL, amountY: '5' };

  test('with no cap set, the deposit runs on its own (Design note, 2026-11-13, "total control")', async () => {
    const out = await run(open);
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(out).toMatchObject({ ok: true, type: 'open', tokenId: '77' });
    expect(await minedFrom(out.txHashes)).toEqual([wallet]);
    expect(sends()).toHaveLength(3); // approval, deposit, zero-allowance cleanup
  }, 60000);

  test('the pool fee tier comes from Base, not a false API answer', async () => {
    await installLpPool(provider, POOL, 30);
    umbrae.state.mode = 'wrong-fee-tier';
    const out = await run(open);
    expect(out.ok, JSON.stringify(out)).toBe(true);
    const built = seen.find((r) => r.url === '/api/v1/base/build');
    expect(built.body.baseFactor).toBe(30);
    const manager = new ethers.Interface(['function createPositionWithStrategy(address tokenX, address tokenY, uint16 binStep, uint16 baseFactor, uint256 amountX, uint256 amountY, uint8 strategy, uint24 binRange, uint8 bidAskRatio, uint24 centerBinId, bool skipActiveBin, uint24 activeIdDesired, uint24 idSlippage, uint256 minTotalLiquidity, address recipient, uint256 deadline)']);
    const signed = ethers.Transaction.from(sends()[1].body.signedTransaction);
    expect(manager.parseTransaction({ data: signed.data }).args.baseFactor).toBe(30n);
  }, 60000);

  test('token decimals come from Base, not a false API answer', async () => {
    umbrae.state.mode = 'wrong-decimals';
    const out = await run(open);
    expect(out.ok, JSON.stringify(out)).toBe(true);
    const built = seen.find((r) => r.url === '/api/v1/base/build');
    expect(built.body.tokenYDecimals).toBe(6);
    const manager = new ethers.Interface(['function createPositionWithStrategy(address tokenX, address tokenY, uint16 binStep, uint16 baseFactor, uint256 amountX, uint256 amountY, uint8 strategy, uint24 binRange, uint8 bidAskRatio, uint24 centerBinId, bool skipActiveBin, uint24 activeIdDesired, uint24 idSlippage, uint256 minTotalLiquidity, address recipient, uint256 deadline)']);
    const signed = ethers.Transaction.from(sends()[1].body.signedTransaction);
    expect(manager.parseTransaction({ data: signed.data }).args.amountY).toBe(5_000_000n);
  }, 60000);

  test('a pool whose on-chain tokens differ from the API answer is not signed', async () => {
    await installLpPool(provider, POOL, 5000, NEW_TOKEN);
    const out = await run(open);
    expect(out).toMatchObject({ ok: false });
    expect(out.reason).toContain('Base shows different tokens');
    expect(sends()).toEqual([]);
  });

  test('an open-market pool is refused before any approval or signature', async () => {
    umbrae.state.mode = 'open-market';
    const out = await run(open);
    expect(out).toMatchObject({ ok: false });
    expect(out.reason).toContain('Only Umbrae-verified pools');
    expect(sends()).toEqual([]);
    expect(seen.some((r) => r.url.startsWith('/api/auth/'))).toBe(false);
  });

  test('with a $0 cap, nothing is signed and the deposit waits for the operator', async () => {
    await writeLpBudget(NEUMA_ID, 0);
    const out = await run(open);
    expect(out).toMatchObject({ ok: false, pending: true });
    expect(out.reason).toMatch(/past the \$0 budget/);
    expect(sends()).toEqual([]);
    const waiting = (await listPendingDeposits(NEUMA_ID)).find((r) => r.id === out.requestId);
    expect(waiting.action).toMatchObject({ tokenXSymbol: 'WETH', tokenYSymbol: 'USDC' });
    expect((await answerWaitingDeposit(NEUMA_ID, out.requestId, 'declined', { provider, receiptProvider: provider, receiptConfirmations: 1, pollMs: 50 })).declined).toBe(true);
    expect((await answerWaitingDeposit(NEUMA_ID, out.requestId, 'approved', { provider, receiptProvider: provider, receiptConfirmations: 1, pollMs: 50 })).reason).toMatch(/no longer waiting/);
    expect(sends()).toEqual([]);
  }, 60000);

  test('inside the budget, the token approval and the deposit are mined and the position is recorded', async () => {
    await writeLpBudget(NEUMA_ID, 10);
    const out = await run(open);
    expect(out).toMatchObject({ ok: true, type: 'open', tokenId: '77', approvals: 1 });
    expect(await minedFrom(out.txHashes)).toEqual([wallet]);
    expect(sends()).toHaveLength(3);
  }, 60000);

  test('past the budget it waits, and the operator\'s yes runs it once', async () => {
    await writeLpBudget(NEUMA_ID, 9);
    umbrae.state.positions = [{ positions: { userPositions: [{ publicKey: '42', positionData: { totalXAmount: '0', totalYAmount: '6' } }] }, poolInfo: { mint_x: '0x4200000000000000000000000000000000000006', mint_y: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', tokenXPriceUsd: 3200, tokenYPriceUsd: 1 } }];
    await installLpManager(provider, UMBRAE_BASE.positionManager, 1n, { pair: POOL, owner: wallet });
    const out = await run(open);
    expect(out).toMatchObject({ ok: false, pending: true });
    expect(out.reason).toMatch(/\$5\.0 would take the total past the \$9 budget/);
    expect(sends()).toEqual([]);
    const yes = await answerWaitingDeposit(NEUMA_ID, out.requestId, 'approved', { provider, receiptProvider: provider, receiptConfirmations: 1, pollMs: 50 });
    expect(yes).toMatchObject({ ok: true, type: 'open', tokenId: '77' });
    expect(await minedFrom(yes.txHashes)).toEqual([wallet]);
    expect((await answerWaitingDeposit(NEUMA_ID, out.requestId, 'approved', { provider, receiptProvider: provider, receiptConfirmations: 1, pollMs: 50 })).ok).toBe(false);
  }, 60000);
});

describe('the cap cannot be read away, and the positions it counts are Base\'s (P6-13)', () => {
  const open = { type: 'open', pool: POOL, amountY: '5' };
  const budgetFile = () => path.join(workspace._path(NEUMA_ID), 'config', 'lp-budget.json');
  const listed = (...ids) => [{ positions: { userPositions: ids.map((publicKey) => ({ publicKey })) }, poolInfo: { mint_x: '0x4200000000000000000000000000000000000006', mint_y: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' } }];
  const heldUnsized = async () => {
    const out = await run(open);
    expect(out.reason).toMatch(/could not be independently sized/);
    expect(out.ok).toBe(false);
    expect(sends()).toEqual([]);
  };

  test('a budget file that is plain text or torn reads as $0: the deposit waits, nothing is signed', async () => {
    for (const forged of [JSON.stringify({ budgetUsd: 1_000_000 }), '{"budgetUsd": 1e']) {
      await fs.writeFile(budgetFile(), forged);
      const out = await run(open);
      expect(out).toMatchObject({ ok: false, pending: true });
      expect(out.reason).toMatch(/past the \$0 budget/);
    }
    expect(sends()).toEqual([]);
    await writeLpBudget(NEUMA_ID, 100);
  }, 60000);

  test('one position listed twice to stand for two the wallet holds: the total is not trusted and the deposit waits', async () => {
    await writeLpBudget(NEUMA_ID, 100);
    umbrae.state.positions = listed('42', '42');
    await installLpManager(provider, UMBRAE_BASE.positionManager, 2n, { pair: POOL, owner: wallet });
    await heldUnsized();
  }, 60000);

  test('a listed position Base says another wallet owns: the total is not trusted and the deposit waits', async () => {
    await writeLpBudget(NEUMA_ID, 100);
    umbrae.state.positions = listed('42');
    await installLpManager(provider, UMBRAE_BASE.positionManager, 1n, { pair: POOL, owner: '0x2222222222222222222222222222222222222222' });
    await heldUnsized();
  }, 60000);

  test('the wallet\'s own positions, each once: counted from Base and the deposit runs inside the cap', async () => {
    await writeLpBudget(NEUMA_ID, 100);
    umbrae.state.positions = listed('42');
    await installLpManager(provider, UMBRAE_BASE.positionManager, 1n, { pair: POOL, owner: wallet });
    expect(await run(open)).toMatchObject({ ok: true, type: 'open' });
    await writeLpBudget(NEUMA_ID, 9);
  }, 60000);
});

describe('what Umbrae builds is checked before it is signed', () => {
  test('a claim that would pay another wallet is not signed or sent', async () => {
    umbrae.state.mode = 'pays-thief';
    const out = await run({ type: 'claim', pool: POOL, tokenId: '42' });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/different wallet/);
    expect(seen.filter((r) => r.url === '/api/v1/base/build')).toHaveLength(1);
    expect(sends()).toEqual([]);
    expect(seen.some((r) => r.url === '/api/v1/base/approvals')).toBe(false);
  }, 60000);

  test('a deposit larger than the one sized against the budget is not signed', async () => {
    await writeLpBudget(NEUMA_ID, 1000);
    umbrae.state.mode = 'bigger-deposit';
    const out = await run({ type: 'open', pool: POOL, amountY: '5' });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/larger than the one that was asked/);
    expect(sends()).toEqual([]);
    expect(seen.some((r) => r.url === '/api/v1/base/approvals')).toBe(false);
  }, 60000);

  test('a response for another pool is refused before anything is signed', async () => {
    umbrae.state.mode = 'other-pool';
    const out = await run({ type: 'open', pool: POOL, amountY: '5' });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/different pool/);
    expect(sends()).toEqual([]);
  });

  test('a claim cannot be substituted by a close', async () => {
    umbrae.state.mode = 'close-on-claim';
    const out = await run({ type: 'claim', pool: POOL, tokenId: '42' });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/exit action/);
    expect(sends()).toEqual([]);
    expect(seen.some((r) => r.url === '/api/v1/base/approvals')).toBe(false);
  });

  test('an understated builder price cannot bypass the independent budget', async () => {
    await writeLpBudget(NEUMA_ID, 100);
    umbrae.state.mode = 'understated-price';
    const out = await run({ type: 'open', pool: POOL, amountY: '200' });
    expect(out).toMatchObject({ ok: false, pending: true });
    expect(out.reason).toMatch(/\$200|past the \$100 budget/);
    expect(sends()).toEqual([]);
  });

  test('one manipulated independent price source cannot bypass the budget', async () => {
    await writeLpBudget(NEUMA_ID, 100);
    umbrae.state.dexPriceUsd = 0.001;
    const out = await run({ type: 'open', pool: POOL, amountY: '200' });
    expect(out.ok).toBe(false);
    expect(out.pending).not.toBe(true);
    expect(out.reason).toMatch(/independently sized/);
    expect(sends()).toEqual([]);
  }, 60000);

  test('a confirmed-looking but reverted transaction is not recorded as success', async () => {
    umbrae.state.mode = 'revert-confirm';
    const out = await run({ type: 'claim', pool: POOL, tokenId: '42' });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/reverted/);
    expect(out.txHash).toBeTruthy();
    expect(Number((await provider.getTransactionReceipt(out.txHash)).status)).toBe(0);
  });

  test('an action that is not one, or a malformed one, is refused before Umbrae is called', async () => {
    for (const action of [{ type: 'transfer', pool: POOL }, { type: 'claim', pool: 'nope', tokenId: '1' }, { type: 'claim', pool: POOL }, { type: 'withdraw', pool: POOL, tokenId: '1', percent: 101 }, { type: 'open', pool: POOL, amountY: '-5' }, { type: 'open', pool: POOL, amountY: '0' }, { type: 'open', pool: POOL, amountY: '1.1234567' }]) {
      expect((await run(action)).ok).toBe(false);
    }
    // public reads only (the pool, and the pool list the earnings book prices by): no sign-in, nothing signed
    expect(seen.filter((r) => r.url !== `/api/v1/base/pools/${POOL}` && r.url !== '/api/v1/base/pools' && !r.url.startsWith('/api/v2/simple/') && !r.url.startsWith('/token-pairs/'))).toEqual([]);
  }, 60000);

  test('with the connection off, Umbrae hears nothing', async () => {
    connections.restore();
    connections = connectionsOn([]);
    const out = await run({ type: 'claim', pool: POOL, tokenId: '42' });
    expect(out.ok).toBe(false);
    expect(seen).toEqual([]);
  });

  test('a house member with no LP wallet is told so', async () => {
    await workspace.create('lprunnone');
    expect(await lpWalletAddress('lprunnone')).toBeNull();
    expect((await runLpAction('lprunnone', { type: 'claim', pool: POOL, tokenId: '1' })).reason).toMatch(/no LP wallet/);
  });
});
