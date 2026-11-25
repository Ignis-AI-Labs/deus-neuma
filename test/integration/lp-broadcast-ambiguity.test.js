import fs from 'node:fs/promises';
import http from 'node:http';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import { claimOwner } from '../helpers/claim-owner.js';
import { startAnvil } from '../helpers/money-in-kit.js';
import { connectionsOn } from '../helpers/connections-kit.js';
import { startUmbraeStandIn } from '../helpers/umbrae-stand-in.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { openLpWallet } from '../../backend/services/umbrae-lp/lp-wallet.js';
import { runSend } from '../../backend/services/umbrae-lp/lp-trade.js';

let anvil;
let chain;
let proxy;
let provider;
let root;
let originalRoot;
let umbrae;
let connections;
let broadcasts;
let holdReceipts;

beforeAll(async () => {
  anvil = await startAnvil({ chainId: 8453 });
  chain = new ethers.JsonRpcProvider(anvil.url, ethers.Network.from(8453), { staticNetwork: true });
  broadcasts = 0;
  holdReceipts = true;
  proxy = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const message = JSON.parse(raw);

    if (message.method === 'eth_sendRawTransaction') broadcasts += 1;
    const upstream = await fetch(anvil.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw });
    const payload = await upstream.json();
    if (message.method === 'eth_sendRawTransaction' && broadcasts === 1) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'response lost after acceptance' } }));
      return;
    }
    if (message.method === 'eth_getTransactionReceipt' && holdReceipts) payload.result = null;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  provider = new ethers.JsonRpcProvider(`http://127.0.0.1:${proxy.address().port}`, ethers.Network.from(8453), { staticNetwork: true, pollingInterval: 50, batchMaxCount: 1 });

  root = await createTempDir('lp-broadcast-ambiguity');
  originalRoot = getWorkspacesRoot();
  setWorkspacesRoot(root);
  const owner = ethers.Wallet.createRandom().address;
  for (const lane of ['sender', 'receiver']) {
    await workspace.create(lane);
    await claimOwner(root, lane, owner);
    await workspace.writeEncryptedKeypair(lane, { address: ethers.Wallet.createRandom().address });
  }
  const lp = (await openLpWallet('sender')).address;
  await chain.send('anvil_setBalance', [lp, ethers.toQuantity(ethers.parseEther('1'))]);
  umbrae = await startUmbraeStandIn({ provider: chain });
  connections = connectionsOn(['umbrae-liquidity', 'market-data']);
}, 30000);

afterAll(async () => {
  connections?.restore();
  await umbrae?.close();
  provider?.destroy();
  chain?.destroy();
  if (proxy) {
    proxy.closeAllConnections();
    await new Promise((resolve) => proxy.close(resolve));
  }
  await anvil?.stop();
  setWorkspacesRoot(originalRoot);
  if (root) await fs.rm(root, { recursive: true, force: true });
});

test('an accepted but unresolved transaction cannot be duplicated; reconciliation unlocks a deliberate new act', async () => {
  const first = await runSend('sender', { to: 'receiver', amount: '0.01' }, { provider, receiptProvider: chain, receiptConfirmations: 1, receiptTimeoutMs: 100 });
  expect(first, JSON.stringify(first)).toMatchObject({ ok: false, uncertain: true });
  expect(first.txHash).toBeTruthy();
  expect(broadcasts, JSON.stringify(first)).toBe(1);

  const retry = await runSend('sender', { to: 'receiver', amount: '0.01' }, { provider, receiptProvider: chain, receiptConfirmations: 1, receiptTimeoutMs: 100 });
  expect(retry).toMatchObject({ ok: false, uncertain: true });
  expect(broadcasts).toBe(1);

  holdReceipts = false;
  const afterReceipt = await runSend('sender', { to: 'receiver', amount: '0.01' }, { provider, receiptProvider: chain, receiptConfirmations: 1, receiptTimeoutMs: 100 });
  expect(afterReceipt.ok).toBe(true);
  expect(broadcasts).toBe(2);
  expect(Number((await chain.getTransactionReceipt(first.txHash)).status)).toBe(1);
}, 10000);
