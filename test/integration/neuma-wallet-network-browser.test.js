/* global window, sessionStorage, localStorage */
// The WALLET window's neuma tab, PROVEN in a real browser (RULE 0): real
// Chromium runs the real WalletApp bundle against the real wallet router on a
// real temp workspace, with a real session from the real challenge/sign path.
// Two real JSON-RPC nodes on loopback stand in for the chains: the "being" node
// the backend reads the neuma wallet through (BASE_MAINNET_RPC_URL via the real
// loadConfig), answering HTTP 503, and the "desk" node the browser's own reads
// go through (the custom-RPC key the real wallet-rpc-browser reads), relayed
// through the page's own origin so the browser's CORS rule holds.
//
// What it proves: a desk set to Ethereum shows the neuma's balance as READ ON
// BASE, an unanswered read shows "— ETH" plus a could-not-read line (never
// "0 ETH"), the neuma tab reads no tokens through the desk's Ethereum RPC, and
// on a desk set to Base the token read does happen.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import express from 'express';
import http from 'node:http';
import { build } from 'vite';
import { chromium, expect } from '@playwright/test';
import { test } from 'vitest';
import { ethers } from 'ethers';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { loadConfig, _resetConfig } from '../../backend/config.js';
import walletRouter from '../../backend/routes/neuma-wallet-routes.js';
import { fullAuth, writeOwner } from '../helpers/audit-auth.js';
import { startLocalBaseRpc } from '../helpers/local-base-rpc.js';

const LANE = 'network-being';
const entryId = 'virtual:neuma-wallet-network-proof';
const source = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { walletApp } from ${JSON.stringify(path.resolve('frontend/app/RelinkShell/WalletApp.jsx'))};
  import { setRoster } from ${JSON.stringify(path.resolve('frontend/utils/companion-data.js'))};
  window.mountWallet = (neumaId) => {
    setRoster([{ neumaId, name: 'Keir' }], []);
    createRoot(document.getElementById('root')).render(React.createElement(walletApp.Body));
  };
`;

const ethCalls = (node) => node.calls.filter((c) => c.method === 'eth_call').length;

/** A real HTTP endpoint that answers every RPC request 503, counting them. */
const startDownRpc = () => new Promise((resolve) => {
  const node = { hits: 0 };
  const srv = http.createServer((req, res) => { node.hits += 1; req.resume(); res.writeHead(503); res.end('rpc unavailable'); });
  srv.listen(0, '127.0.0.1', () => resolve(Object.assign(node, {
    url: `http://127.0.0.1:${srv.address().port}`,
    close: () => new Promise((done) => srv.close(done)),
  })));
});

test('the neuma tab names the network it read, says when it could not read, and reads no tokens off-chain', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-wallet-network-'));
  const previous = getWorkspacesRoot();
  let server; let browser; let beingNode; let deskNode;
  try {
    setWorkspacesRoot(root);
    const auth = await fullAuth();
    const being = ethers.Wallet.createRandom();
    await writeOwner(root, LANE, auth.address);
    await workspace.writeEncryptedKeypair(LANE, { address: being.address });
    beingNode = await startDownRpc();
    deskNode = await startLocalBaseRpc();
    loadConfig({ BASE_MAINNET_RPC_URL: beingNode.url });

    const bundle = await build({ configFile: false, root: process.cwd(), logLevel: 'error',
      esbuild: { jsx: 'automatic' },
      plugins: [{ name: 'neuma-wallet-network-proof', resolveId: (id) => id === entryId ? id : null,
        load: (id) => id === entryId ? source : null }],
      build: { write: false, rollupOptions: { input: entryId } } });
    const app = express(); app.use(express.json());
    app.use('/api/v1/neuma', walletRouter);
    app.post('/desk-rpc', async (req, res) => {
      const upstream = await fetch(deskNode.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body) });
      res.status(upstream.status).type('application/json').send(await upstream.text());
    });
    for (const file of bundle.output) app.get(`/${file.fileName}`, (_req, res) =>
      res.type(path.extname(file.fileName)).send(file.type === 'chunk' ? file.code : file.source));
    const entry = bundle.output.find((file) => file.type === 'chunk' && file.isEntry).fileName;
    app.get('/', (_req, res) => res.send(`<div id="root"></div><script type="module" src="/${entry}"></script>`));
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    browser = await chromium.launch({ args: ['--disable-gpu'] });
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.mountWallet);
    await page.evaluate(({ token, address, rpc, lane }) => {
      sessionStorage.setItem('authToken', token);
      localStorage.setItem('walletAddress', address);
      localStorage.setItem(`${address.toLowerCase()}:base-rpc`, rpc);
      localStorage.setItem('wallet-network', 'ethereum');
      window.mountWallet(lane);
    }, { token: auth.token, address: auth.address, rpc: `http://127.0.0.1:${server.address().port}/desk-rpc`, lane: LANE });

    // ME is read first, through the desk node; let that read settle.
    const head = page.locator('.wal-head');
    await expect(head).toContainText('1.0 ETH');
    await expect(page.getByRole('button', { name: 'Refresh balance' })).toBeEnabled();
    const deskCallsBefore = ethCalls(deskNode);

    await page.selectOption('select', LANE);
    await expect(head).toContainText('READ ON BASE');
    await expect(head).toContainText('— ETH');
    await expect(head).not.toContainText('0 ETH');
    await expect(page.locator('.wal-err')).toContainText("Could not read this wallet's balance on BASE");
    await expect(head.locator('.wal-head-scan')).toHaveAttribute('href', `https://basescan.org/address/${being.address}`);
    await expect(page.getByRole('button', { name: 'Refresh balance' })).toBeEnabled();
    // The backend really asked the Base node; the desk's Ethereum RPC was never asked for tokens.
    expect(beingNode.hits).toBeGreaterThan(0);
    expect(ethCalls(deskNode)).toBe(deskCallsBefore);

    // A desk set to Base reads on the same network, so the token read belongs.
    await page.evaluate(() => localStorage.setItem('wallet-network', 'base'));
    await page.getByRole('button', { name: 'Refresh balance' }).click();
    await expect.poll(() => ethCalls(deskNode)).toBeGreaterThan(deskCallsBefore);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    server?.closeAllConnections();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await beingNode?.close();
    await deskNode?.close();
    _resetConfig();
    setWorkspacesRoot(previous);
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120_000);
