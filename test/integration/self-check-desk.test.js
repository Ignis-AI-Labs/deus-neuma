/**
 * The sheet's STATE tab in a real browser — the operator presses RUN, the
 * being's self-check runs as real turns, and the rows it shows are the run the
 * backend kept. RULE 0: no mocks. Real Chromium, the real SelfCheckSection
 * (through the sheet's own StateSection import), signed-challenge auth, the
 * real workspace router, real encrypted lanes, and every item a whole real
 * turn over a real loopback provider (test/helpers/self-check-kit.js — the
 * true fact everywhere except memory, where the answer is wrong).
 *
 * VISIBLE state, not classes: the scores, a wrong answer's evidence, and the
 * journal / past-chats / charter rows are asserted as the text an operator reads.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import express from 'express';
import request from 'supertest';
import { Wallet } from 'ethers';
import { createServer as createVite } from 'vite';
import { chromium, expect as browserExpect } from '@playwright/test';
import { openSelfCheckKit } from '../helpers/self-check-kit.js';

const LANE = 'selfcheckdesk';
let kit, vite, server, browser, token, wallet;

beforeAll(async () => {
  wallet = Wallet.createRandom();
  kit = await openSelfCheckKit({ label: 'self-check-desk', lane: LANE, ownerAddress: wallet.address });
  const { createAuthRouter } = await import('../../backend/services/auth.js');
  const { default: workspaceRouter } = await import('../../backend/routes/workspace-routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/v1/auth', createAuthRouter(express));
  app.use('/api/v1/workspace', workspaceRouter);
  const challenge = await request(app).get('/api/v1/auth/challenge').query({ address: wallet.address });
  const verified = await request(app).post('/api/v1/auth/verify').send({
    address: wallet.address, challenge: challenge.body.challenge, signature: await wallet.signMessage(challenge.body.challenge),
  });
  expect(verified.status).toBe(200);
  token = verified.body.token;
  vite = await createVite({ configFile: false, root: fileURLToPath(new URL('../..', import.meta.url)),
    cacheDir: path.join(kit.root, 'vite'), appType: 'custom', esbuild: { jsx: 'automatic' },
    optimizeDeps: { entries: ['test/helpers/self-check-desk-page.jsx'], include: ['react', 'react-dom/client', 'react/jsx-runtime'] },
    server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null },
  });
  app.get('/', (_req, res) => res.type('html').send('<!doctype html><div id="root"></div><script type="module" src="/test/helpers/self-check-desk-page.jsx"></script>'));
  app.use(vite.middlewares);
  server = await new Promise((resolve) => { const live = app.listen(0, '127.0.0.1', () => resolve(live)); });
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await vite?.close();
  await kit?.close();
});

it('RUN asks consent, measures, and shows the kept run — scores, evidence, every part measured', async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 1400 }, reducedMotion: 'reduce' });
  const errors = [];
  const failures = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.url().includes('/api/v1/') && response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
  });
  await page.addInitScript(({ token: t, address }) => {
    sessionStorage.setItem('authToken', t);
    localStorage.setItem('walletAddress', address);
  }, { token, address: wallet.address });
  await page.goto(`http://127.0.0.1:${server.address().port}/?lane=${LANE}`);

  const tab = page.getByTestId('state-self-check');
  await browserExpect(tab).toContainText('NOT MEASURED — NO SELF-CHECK HAS RUN');
  await tab.getByRole('button', { name: 'RUN SELF-CHECK' }).click();
  await browserExpect(tab.locator('.rec-confirm-msg')).toContainText('It only reads');
  await tab.getByRole('button', { name: 'CONFIRM', exact: true }).click();

  // The kept run, as the operator reads it.
  await browserExpect(tab.locator('.rec-meta').first()).toContainText('ON qwen2.5-7b-instruct', { timeout: 60_000 });
  const row = (label) => tab.locator('.sc-row').filter({ has: page.locator('.rec-state-d', { hasText: new RegExp(`^${label}$`) }) });
  await browserExpect(row('Memory')).toContainText('0/2');
  await browserExpect(row('Identity')).toContainText('100%');
  await browserExpect(row('Vault')).toContainText('NOT MEASURABLE');
  // Every part has a door: the journal, past chats and charter are measured rows, and no gap is shown.
  for (const part of ['Journal', 'Past chats', 'House charter']) await browserExpect(row(part)).toContainText('100%');
  await browserExpect(tab).not.toContainText('NO DOOR');
  // A wrong answer opens to its evidence: the question, what it had to carry, what it said.
  await row('Memory').locator('.sc-row-head').click();
  const miss = row('Memory').locator('.sc-item').first();
  await browserExpect(miss).toContainText('WRONG');
  await browserExpect(miss).toContainText('Brightwater');
  await browserExpect(row('Memory').locator('.sc-items')).toContainText('Ottoline');
  await browserExpect(tab.getByRole('button', { name: 'RUN SELF-CHECK' })).toBeEnabled();
  await page.screenshot({ path: '/tmp/neuma-self-check-desk.png', fullPage: true });
  expect(errors).toEqual([]);
  expect(failures).toEqual([]);
  await page.close();
}, 90_000);
