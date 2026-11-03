// THE SPEND CARD in a real browser (#586): real Chromium renders the
// PRODUCTION TREASURY window against the real wallet, treasury, waiting and
// roster routes over a real session token, a real encrypted key on tmp disk,
// and anvil answering as Base (test keys only — never a public network). The
// operator's own key is imported into the REAL embedded wallet and signs the
// approval through its REAL consent modal: SIGN & APPROVE moves exactly the
// amount on the chain; DENY with a note moves nothing and the being is told
// the note. No double anywhere (RULE 0). Screens are written for a person.
/* global window, localStorage */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, URL } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer as createVite } from 'vite';
import { chromium } from '@playwright/test';
import { ethers } from 'ethers';
import { standTreasury, PASSWORD } from '../helpers/treasury-kit.js';
import { underFloor } from '../e2e/helpers/legibility.js';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const SHOTS = path.join(os.tmpdir(), 'neuma-treasury-shots');
let kit; let vite; let server; let browser; let operator; let quill; let recipient; let savedWitnesses;
let wallet; let news;

beforeAll(async () => {
  kit = await standTreasury('treasury-browser');
  savedWitnesses = process.env.WITNESSES_ROOT;
  process.env.WITNESSES_ROOT = path.join(kit.root, '..', 'witnesses');
  operator = kit.operator();
  recipient = ethers.Wallet.createRandom().address;
  quill = await kit.addBeing({ laneId: 'quill', owner: operator, keyIndex: 0, name: 'Quill', recipients: [{ address: recipient, label: 'the printer' }] });
  await kit.addBeing({ laneId: 'tally', owner: operator, keyIndex: 1, name: 'Tally' });
  wallet = await import('../../backend/services/neuma-wallet.js');
  news = await import('../../backend/services/treasury/spend-news.js');
  const { cfoDesignation } = await import('../../backend/services/treasury/cfo-designation.js');
  await cfoDesignation.designate(operator.house, 'tally');

  kit.app.use('/api/v1/roster', (await import('../../backend/routes/roster-routes.js')).default);
  vite = await createVite({
    configFile: false, root: REPO, cacheDir: path.join(kit.root, '..', 'vite-cache'), appType: 'custom',
    esbuild: { jsx: 'automatic' },
    optimizeDeps: { entries: ['test/helpers/treasury-page.jsx'], include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react-i18next', 'i18next', 'ethers'] },
    server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null },
  });
  kit.app.get('/', (_req, res) => res.type('html').send(
    `<!doctype html><html><body style="background:#000;margin:0"><script>window.treasuryFixture=${JSON.stringify({ token: operator.auth.Authorization.slice(7) })}</script><div id="root"></div><script type="module" src="/test/helpers/treasury-page.jsx"></script></body></html>`,
  ));
  kit.app.use(vite.middlewares);
  server = http.createServer(kit.app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
  await fs.mkdir(SHOTS, { recursive: true });
}, 120000);

afterAll(async () => {
  await browser?.close();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await vite?.close();
  if (savedWitnesses === undefined) delete process.env.WITNESSES_ROOT; else process.env.WITNESSES_ROOT = savedWitnesses;
  await kit?.stop();
}, 30000);

describe('the TREASURY window — a spend decided on its card', () => {
  it('shows the whole card, approves through the real signature and password, and denies with a note', async () => {
    const approveMe = await wallet.requestSpend('quill', { to: recipient, value: '0.0123', memo: 'Printing the launch flyers.' });
    const denyMe = await wallet.requestSpend('quill', { to: recipient, value: '0.004', memo: 'A second print run.' });
    const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);

    const card = page.locator(`[data-spend-id="${approveMe.request.id}"]`);
    await card.waitFor({ state: 'visible', timeout: 30000 });
    const text = await card.innerText();
    for (const line of ['SPEND', 'QUILL ASKS', '0.0123', 'ETH · BASE MAINNET', 'Printing the launch flyers.', recipient,
      'ON YOUR APPROVED LIST AS "the printer"', 'FIRST TIME', quill.address, 'AFTER (BEFORE THE NETWORK FEE)',
      'EVERY SEND FROM THIS BEING NEEDS YOUR SIGNATURE', 'NOT YET REVIEWED']) {
      // The data register is set in capitals by its style; read it as a person reads it.
      expect(text.toUpperCase(), line).toContain(line.toUpperCase());
    }
    expect(text).toMatch(/2[34]H( \d+M)? LEFT/);
    await expect.poll(() => page.locator('.tre-tile').first().innerText()).toContain('2');
    await expect.poll(() => page.locator('.tre-mark').count()).toBe(7);
    // Never one press: SIGN & APPROVE stands disabled until the key password is typed.
    expect(await card.getByRole('button', { name: 'SIGN & APPROVE' }).isDisabled()).toBe(true);
    await page.screenshot({ path: path.join(SHOTS, 'treasury-spend-card.png'), fullPage: true });
    // Every word on the window reads at the desk's 13px floor, the card's whole decision included (Design note, 2026-10-30.
    expect(await underFloor(page.locator('.treasury'))).toEqual([]);

    // The operator's own key, in the REAL embedded wallet.
    await page.evaluate(async (key) => {
      const imported = await window.embedded.importEmbeddedWallet(key, 'operator-embedded-pass');
      localStorage.setItem('walletAddress', imported.address);
    }, operator.wallet.privateKey);
    await card.getByLabel("the being's key password").fill(PASSWORD);
    await card.getByRole('button', { name: 'SIGN & APPROVE' }).click();
    const modal = page.locator('.wallet-confirm-approve');
    await modal.waitFor({ state: 'visible' });
    await page.screenshot({ path: path.join(SHOTS, 'treasury-spend-signature.png') });
    await modal.click();
    await card.waitFor({ state: 'detached', timeout: 30000 });
    expect(await kit.baseProvider.getBalance(recipient)).toBe(ethers.parseEther('0.0123'));

    const second = page.locator(`[data-spend-id="${denyMe.request.id}"]`);
    expect(await second.innerText()).not.toContain('FIRST TIME');
    await second.getByRole('button', { name: 'DENY', exact: true }).click();
    await second.locator('textarea').fill('One print run is enough for launch week.');
    await second.getByRole('button', { name: 'DENY — NOTHING MOVES' }).click();
    await second.waitFor({ state: 'detached', timeout: 30000 });
    expect(await kit.baseProvider.getBalance(recipient)).toBe(ethers.parseEther('0.0123'));
    await expect.poll(() => page.locator('[data-treasury-section="spends"]').innerText()).toContain('NO SPEND WAITS ON YOU');
    await expect.poll(() => page.locator('[data-treasury-section="history"]').innerText()).toContain('DENIED');
    await page.screenshot({ path: path.join(SHOTS, 'treasury-after.png'), fullPage: true });
    expect(await underFloor(page.locator('.treasury'))).toEqual([]); // the history rows too

    const told = await news.spendNewsFor('quill');
    expect(told.text).toContain('APPROVED');
    expect(told.text).toContain('DECLINED');
    expect(told.text).toContain('"One print run is enough for launch week."');
    expect(errors).toEqual([]);
    await page.close();
  }, 120000);
});
