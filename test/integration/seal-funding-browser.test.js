/**
 * THE ETHEREUM SEAL, FOR SOMEONE WHO HAS NEVER HEARD OF ETHEREUM (2026-10-26): the real walkthrough in a real
 * Chromium, against the real cost route, real signed-wallet auth and a REAL chain — Anvil running the real
 * Natalis (natalis-chain-kit.js), its own fees and balances. An empty wallet sees what Ethereum is, what the
 * seal needs, how much more, where to buy, the address to send to (with a QR) and the network; once the ETH
 * lands on the chain the walkthrough notices by itself and opens the seal. Nothing is mocked. Screenshots land
 * in test/e2e/shots/seal-funding-*.png.
 */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createServer } from 'vite';
import { chromium, expect as pw } from '@playwright/test';
import { createTempDir } from '../helpers/temp-fs.js';
import { shotPath } from '../helpers/first-run-door-kit.js';
import { startNatalisChain, fund, NATALIS } from '../helpers/natalis-chain-kit.js';

const REPO = fileURLToPath(new URL('../..', import.meta.url));

describe('the Ethereum seal walkthrough', () => {
  let chain, vite, server, browser, operator, url;

  beforeAll(async () => {
    chain = await startNatalisChain();
    const dir = await createTempDir('seal-funding');
    const { loadConfig } = await import('../../backend/config.js');
    loadConfig({ ...process.env, CEREMONY_SEAL_NETWORK: 'ethereum-sepolia', ETH_SEPOLIA_RPC_URL: chain.url, NATALIS_ETH_SEPOLIA_ADDRESS: NATALIS });
    const { fullAuth } = await import('../helpers/audit-auth.js');
    operator = await fullAuth();
    const { default: preflightRouter } = await import('../../backend/routes/preflight-routes.js');
    const { default: routingRouter } = await import('../../backend/routes/routing-routes.js');
    vite = await createServer({ configFile: false, root: REPO, cacheDir: path.join(dir, 'cache'), appType: 'custom',
      esbuild: { jsx: 'automatic' }, optimizeDeps: { entries: ['test/fixtures/seal-funding.jsx'] },
      server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null } });
    const app = express();
    app.use(express.json());
    app.use('/api/v1/preflight', preflightRouter);
    app.use('/api/v1/routing', routingRouter);
    app.get('/', (_q, res) => res.type('html').send('<!doctype html><body style="margin:0;background:#000"><script type="module" src="/test/fixtures/seal-funding.jsx"></script>'));
    app.use(vite.middlewares);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${server.address().port}/`;
    browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    server?.closeAllConnections();
    await new Promise((resolve) => server?.close(resolve));
    await vite?.close();
    await chain?.stop();
  });

  const open = async () => {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    await page.addInitScript((t) => sessionStorage.setItem('authToken', t), operator.token);
    await page.goto(url);
    await page.getByTestId('seal-funding-gauge').waitFor({ timeout: 60_000 });
    return page;
  };

  test('an empty wallet: what Ethereum is, what it needs, where to buy, where to send — then it opens by itself when the ETH lands', async () => {
    await fund(chain.rpc, operator.address, '0');
    const page = await open();
    const panel = page.getByTestId('seal-funding');
    await pw(panel).toContainText('Ethereum is a public ledger');
    await pw(panel).toContainText('YOUR WALLET 0.0000 ETH');
    await pw(panel).toContainText(/NEEDS ABOUT \d+\.\d{4} ETH/);
    await pw(panel).toContainText(/YOU NEED ABOUT \d+\.\d{4} ETH MORE/);
    for (const label of ['Coinbase', 'Kraken', 'Exchanges in your country']) {
      await pw(panel.getByRole('link', { name: label })).toHaveAttribute('href', /^https:\/\//);
    }
    await pw(page.getByTestId('seal-funding-address')).toHaveText(new RegExp(operator.address, 'i'));
    await pw(panel).toContainText(/on the Ethereum Sepolia \(testnet\) network/);
    await pw(panel.locator('img.seal-funding-qr')).toHaveAttribute('src', /^data:image\/png/);
    await pw(page.getByTestId('seal-funding-go')).toBeDisabled();
    await page.screenshot({ path: shotPath('seal-funding-short-1366'), fullPage: true });

    await fund(chain.rpc, operator.address, '1');
    await pw(page.getByTestId('seal-funding-go')).toBeEnabled({ timeout: 25_000 }); // the 15 s watch
    await pw(page.getByTestId('seal-funding-go')).toHaveText('SEAL ON ETHEREUM');
    await pw(panel).not.toContainText('YOU NEED ABOUT');
    await page.screenshot({ path: shotPath('seal-funding-ready-1366'), fullPage: true });
    await page.getByTestId('seal-funding-go').click();
    expect(await page.evaluate(() => window.sealed)).toBe(true);
    await page.close();
  }, 90_000);

  test('finishing without Ethereum is always one press away', async () => {
    await fund(chain.rpc, operator.address, '0');
    const page = await open();
    await page.getByRole('button', { name: 'FINISH WITHOUT ETHEREUM' }).click();
    expect(await page.evaluate(() => window.skipped)).toBe(true);
    await page.close();
  }, 90_000);
});
