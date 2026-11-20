import { beforeAll, afterAll, test, expect } from 'vitest';
import fetch from 'node-fetch';
import http from 'node:http';
import { setTimeout } from 'node:timers';
import { ethers } from 'ethers';
import { startAnvil } from '../helpers/money-in-kit.js';
import { proveLpReceipt } from '../../backend/services/umbrae-lp/lp-receipt-proof.js';

let anvil; let provider; let receipt;

beforeAll(async () => {
  anvil = await startAnvil({ chainId: 8453 });
  provider = new ethers.JsonRpcProvider(anvil.url, ethers.Network.from(8453), { staticNetwork: true, pollingInterval: 50 });
  const signer = ethers.HDNodeWallet.fromPhrase('test test test test test test test test test test test junk').connect(provider);
  await provider.send('anvil_setBalance', [signer.address, ethers.toQuantity(ethers.parseEther('1'))]);
  receipt = await (await signer.sendTransaction({ to: ethers.Wallet.createRandom().address, value: 1n })).wait();
}, 30000);

afterAll(async () => {
  provider?.destroy();
  await anvil?.stop();
});

test('matching independent receipts pass only after the required depth', async () => {
  const shallow = await proveLpReceipt({ primary: provider, secondary: provider, hash: receipt.hash });
  expect(shallow.uncertain).toBe(true);
  await provider.send('anvil_mine', [1]);
  const proven = await proveLpReceipt({ primary: provider, secondary: provider, hash: receipt.hash });
  expect(proven).toMatchObject({ ok: true, receipt: { transactionHash: receipt.hash } });
});

test('receipt proof waits for a later block to reach the required depth', async () => {
  const sent = await (await provider.getSigner(0)).sendTransaction({ to: ethers.Wallet.createRandom().address, value: 1n });
  const mined = await sent.wait();
  const pending = proveLpReceipt({ primary: provider, secondary: provider, hash: mined.hash, timeoutMs: 2000 });
  await new Promise((resolve) => { setTimeout(resolve, 100); });
  await provider.send('anvil_mine', [1]);
  expect(await pending).toMatchObject({ ok: true, receipt: { transactionHash: mined.hash } });
});

test('a different receipt from the other RPC stays uncertain', async () => {
  const malicious = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const rpc = JSON.parse(raw);
    if (rpc.method === 'eth_getTransactionReceipt') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: JSON.parse(JSON.stringify({ ...receipt, logs: [] }, (_key, value) => typeof value === 'bigint' ? ethers.toBeHex(value) : value)) }));
      return;
    }
    const upstream = await fetch(anvil.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw });
    res.writeHead(200, { 'content-type': 'application/json' }).end(await upstream.text());
  });
  await new Promise((resolve) => malicious.listen(0, '127.0.0.1', resolve));
  const fake = new ethers.JsonRpcProvider(`http://127.0.0.1:${malicious.address().port}`, ethers.Network.from(8453), { staticNetwork: true, pollingInterval: 50 });
  try {
    const proof = await proveLpReceipt({ primary: fake, secondary: provider, hash: receipt.hash });
    expect(proof).toMatchObject({ ok: false, uncertain: true });
  } finally {
    fake.destroy();
    malicious.closeAllConnections();
    await new Promise((resolve) => malicious.close(resolve));
  }
});
