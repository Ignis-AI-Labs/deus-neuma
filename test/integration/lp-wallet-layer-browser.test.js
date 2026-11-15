/* global window, sessionStorage, localStorage, getComputedStyle */
// The WALLET window's LIQUIDITY layer, PROVEN in a real browser (RULE 0): real
// Chromium runs the real WalletApp bundle against the real wallet and LP
// routers on a real temp workspace, with a real session. Base is anvil as
// chain 8453 (the backend's chain registry and wallet reads both point at it),
// and a real HTTP listener plays Umbrae (test/helpers/umbrae-stand-in.js).
//
// What it proves: a house member's wallets are addresses in one list; the
// operator opens the LP wallet and funds it like any wallet (RECEIVE, a code
// to scan); sets a budget; sees a deposit past it waiting as a card; APPROVE
// runs it on Base from the LP wallet; the window passes axe with no finding;
// shows what it EARNED, how it runs round the clock (its pace, the charter door), and
// a reward it earned: APPROVE pays the operator in USDC from the LP wallet;
// and with the connection off, TURN ON sends Settings to that switch.
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import express from 'express';
import http from 'node:http';
import { build } from 'vite';
import { chromium, expect } from '@playwright/test';
import { test, expect as vexpect } from 'vitest';
import { ethers } from 'ethers';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { loadConfig, _resetConfig } from '../../backend/config.js';
import { resetChainProviders } from '../../backend/services/chain/chain-registry.js';
import walletRouter from '../../backend/routes/neuma-wallet-routes.js';
import lpRouter from '../../backend/routes/lp-wallet-routes.js';
import { runLpAction } from '../../backend/services/umbrae-lp/lp-run.js';
import { UMBRAE_BASE } from '../../core/wallet/lp-tx-policy.js';
import { fullAuth, writeOwner } from '../helpers/audit-auth.js';
import { createTempDir } from '../helpers/temp-fs.js';
import { startAnvil, miniErc20Initcode, MINI_ERC20_ABI } from '../helpers/money-in-kit.js';
import { returnContract } from '../helpers/evm-return-contract.js';
import { installLpManager, installLpPool } from '../helpers/lp-chain-kit.js';
import { connectionsOn } from '../helpers/connections-kit.js';
import { startUmbraeStandIn, POOL, USDC } from '../helpers/umbrae-stand-in.js';
import { setGoal, requestReward } from '../../backend/services/umbrae-lp/lp-rewards.js';
import { axeScan } from '../helpers/a11y-scan.js';

const LANE = 'lp-layer-being';
const entryId = 'virtual:lp-wallet-layer-proof';
const source = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import ${JSON.stringify(path.resolve('frontend/styles/main.css'))};
  import { walletApp } from ${JSON.stringify(path.resolve('frontend/app/RelinkShell/WalletApp.jsx'))};
  import { setRoster } from ${JSON.stringify(path.resolve('frontend/utils/companion-data.js'))};
  window.mountWallet = (neumaId) => {
    setRoster([{ neumaId, name: 'Keir' }], []);
    createRoot(document.getElementById('root')).render(React.createElement(walletApp.Body));
  };
`;

// Every visible word in the window, measured: none under 13px (design-language.md § CHOKKAN).
const underFloor = (page) => page.locator('.wal').evaluate((root) => [...root.querySelectorAll('*')]
  .filter((el) => el.getClientRects().length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
  .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 13)
  .map((el) => `${el.className || el.tagName}: ${getComputedStyle(el).fontSize} "${el.textContent.trim().slice(0, 24)}"`));

test('the operator opens the LP wallet, sets its budget, and approves a deposit that waited', async () => {
  const root = await createTempDir('lp-layer');
  const previous = getWorkspacesRoot();
  const priorRpc = process.env.BASE_MAINNET_RPC_URL;
  let server; let browser; let anvil; let provider; let umbrae; let connections;
  try {
    setWorkspacesRoot(root);
    const auth = await fullAuth();
    await writeOwner(root, LANE, auth.address);
    await workspace.writeEncryptedKeypair(LANE, { address: ethers.Wallet.createRandom().address });
    anvil = await startAnvil({ chainId: 8453 });
    provider = new ethers.JsonRpcProvider(anvil.url, ethers.Network.from(8453), { staticNetwork: true, pollingInterval: 100 });
    process.env.BASE_MAINNET_RPC_URL = anvil.url;
    loadConfig({ BASE_MAINNET_RPC_URL: anvil.url });
    resetChainProviders();
    umbrae = await startUmbraeStandIn({ provider });
    await installLpManager(provider, UMBRAE_BASE.positionManager);
    await installLpPool(provider, POOL);
    for (const [token, units] of [['0x4200000000000000000000000000000000000006', 18], [USDC, 6]]) {
      await provider.send('anvil_setCode', [token, returnContract({ fallback: ethers.AbiCoder.defaultAbiCoder().encode(['uint8'], [units]) })]);
    }
    connections = connectionsOn(['umbrae-liquidity', 'market-data']);

    const bundle = await build({ configFile: false, root: process.cwd(), logLevel: 'error',
      esbuild: { jsx: 'automatic' },
      plugins: [{ name: 'lp-wallet-layer-proof', resolveId: (id) => id === entryId ? id : null,
        load: (id) => id === entryId ? source : null }],
      build: { write: false, rollupOptions: { input: entryId } } });
    const app = express(); app.use(express.json());
    app.use('/api/v1/neuma', walletRouter);
    app.use('/api/v1/neuma', lpRouter);
    for (const file of bundle.output) app.get(`/${file.fileName}`, (_req, res) =>
      res.type(path.extname(file.fileName)).send(file.type === 'chunk' ? file.code : file.source));
    const entry = bundle.output.find((file) => file.type === 'chunk' && file.isEntry).fileName;
    // The built styles are linked, so the bar is drawn and axe judges contrast on the real colours.
    const css = bundle.output.filter((file) => file.fileName.endsWith('.css')).map((file) => `<link rel="stylesheet" href="/${file.fileName}">`).join('');
    app.get('/', (_req, res) => res.send(`<!doctype html><html lang="en"><head><title>Wallet</title>${css}</head><body style="margin:0;background:#0b0e11"><main id="root" style="width:520px;height:900px;display:flex;flex-direction:column"></main><script type="module" src="/${entry}"></script></body></html>`));
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    browser = await chromium.launch({ args: ['--disable-gpu'] });
    const page = await (await browser.newContext()).newPage();
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.mountWallet);
    await page.evaluate(({ token, address, lane }) => {
      sessionStorage.setItem('authToken', token);
      localStorage.setItem('walletAddress', address);
      localStorage.setItem('wallet-network', 'base');
      window.mountWallet(lane);
    }, { token: auth.token, address: auth.address, lane: LANE });

    await page.selectOption('select', LANE);
    // The house member's wallets are addresses in a list; LIQUIDITY is not opened yet.
    const lpRow = page.getByRole('radio', { name: /LIQUIDITY/ });
    await expect(lpRow).toContainText('OPEN +');
    await lpRow.click();
    await expect(lpRow).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', { name: 'OPEN LP WALLET' }).click();
    // Once opened it is an ordinary wallet: its address in the list, RECEIVE with a code to scan.
    await expect(lpRow).toContainText(/0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4}/);
    await page.getByRole('button', { name: 'RECEIVE' }).click();
    const addressBox = page.locator('.wal-recv-addr');
    await expect(addressBox).toHaveText(/^0x[0-9a-fA-F]{40}$/);
    const lpAddress = await addressBox.textContent();
    await expect(page.locator('.wal-recv img.wal-qr')).toBeVisible();
    await expect(page.getByRole('button', { name: 'COPY ADDRESS' })).toBeVisible();
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('region', { name: 'Waiting for you' })).toHaveCount(0);

    // No cap yet: deposits would run on their own; setting a cap folds the field to a figure.
    await expect(page.getByText('No cap: deposits run on their own')).toBeVisible();
    await page.getByLabel('Budget in dollars').fill('10');
    await page.getByRole('button', { name: 'SET', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Change budget' })).toContainText('$10.00');

    // The house member asks for more than the budget; after a refresh it waits as a card.
    await provider.send('anvil_setBalance', [lpAddress, ethers.toQuantity(ethers.parseEther('1'))]);
    const waited = await runLpAction(LANE, { type: 'open', pool: POOL, amountY: '25' }, { provider, pollMs: 50 });
    vexpect(waited.pending).toBe(true);
    await page.getByRole('button', { name: 'Refresh balance' }).click();
    const card = page.getByRole('listitem', { name: 'OPEN IN WETH-USDC, $25.00' });
    await expect(card).toContainText('25 USDC · past the $10.00 budget');
    await expect(lpRow.locator('.wal-addr-flag')).toHaveText('1 WAITING');
    await expect(page.getByRole('img', { name: /\$25\.00 waiting of a \$10\.00 budget/ })).toBeVisible();

    const scan = await axeScan(page, { include: '.wal' });
    vexpect(scan.counts).toEqual({});
    vexpect(await underFloor(page)).toEqual([]);

    await card.getByRole('button', { name: 'APPROVE' }).click();
    await expect(page.getByText(/^Done: 1 transaction\(s\) on Base, position #77\.$/)).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('region', { name: 'Waiting for you' })).toHaveCount(0);
    const sent = umbrae.seen.filter((r) => r.url === '/api/v1/base/send');
    vexpect(sent).toHaveLength(2); // the token approval, then the deposit
    const last = ethers.Transaction.from(sent[1].body.signedTransaction);
    vexpect((await provider.getTransactionReceipt(last.hash)).from).toBe(ethers.getAddress(lpAddress));

    // EARNED, ROUND THE CLOCK and GOALS. A real token is placed at USDC's address only now (the deposit's
    // approval above went to a USDC with no code); 50 USDC arrive from outside, then WETH's price rises.
    const deployer = await provider.getSigner(0);
    const made = await (await deployer.sendTransaction({ data: miniErc20Initcode(0n) })).wait();
    await provider.send('anvil_setCode', [USDC, await provider.getCode(made.contractAddress)]);
    await provider.send('anvil_setStorageAt', [USDC, ethers.zeroPadValue(lpAddress, 32), ethers.toBeHex(50_000_000n, 32)]);
    await page.getByRole('button', { name: 'Refresh balance' }).click();
    const earned = page.getByRole('region', { name: 'Earned' });
    await expect(earned).toContainText('Free for rewards');
    // Every token it holds is on its list, read the way its book reads them (Founder 11-13: […]).
    await expect(page.getByRole('list', { name: 'Token holdings' })).toContainText('USDC');
    await expect(page.getByRole('list', { name: 'Token holdings' })).toContainText('50');
    umbrae.state.wethPrice = 3400;
    const clock = page.getByRole('region', { name: 'Round the clock' });
    await expect(clock).toContainText('CANNOT WAKE');
    await expect(clock.getByRole('button', { name: 'OPEN CHARTER →' })).toBeVisible();
    await clock.getByLabel('Portfolio round').selectOption('30');
    const gpu = (await setGoal(LANE, { what: 'A new GPU', costUsd: 20, why: 'faster portfolio rounds' })).goal;
    vexpect((await requestReward(LANE, gpu.id)).ok).toBe(true);
    await page.getByRole('button', { name: 'Refresh balance' }).click();
    await expect(earned.locator('.lpw-earn')).toHaveText(/^\+\$\d+\.\d\d$/);
    await expect(clock.getByLabel('Portfolio round')).toHaveValue('30');
    const goals = page.getByRole('region', { name: 'Goals' });
    await expect(goals).toContainText('A new GPU');
    vexpect((await axeScan(page, { include: '.wal' })).counts).toEqual({});
    vexpect(await underFloor(page)).toEqual([]);
    await goals.getByRole('button', { name: 'APPROVE · PAYS YOU $20.00 USDC' }).click();
    await expect(page.getByText('Paid: A new GPU. Get it for Keir, then mark it delivered.')).toBeVisible({ timeout: 30000 });
    vexpect(await new ethers.Contract(USDC, MINI_ERC20_ABI, provider).balanceOf(auth.address)).toBe(20_000_000n);
    await goals.getByRole('button', { name: 'MARK DELIVERED' }).click();
    await expect(goals).toContainText('Delivered. It stays on its record.');

    // The MAIN wallet holds the same floor.
    await page.getByRole('radio', { name: /MAIN/ }).click();
    await expect(page.locator('.wal-head')).toBeVisible();
    vexpect(await underFloor(page)).toEqual([]);
    await lpRow.click();

    // The connection off: the problem is a door that opens Settings at its switch.
    connections.restore();
    connections = connectionsOn([]);
    await page.getByRole('button', { name: 'Refresh balance' }).click();
    await expect(page.getByText('Umbrae connection is off')).toBeVisible();
    const focus = page.evaluate(() => new Promise((resolve) => {
      window.addEventListener('neuma:settings-focus', (e) => resolve(e.detail.target), { once: true });
    }));
    await page.getByRole('button', { name: 'TURN ON →' }).click();
    vexpect(await focus).toBe('connections/umbrae-liquidity');
    vexpect(errors).toEqual([]);
  } finally {
    await browser?.close();
    server?.closeAllConnections();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    connections?.restore();
    await umbrae?.close();
    provider?.destroy();
    await anvil?.stop();
    if (priorRpc === undefined) delete process.env.BASE_MAINNET_RPC_URL; else process.env.BASE_MAINNET_RPC_URL = priorRpc;
    _resetConfig();
    resetChainProviders();
    setWorkspacesRoot(previous);
    await fs.rm(root, { recursive: true, force: true });
  }
}, 180_000);
