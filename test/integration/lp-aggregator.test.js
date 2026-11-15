/**
 * A house member's swap through KyberSwap's aggregator (backend/services/umbrae-lp/
 * lp-aggregator.js, lp-trade.js; Design note, 2026-11-13: […]) over REAL parts (RULE 0): a real claimed workspace,
 * a real chain node (anvil as chain 8453) that mines every signed call, real HTTP
 * listeners in Umbrae's and KyberSwap's places (KyberSwap's answers built with its
 * router's own ABI), the real signing rule. […] is counted by the
 * wallet's nonce.
 *
 * NOT proven here: KyberSwap's router executing a route (plain anvil has no code at
 * its address, and no Umbrae router either, so Umbrae has no route here). That is
 * the fork live test (umbrae-lp-fork-live.test.js, -t aggregator).
 */
import fs from 'node:fs/promises';
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import { claimOwner } from '../helpers/claim-owner.js';
import { startAnvil } from '../helpers/money-in-kit.js';
import { connectionsOn } from '../helpers/connections-kit.js';
import { startUmbraeStandIn, USDC, WETH } from '../helpers/umbrae-stand-in.js';
import { startKyberStandIn } from '../helpers/kyber-stand-in.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { KYBER_ROUTER, KYBER_ABI } from '../../core/wallet/aggregator-policy.js';
import { openLpWallet } from '../../backend/services/umbrae-lp/lp-wallet.js';
import { runSwap } from '../../backend/services/umbrae-lp/lp-trade.js';
import { aggregatorQuote } from '../../backend/services/umbrae-lp/lp-aggregator.js';
import { marketQuote } from '../../backend/services/umbrae-lp/lp-market.js';
import { readBook } from '../../backend/services/umbrae-lp/lp-book.js';

const KYBER = new ethers.Interface(KYBER_ABI);
let anvil, provider, root, originalRoot, umbrae, kyber, connections, lp;
const priorRpc = process.env.BASE_MAINNET_RPC_URL;
const nonce = async (address) => Number(await provider.send('eth_getTransactionCount', [address, 'latest']));
const swapUsdc = () => runSwap('tenekom', { tokenIn: 'USDC', tokenOut: 'WETH', amount: '0.000005', why: 'enter at the deeper price' }, { provider });

beforeAll(async () => {
  anvil = await startAnvil({ chainId: 8453 });
  provider = new ethers.JsonRpcProvider(anvil.url, ethers.Network.from(8453), { staticNetwork: true, pollingInterval: 100 });
  process.env.BASE_MAINNET_RPC_URL = anvil.url;
  root = await createTempDir('lp-aggregator');
  originalRoot = getWorkspacesRoot();
  setWorkspacesRoot(root);
  await workspace.create('tenekom');
  await claimOwner(root, 'tenekom', ethers.Wallet.createRandom().address);
  await workspace.writeEncryptedKeypair('tenekom', { address: ethers.Wallet.createRandom().address });
  lp = (await openLpWallet('tenekom')).address;
  await provider.send('anvil_setBalance', [lp, ethers.toQuantity(ethers.parseEther('1'))]);
  // Token contracts that answer every call with 6: decimals 6, balance and allowance 0.000006.
  await provider.send('anvil_setCode', [USDC, '0x600660005260206000f3']);
  await provider.send('anvil_setCode', [WETH, '0x600660005260206000f3']);
  umbrae = await startUmbraeStandIn({ provider });
  kyber = await startKyberStandIn({ amountOut: 1000n });
}, 30000);

afterAll(async () => {
  connections?.restore();
  await kyber?.close();
  await umbrae?.close();
  provider?.destroy();
  await anvil?.stop();
  if (priorRpc === undefined) delete process.env.BASE_MAINNET_RPC_URL; else process.env.BASE_MAINNET_RPC_URL = priorRpc;
  setWorkspacesRoot(originalRoot);
  await fs.rm(root, { recursive: true, force: true });
});

beforeEach(() => {
  umbrae.reset();
  kyber.reset();
  connections?.restore();
  connections = connectionsOn(['umbrae-liquidity', 'swap-aggregator']);
});

describe('the aggregator road', () => {
  test('KyberSwap pays more (Umbrae has no route on this node): its router\'s swap is signed, mined from the LP wallet, paying the wallet, above the run\'s floor', async () => {
    const out = await swapUsdc();
    expect(out).toMatchObject({ ok: true, via: 'kyberswap', exchanges: ['uniswap-v3', 'aerodrome'], compared: { umbrae: null, kyberswap: '0.001' } });
    const tx = await provider.getTransaction(out.txHashes.at(-1));
    expect(tx.from).toBe(lp);
    expect(tx.to).toBe(KYBER_ROUTER);
    const { desc } = KYBER.parseTransaction({ data: tx.data }).args[0];
    expect(desc.dstReceiver).toBe(lp);
    expect(desc.amount).toBe(5n);
    // the run's floor is 1% under the quote (990); KyberSwap built at half that slippage (995)
    expect(desc.minReturnAmount).toBe(995n);
    expect(kyber.seen.find((r) => r.url === '/base/api/v1/route/build').body).toMatchObject({ sender: lp, recipient: lp, slippageTolerance: 50 });
    const line = (await readBook('tenekom')).journal.at(-1);
    expect(line).toMatchObject({ act: 'swap', why: 'enter at the deeper price' });
    expect(line.what).toMatch(/via KyberSwap \(uniswap-v3, aerodrome\); Umbrae's router quoted no route/);
  }, 60000);

  test('a KyberSwap that pays someone else, takes a fee, names another router or lowers the floor: refused, nothing signed', async () => {
    for (const [mode, said] of [['pays-thief', /pay a different wallet/], ['fee', /pays a fee/], ['other-router', /router other than its own/], ['low-floor', /minimum out is lower than the floor/]]) {
      kyber.state.mode = mode;
      const before = await nonce(lp);
      const out = await swapUsdc();
      expect(out.ok).toBe(false);
      expect(out.reason).toMatch(said);
      expect(await nonce(lp)).toBe(before);
    }
  }, 60000);

  test('KyberSwap down and no Umbrae route: refused with both reasons, nothing signed', async () => {
    kyber.state.mode = 'down';
    const before = await nonce(lp);
    expect((await swapUsdc()).reason).toMatch(/No Umbrae pool route can take this swap whole right now, and KyberSwap answered: route not found/);
    expect(await nonce(lp)).toBe(before);
  }, 60000);

  test('the aggregator switched off: KyberSwap is never asked', async () => {
    connections.restore();
    connections = connectionsOn(['umbrae-liquidity']);
    expect((await swapUsdc()).reason).toMatch(/the swap aggregator is turned off/);
    expect(kyber.seen).toEqual([]);
  }, 60000);

  test('pinned: a host that is not KyberSwap\'s is never called', async () => {
    const prior = process.env.NEUMA_KYBER_ORIGIN;
    process.env.NEUMA_KYBER_ORIGIN = 'https://evil.example';
    try {
      expect(await aggregatorQuote({ tokenIn: USDC, tokenOut: WETH, amountIn: 5n })).toEqual({ ok: false, error: 'refusing to call a host that is not KyberSwap' });
    } finally {
      process.env.NEUMA_KYBER_ORIGIN = prior;
    }
  });

  test('a quote shows both roads, the better marked', async () => {
    const text = await marketQuote({ tokenIn: 'USDC', tokenOut: 'WETH', amount: '0.000005' });
    expect(text).toMatch(/^QUOTE 0\.000005 USDC → WETH, two roads:/);
    expect(text).toContain("Umbrae's router: no route takes this amount whole");
    expect(text).toContain('KyberSwap: 0.001 WETH via uniswap-v3, aerodrome');
    expect(text).toContain('lp/swap takes the road that pays more.');
  }, 60000);
});
