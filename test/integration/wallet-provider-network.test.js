import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, URL } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout, clearTimeout } from 'node:timers';
import { Wallet } from 'ethers';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { expect, test } from 'vitest';

test('embedded provider uses selected browser network and real custom RPC without retired config', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'wallet-network-'));
  let anvil; let vite; let browser; let server;
  try {
    anvil = spawn('anvil', ['--port', '0', '--host', '127.0.0.1', '--chain-id', '84532'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const rpc = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Anvil did not announce its ephemeral port')), 10000);
      anvil.once('error', (error) => { clearTimeout(timer); reject(error); });
      anvil.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Anvil exited before readiness: ${code}`)); });
      anvil.stdout.on('data', (chunk) => {
        output = (output + chunk.toString()).slice(-32768);
        const match = output.match(/Listening on 127\.0\.0\.1:(\d+)/);
        if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); }
      });
      anvil.stderr.resume();
    });
    vite = await createServer({ configFile: false,
      root: fileURLToPath(new URL('../..', import.meta.url)), cacheDir: path.join(temp, 'vite'),
      appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null },
    });
    vite.middlewares.use((req, res, next) => {
      if (req.url !== '/') return next();
      res.setHeader('Content-Type', 'text/html');
      res.end(`<!doctype html><script type="module">
        import { browserProvider } from '/frontend/services/wallet-providers.js';
        import { writeReg } from '/frontend/services/wallet-browser-keystore.js';
        import * as client from '/frontend/app/RelinkShell/wallet-client.js';
        import * as rpc from '/frontend/app/RelinkShell/wallet-rpc-browser.js';
        import * as network from '/frontend/services/wallet-browser-network.js';
        globalThis.proof = { browserProvider, writeReg, client, rpc, network };
      </script>`);
    });
    server = http.createServer(vite.middlewares);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
    const page = await browser.newPage();
    const requests = [];
    const errors = [];
    page.on('request', (request) => requests.push(request.url()));
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => globalThis.proof);
    const result = await page.evaluate(async ({ rpcUrl, address }) => {
      const { browserProvider, writeReg, client, rpc, network } = globalThis.proof;
      globalThis.localStorage.setItem('walletAddress', address);
      writeReg({ activeId: 'proof', wallets: [{ id: 'proof', address }] });
      const provider = browserProvider();
      const initial = await provider.request({ method: 'eth_chainId' });
      await client.setNetwork('base-sepolia');
      const selected = await provider.request({ method: 'eth_chainId' });
      const custom = rpc.setBrowserRpc(rpcUrl);
      const block = await provider.request({ method: 'eth_blockNumber' });
      const panelBlock = await client.readBaseRpc('eth_blockNumber');
      const cached = network.getBrowserNetworkProvider();
      rpc.clearBrowserRpc();
      const changed = network.getBrowserNetworkProvider() !== cached;
      const previousClosed = cached.destroyed;
      await client.setNetwork('base');
      const restored = await provider.request({ method: 'eth_chainId' });
      return { initial, selected, restored, custom: custom.ok, block, panelBlock, changed, previousClosed };
    }, { rpcUrl: rpc, address: Wallet.createRandom().address });
    // a fresh wallet starts on Ethereum mainnet (0x1, home since 2026-10-04); Base stays selectable
    expect(result).toEqual({ initial: '0x1', selected: '0x14a34', restored: '0x2105', custom: true, block: '0x0', panelBlock: '0x0', changed: true, previousClosed: true });
    expect(requests.some((url) => url.includes('/api/v1/config/contracts'))).toBe(false);
    expect(requests.every((url) => new URL(url).hostname === '127.0.0.1')).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await vite?.close();
    if (anvil && anvil.exitCode === null && anvil.signalCode === null) {
      const exited = once(anvil, 'exit');
      anvil.kill('SIGTERM');
      await exited;
    }
    await fs.rm(temp, { recursive: true, force: true });
  }
}, 30000);
