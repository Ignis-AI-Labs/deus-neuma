import fs from 'node:fs/promises';
import http from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { ethers } from 'ethers';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { createTempDir } from '../helpers/temp-fs.js';
import { claimOwner } from '../helpers/claim-owner.js';
import { startAnvil } from '../helpers/money-in-kit.js';
import { returnContract } from '../helpers/evm-return-contract.js';
import { installLpManager, installLpPool } from '../helpers/lp-chain-kit.js';
import { connectionsOn } from '../helpers/connections-kit.js';
import { POOL, POOL_B, THIEF, startUmbraeStandIn } from '../helpers/umbrae-stand-in.js';
import { UMBRAE_BASE } from '../../core/wallet/lp-tx-policy.js';
import { openLpWallet } from '../../backend/services/umbrae-lp/lp-wallet.js';
import { runLpAction } from '../../backend/services/umbrae-lp/lp-run.js';

let anvil;
let provider;
let root;
let originalRoot;
let umbrae;
let connections;
let wallet;

const nonce = async () => Number(await provider.send('eth_getTransactionCount', [wallet, 'latest']));
const run = (action, rpc = provider) => runLpAction('position-owner', action, { provider: rpc, receiptProvider: rpc, receiptConfirmations: 1, pollMs: 50 });
const add = (rpc) => run({ type: 'add', pool: POOL, tokenId: '42', amountY: '5' }, rpc);
const sends = () => umbrae.seen.filter((r) => r.url === '/api/v1/base/send');

beforeAll(async () => {
  anvil = await startAnvil({ chainId: 8453 });
  provider = new ethers.JsonRpcProvider(anvil.url, ethers.Network.from(8453), { staticNetwork: true, pollingInterval: 100 });
  root = await createTempDir('lp-position-guard');
  originalRoot = getWorkspacesRoot();
  setWorkspacesRoot(root);
  await workspace.create('position-owner');
  await claimOwner(root, 'position-owner', ethers.Wallet.createRandom().address);
  wallet = (await openLpWallet('position-owner')).address;
  await provider.send('anvil_setBalance', [wallet, ethers.toQuantity(ethers.parseEther('1'))]);
  umbrae = await startUmbraeStandIn({ provider });
  for (const [token, units] of [['0x4200000000000000000000000000000000000006', 18], ['0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 6]]) {
    await provider.send('anvil_setCode', [token, returnContract({ fallback: ethers.AbiCoder.defaultAbiCoder().encode(['uint8'], [units]) })]);
  }
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
  connections?.restore();
  connections = connectionsOn(['umbrae-liquidity', 'market-data']);
  await installLpPool(provider, POOL);
  await installLpManager(provider, UMBRAE_BASE.positionManager, 0n, { pair: POOL, owner: wallet });
});

describe('P6-12/P6-30 position ownership and pair', () => {
  test('a matching owned position tops up and its exact token approval is revoked', async () => {
    const out = await add();
    expect(out, out.reason).toMatchObject({ ok: true, type: 'add', tokenId: '42', approvals: 1 });
    expect(out.approvalCleanup).toMatchObject({ warnings: [] });
    expect(out.approvalCleanup.txHashes).toHaveLength(1);
    const cleanup = ethers.Transaction.from(sends().at(-1).body.signedTransaction);
    const erc20 = new ethers.Interface(['function approve(address spender,uint256 amount)']);
    expect(erc20.decodeFunctionData('approve', cleanup.data).toArray()).toEqual([UMBRAE_BASE.positionManager, 0n]);
    expect((await provider.getTransactionReceipt(out.txHashes[0])).from).toBe(wallet);
  }, 60000);

  test('a token ID for another pool is refused before build, approval, or signature', async () => {
    const selector = ethers.id('getPosition(uint256)').slice(0, 10);
    const server = http.createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const message = JSON.parse(raw);
      if (message.method === 'eth_call' && message.params[0].data.startsWith(selector)) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: ethers.AbiCoder.defaultAbiCoder().encode(['address'], [POOL_B]) }));
        return;
      }
      const upstream = await globalThis.fetch(anvil.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(await upstream.text());
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const hostile = new ethers.JsonRpcProvider(`http://127.0.0.1:${server.address().port}`, ethers.Network.from(8453), { staticNetwork: true, pollingInterval: 100, batchMaxCount: 1 });
    try {
      const before = await nonce();
      const out = await add(hostile);
      expect(out.reason).toMatch(/not your position in the named pool/);
      expect(umbrae.seen.some((r) => ['/api/v1/base/build', '/api/v1/base/approvals', '/api/v1/base/send'].includes(r.url))).toBe(false);
      expect(await nonce()).toBe(before);
    } finally {
      hostile.destroy();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('a token ID for another owner is refused before build, approval, or signature', async () => {
    await installLpManager(provider, UMBRAE_BASE.positionManager, 0n, { pair: POOL, owner: THIEF });
    const before = await nonce();
    const out = await add();
    expect(out.reason).toMatch(/not your position in the named pool/);
    expect(umbrae.seen.some((r) => ['/api/v1/base/build', '/api/v1/base/approvals', '/api/v1/base/send'].includes(r.url))).toBe(false);
    expect(await nonce()).toBe(before);
  });
});

describe('P6-24/P6-30 main-call validation and approval cleanup', () => {
  test('a main build paying someone else is refused before any approval request', async () => {
    umbrae.state.mode = 'pays-thief';
    const before = await nonce();
    const out = await run({ type: 'open', pool: POOL, amountY: '5' });
    expect(out.reason).toMatch(/before any approval was signed/);
    expect(umbrae.seen.some((r) => r.url === '/api/v1/base/build')).toBe(true);
    expect(umbrae.seen.some((r) => ['/api/v1/base/approvals', '/api/v1/base/send'].includes(r.url))).toBe(false);
    expect(await nonce()).toBe(before);
  });

  test('a successful claim revokes the pool operator permission with false', async () => {
    const out = await run({ type: 'claim', pool: POOL, tokenId: '42' });
    expect(out, out.reason).toMatchObject({ ok: true, approvals: 1 });
    expect(out.approvalCleanup.txHashes).toHaveLength(1);
    const cleanup = ethers.Transaction.from(sends().at(-1).body.signedTransaction);
    const pool = new ethers.Interface(['function setApprovalForAll(address spender,bool approved)']);
    expect(pool.decodeFunctionData('setApprovalForAll', cleanup.data).toArray()).toEqual([UMBRAE_BASE.positionManager, false]);
  }, 60000);
});
