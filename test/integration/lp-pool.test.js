/**
 * A house member opens a NEW pool on Umbrae (backend/services/umbrae-lp/lp-pool.js,
 * intent lp/create-pool) over REAL parts (RULE 0): a real claimed workspace, a real
 * chain node (anvil as chain 8453) that mines every signed call, a real HTTP
 * listener in Umbrae's place answering its create-pool flow in the shapes of
 * Umbrae's own source (pool-plan.server.ts, pool-routes.ts), the real signing rule,
 * and the real intent sweep. At the factory's pinned address sits a tiny contract
 * that answers every call with one address (the "new pool"), so getPair reads back.
 * "Nothing was signed" is counted by the wallet's nonce.
 *
 * NOT proven here: Umbrae's real factory creating a pair. That is the fork live
 * test (umbrae-lp-fork-live.test.js, -t "new pool").
 */
import process from 'node:process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import { claimOwner } from '../helpers/claim-owner.js';
import { startAnvil } from '../helpers/money-in-kit.js';
import { returnContract } from '../helpers/evm-return-contract.js';
import { connectionsOn } from '../helpers/connections-kit.js';
import { viaIntent, sweep, intentDir, granting } from '../helpers/intent-path.js';
import { startUmbraeStandIn, USDC, WETH, NEW_TOKEN } from '../helpers/umbrae-stand-in.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { UMBRAE_FACTORY, binIdFor } from '../../core/wallet/pool-policy.js';
import { openLpWallet } from '../../backend/services/umbrae-lp/lp-wallet.js';
import { runCreatePool } from '../../backend/services/umbrae-lp/lp-pool.js';
import { readBook } from '../../backend/services/umbrae-lp/lp-book.js';

const NEW_POOL = '0x4444444444444444444444444444444444444444';
const FACTORY = new ethers.Interface(['function createPair(address tokenX, address tokenY, uint24 activeId, uint16 binStep, uint16 baseFactor, uint256 amountX, uint256 amountY)']);
const ERC20 = new ethers.Interface(['function approve(address spender, uint256 amount)']);
let anvil, provider, root, originalRoot, umbrae, connections, lp;
const priorRpc = process.env.BASE_MAINNET_RPC_URL;
const nonce = async (address) => Number(await provider.send('eth_getTransactionCount', [address, 'latest']));
const ask = (extra = {}) => ({ baseToken: NEW_TOKEN, quoteToken: 'USDC', binStep: 25, baseFee: 30, seedQuote: '0.000005', ...extra });
const create = (extra) => runCreatePool('tenekom', ask(extra), { provider, receiptProvider: provider, receiptConfirmations: 1, pollMs: 50 });
// The factory's real tiers on Base (getAllFeeConfigs, read 2026-11-14).
const TIERS = [[1, 1, 4], [1, 2, 4], [5, 4, 15], [10, 8, 30], [15, 12, 40], [20, 20, 80], [25, 30, 150], [50, 50, 300], [100, 80, 500]];
/**
 * A factory in Umbrae's place, assembled here: getAllFeeConfigs answers TIERS;
 * createPair marks storage slot 0; every other call (getPair) answers the new
 * pool once a pair was created, the zero address before (every tier free).
 */
const factoryStub = (pool) => {
  const hex = (v, bytes) => v.toString(16).padStart(bytes * 2, '0');
  const sel = (sig) => ethers.id(sig).slice(2, 10);
  const blob = ethers.AbiCoder.defaultAbiCoder().encode(['uint16[]', 'uint16[]', 'uint16[]'], [TIERS.map((t) => t[0]), TIERS.map((t) => t[1]), TIERS.map((t) => t[2])]).slice(2);
  const len = blob.length / 2;
  const addr = pool.slice(2).toLowerCase();
  const code = [
    '60003560e01c', // selector
    `8063${sel('getAllFeeConfigs()')}14${'61'}${hex(61, 2)}57`, // → A
    `8063${sel('createPair(address,address,uint24,uint16,uint16,uint256,uint256)')}14${'61'}${hex(77, 2)}57`, // → B
    `60005473${addr}02600052602060 00f3`.replace(' ', ''), // SLOAD(0) * pool
    `5b61${hex(len, 2)}61${hex(112, 2)}60003961${hex(len, 2)}6000f3`, // A: the tiers
    `5b600160005573${addr}60005260206000f3`, // B: mark created, answer the pool
  ].join('');
  if (code.length / 2 !== 112) throw new Error(`factory stub layout is ${code.length / 2} bytes before its data, not 112`);
  return `0x${code}${blob}`;
};
const member = () => ({ companion: { neumaId: 'tenekom', name: 'Tenekom' }, sessionId: 's-1', toolMode: 'ask' });

beforeAll(async () => {
  anvil = await startAnvil({ chainId: 8453 });
  provider = new ethers.JsonRpcProvider(anvil.url, ethers.Network.from(8453), { staticNetwork: true, pollingInterval: 100 });
  process.env.BASE_MAINNET_RPC_URL = anvil.url;
  root = await createTempDir('lp-pool');
  originalRoot = getWorkspacesRoot();
  setWorkspacesRoot(root);
  await workspace.create('tenekom');
  await claimOwner(root, 'tenekom', ethers.Wallet.createRandom().address);
  await workspace.writeEncryptedKeypair('tenekom', { address: ethers.Wallet.createRandom().address });
  lp = (await openLpWallet('tenekom')).address;
  await provider.send('anvil_setBalance', [lp, ethers.toQuantity(ethers.parseEther('1'))]);
  // Each token answers its real decimals; every other call returns 6 (balance and truthy approval).
  for (const [token, units] of [[USDC, 6], [WETH, 18], [NEW_TOKEN, 18]]) {
    const code = returnContract({
      fallback: ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [6]),
      routes: { [ethers.id('decimals()').slice(0, 10)]: ethers.AbiCoder.defaultAbiCoder().encode(['uint8'], [units]) },
    });
    await provider.send('anvil_setCode', [token, code]);
  }
  await provider.send('anvil_setCode', [UMBRAE_FACTORY, factoryStub(NEW_POOL)]);
  umbrae = await startUmbraeStandIn({ provider });
}, 30000);

afterAll(async () => {
  connections?.restore();
  await umbrae?.close();
  provider?.destroy();
  await anvil?.stop();
  if (priorRpc === undefined) delete process.env.BASE_MAINNET_RPC_URL; else process.env.BASE_MAINNET_RPC_URL = priorRpc;
  setWorkspacesRoot(originalRoot);
  await fs.rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  // every tier free again: no pair created yet
  await provider.send('anvil_setStorageAt', [UMBRAE_FACTORY, ethers.toBeHex(0, 32), ethers.toBeHex(0, 32)]);
  umbrae.reset();
  connections?.restore();
  connections = connectionsOn(['umbrae-liquidity', 'market-data']);
});

describe('opening a new pool', () => {
  test('check: true shows Umbrae\'s plan and signs nothing', async () => {
    const before = await nonce(lp);
    const out = await create({ check: true });
    expect(out.ok).toBe(true);
    expect(out.plan).toMatch(/^PLAN for a NEW-USDC pool at bin step 25 · 30 bps:/);
    expect(out.plan).toContain('market: 2 USDC per NEW, established');
    expect(out.plan).toContain('nothing stops it');
    expect(umbrae.seen.map((r) => r.url)).not.toContain('/api/v1/base/build-pool');
    expect(await nonce(lp)).toBe(before);
  }, 60000);

  test('a token with an established market: the seed is approved to the factory, createPair is signed for exactly the planned pool, and the new pool is read back', async () => {
    const out = await create({ why: 'NEW trades on Base with depth and Umbrae has no pool for it' });
    expect(out).toMatchObject({ ok: true, pool: ethers.getAddress(NEW_POOL), name: 'NEW-USDC', binStep: 25, baseFee: 30, startPrice: 2 });
    expect(out.txHashes).toHaveLength(3);
    const [approve, created, revoked] = await Promise.all(out.txHashes.map((h) => provider.getTransaction(h)));
    expect(approve.to).toBe(USDC);
    expect(ERC20.decodeFunctionData('approve', approve.data).toArray()).toEqual([UMBRAE_FACTORY, 10n]); // twice the 5-unit seed
    expect(created.from).toBe(lp);
    expect(created.to).toBe(UMBRAE_FACTORY);
    expect(ERC20.decodeFunctionData('approve', revoked.data).toArray()).toEqual([UMBRAE_FACTORY, 0n]);
    // NEW (0x3333…) sorts below USDC: NEW is X, USDC is Y, the seed is USDC alone, and the pool opens at 2 USDC per NEW
    expect(FACTORY.decodeFunctionData('createPair', created.data).toArray()).toEqual([ethers.getAddress(NEW_TOKEN), USDC, BigInt(binIdFor(2, 25)), 25n, 30n, 0n, 5n]);
    const line = (await readBook('tenekom')).journal.at(-1);
    expect(line).toMatchObject({ act: 'create-pool', why: 'NEW trades on Base with depth and Umbrae has no pool for it' });
    expect(line.what).toMatch(/opened a NEW pool NEW-USDC \(0x4444444444444444444444444444444444444444\), bin step 25 · 30 bps, at 2; its seed of 0 NEW \+ 0\.000005 USDC stays in the pool for good/);
  }, 60000);

  test('a token with no established market, or a quote token Umbrae does not trade: refused, nothing signed', async () => {
    const before = await nonce(lp);
    umbrae.state.newTokenUnestablished = true;
    expect((await create()).reason).toMatch(/No established market prices NEW outside Umbrae/);
    umbrae.state.newTokenUnestablished = false;
    expect((await create({ quoteToken: NEW_TOKEN, baseToken: 'USDC' })).reason).toMatch(/quoteToken\) is a token Umbrae's pools trade/);
    expect((await create({ binStep: 2.5 })).reason).toMatch(/Name the fee tier/);
    expect(await nonce(lp)).toBe(before);
  }, 60000);

  test('dishonest API start prices and an uncapped seed are refused by local economics', async () => {
    const before = await nonce(lp);
    umbrae.state.mode = 'pool-api-offprice';
    expect((await create()).reason).toMatch(/more than 2% from the independent market price/);

    const originalCode = await provider.send('eth_getCode', [USDC, 'latest']);
    await provider.send('anvil_setCode', [USDC, returnContract({
      fallback: ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [ethers.parseUnits('1000', 6)]),
      routes: { [ethers.id('decimals()').slice(0, 10)]: ethers.AbiCoder.defaultAbiCoder().encode(['uint8'], [6]) },
    })]);
    try {
      umbrae.state.mode = 'pool-uncapped-seed';
      const out = await create({ seedQuote: '25' });
      expect(out.reason).toMatch(/over the \$20\.00 per-action capital limit/);
    } finally {
      await provider.send('anvil_setCode', [USDC, originalCode]);
    }
    expect(await nonce(lp)).toBe(before);
  }, 60000);

  test('the default seed is $10 of the quote token; more than the wallet holds is refused before anything is signed', async () => {
    const before = await nonce(lp);
    expect((await create({ seedQuote: undefined })).reason).toMatch(/The seed is 0 NEW \+ 10 USDC; the wallet holds 0\.000000000000000006 NEW and 0\.000006 USDC/);
    expect(await nonce(lp)).toBe(before);
  }, 60000);

  test('an Umbrae build at another price, with a bigger seed, for another pair, or an approval past twice the seed: refused by the signing rule, no pool signed', async () => {
    for (const [mode, said] of [
      ['pool-wrong-price', /open at another price than was planned/],
      ['pool-bigger-seed', /seed is larger than was planned/],
      ['pool-other-pair', /not the pair or fee tier that was planned/],
      ['pool-bigger-approval', /approval is larger than this action calls for/],
    ]) {
      umbrae.state.mode = mode;
      const out = await create();
      expect(out.ok).toBe(false);
      expect(out.reason).toMatch(said);
      for (const hash of out.txHashes ?? []) expect((await provider.getTransaction(hash)).to).not.toBe(UMBRAE_FACTORY);
    }
  }, 60000);

  test('a check with no tier lists every tier the factory allows, with its units, which this pair already has, and signs nothing', async () => {
    const before = await nonce(lp);
    const out = await runCreatePool('tenekom', { baseToken: NEW_TOKEN, quoteToken: 'USDC', check: true }, { provider });
    expect(out.ok).toBe(true);
    expect(out.plan).toMatch(/^FEE TIERS Umbrae's factory allows for 0x3333…3333-USDC \(binStep · baseFee; baseFee in basis points, 50 = 0\.5%\):/);
    expect(out.plan).toContain('50·50 = bin step 50, 0.5% fee (free)');
    expect(out.plan).toContain('25·30 = bin step 25, 0.3% fee (free)');
    expect(umbrae.seen.map((r) => r.url)).toEqual(['/api/v1/base/pools']); // no sign-in, no plan asked
    expect(await nonce(lp)).toBe(before);
  }, 60000);

  test('Tenekom\'s case (2026-11-14): a tier the factory does not allow is refused as INVALID with the tiers listed, and the fix to the SAME file runs', async () => {
    const [refused] = await viaIntent(member(), 'lp/create-pool', { ...ask(), binStep: 50, baseFee: 0, check: true });
    expect(refused.status).toBe('error');
    expect(refused.error).toMatch(/Name the fee tier as whole numbers, binStep and baseFee \(basis points: 50 = 0\.5%\)/);
    const [unknown] = await viaIntent(member(), 'lp/create-pool', { ...ask(), binStep: 50, baseFee: 30, check: true });
    expect(unknown.error).toMatch(/50·30 is not a tier Umbrae's factory allows\. It allows \(baseFee in basis points\): 1·1 = bin step 1, 0\.01% fee \(free\)/);
    // the member fixes the same file in place
    await fs.writeFile(path.join(intentDir(member()), 'act.json'), JSON.stringify({ type: 'lp/create-pool', ...ask(), binStep: 50, baseFee: 50, check: true }));
    const [fixed] = await sweep(member(), 'ask', granting('lp.create-pool'));
    expect(fixed.status).toBe('ok');
    expect(fixed.content).toMatch(/^PLAN for a NEW-USDC pool at bin step 50 · 50 bps:/);
  }, 60000);

  test('a tier the pair already has is refused with the free ones', async () => {
    expect((await create()).ok).toBe(true); // opens 25·30 (this factory stand-in then answers the pool for every tier)
    const again = await create({ check: true });
    expect(again.reason).toMatch(/^0x3333…3333-USDC already has a pool at 25·30: 0x4444444444444444444444444444444444444444\. Add to it with lp\/open; every other tier is taken too\.$/);
  }, 60000);

  test('opening a pool is the operator\'s yes each time, in ASK and in AUTO: a filing with no grant signs nothing (P6-15)', async () => {
    const before = await nonce(lp);
    for (const mode of ['ask', 'auto']) {
      const [held] = await viaIntent({ ...member(), toolMode: mode }, 'lp/create-pool', ask(), mode);
      expect(held.status).toBe('denied');
    }
    expect(umbrae.seen.map((r) => r.url)).not.toContain('/api/v1/base/build-pool');
    expect(await nonce(lp)).toBe(before);
  }, 60000);

  test('through the real intent sweep, with the connection on', async () => {
    const [receipt] = await viaIntent(member(), 'lp/create-pool', { ...ask(), check: true }, 'ask', granting('lp.create-pool'));
    expect(receipt.status).toBe('ok');
    expect(receipt.content).toMatch(/PLAN for a NEW-USDC pool/);
  }, 60000);
});
