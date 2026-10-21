// Actual panel -> HTTP client -> signed authentication -> real router/stores.
// Only reads the scheduler's status; no scheduler or model cycle is started.
/* global localStorage, sessionStorage */
import { beforeAll, afterAll, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import express from 'express';
import request from 'supertest';
import { Wallet } from 'ethers';
import { createServer as createVite } from 'vite';
import { chromium, expect as browserExpect } from '@playwright/test';
import { createAuthRouter } from '../../backend/services/auth.js';
import router from '../../backend/routes/meditation-routes.js';
import { meditationSettings } from '../../backend/services/meditation/meditation-settings.js';
import { appendMeditationRun } from '../../backend/services/meditation/meditation-state.js';
import { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { claimOwner } from '../helpers/claim-owner.js';

const KEYS = ['NEUMA_MEDITATION_SETTINGS_PATH', 'NEUMA_MEDITATION_STATE_PATH', 'NEUMA_MEDITATION'];
let tmp, saved, vite, server, browser, token, address, savedRoot;
beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'meditation-retry-ui-'));
  saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  process.env.NEUMA_MEDITATION_SETTINGS_PATH = path.join(tmp, 'settings.json');
  process.env.NEUMA_MEDITATION_STATE_PATH = path.join(tmp, 'state.json');
  delete process.env.NEUMA_MEDITATION;
  await meditationSettings.setBeing('retry-proof', { enabled: true, cadenceHours: 6 });
  const wallet = Wallet.createRandom();
  address = wallet.address;
  // the lane is this wallet's own (a house sees only its own lanes' meditation)
  savedRoot = getWorkspacesRoot();
  setWorkspacesRoot(path.join(tmp, 'workspaces'));
  await claimOwner(path.join(tmp, 'workspaces'), 'retry-proof', address);
  const app = express();
  app.use(express.json());
  app.use('/api/v1/auth', createAuthRouter(express));
  app.use('/api/v1/meditation', router);
  expect((await request(app).get('/api/v1/meditation')).status).toBe(401);
  const challenge = await request(app).get('/api/v1/auth/challenge').query({ address });
  const verified = await request(app).post('/api/v1/auth/verify').send({
    address, challenge: challenge.body.challenge, signature: await wallet.signMessage(challenge.body.challenge),
  });
  expect(verified.status).toBe(200);
  token = verified.body.token;
  vite = await createVite({
    configFile: false, root: fileURLToPath(new URL('../../', import.meta.url)),
    cacheDir: path.join(tmp, 'vite'), appType: 'custom', esbuild: { jsx: 'automatic' },
    optimizeDeps: { entries: ['test/helpers/meditation-retry-page.jsx'], include: ['react', 'react-dom/client', 'react/jsx-runtime'] },
    server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null },
  });
  app.get('/', (_req, res) => res.type('html').send('<!doctype html><html><body><div id="root"></div><script type="module" src="/test/helpers/meditation-retry-page.jsx"></script></body></html>'));
  app.use(vite.middlewares);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
}, 30000);
afterAll(async () => {
  await browser?.close();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await vite?.close();
  for (const [key, value] of Object.entries(saved || {})) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  if (savedRoot) setWorkspacesRoot(savedRoot);
  if (tmp) await fs.rm(tmp, { recursive: true, force: true });
});
it('shows the persisted retry through the production panel and clears it after rest', async () => {
  const at = (delta = 0) => new Date(Date.now() + delta).toISOString();
  await appendMeditationRun('retry-proof', { at: at(-1800000), outcome: 'synthesis' });
  await appendMeditationRun('retry-proof', { at: at(), outcome: 'unclear' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(({ address, token }) => {
    localStorage.setItem('walletAddress', address);
    sessionStorage.setItem('authToken', token);
  }, { address, token });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await browserExpect(page.getByTestId('meditation-retry')).toContainText('retry eligible in about 60 minutes');
  await appendMeditationRun('retry-proof', { at: at(-3601000), outcome: 'unclear' });
  await page.reload();
  await browserExpect(page.getByTestId('meditation-retry')).toContainText('retry eligible at the next quiet opportunity');
  await meditationSettings.setBeing('retry-proof', { enabled: false });
  await page.reload();
  await browserExpect(page.getByTestId('meditation-retry')).toContainText('retry paused while the timer is off');
  await appendMeditationRun('retry-proof', { at: at(), outcome: 'rest' });
  await page.reload();
  await browserExpect(page.getByTestId('meditation-run-row').first()).toContainText('CHOSE TO REST');
  await browserExpect(page.getByTestId('meditation-retry')).toHaveCount(0);
  expect(errors).toEqual([]);
  await page.close();
}, 30000);

// The gate rows use fixed inputs to verify production presentation only.
// The meditation history still travels through the actual store and API.
it('explains modes and persisted deferrals in readable type', async () => {
  const reasons = {
    'substrate-busy': 'the machine’s model engine was busy',
    'substrate-recently-active': 'waiting for its idle period',
    'portal-open': 'the being’s chat window was open',
    'substrate-not-lit': 'scheduled meditation never starts it',
    'substrate-not-ours': 'not managed by this app',
    'turns-in-flight': 'a conversation was still being answered',
    'training-lease-held': 'training has reserved the model engine',
    'env-locked': 'disabled by the app’s launch settings',
    'future-reason': 'details are unavailable',
  };
  for (const reason of Object.keys(reasons)) {
    await appendMeditationRun('retry-proof', { at: new Date().toISOString(), outcome: 'deferred', reason });
  }
  const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript((token) => sessionStorage.setItem('authToken', token), token);
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  for (const [reason, text] of Object.entries(reasons)) {
    // The diagnostic identifier belongs to the row, never the display sentence.
    await browserExpect(page.locator(`[data-testid="meditation-run-row"][title="${reason}"]`)).toContainText(text);
  }
  const meanings = {
    'undercurrent-off': 'not added to conversation prompts',
    'undercurrent-shadow': 'without adding them to conversation prompts',
    'undercurrent-live': 'as quotations rather than instructions',
    'depthFilter-off': 'does not turn off memory storage',
    'depthFilter-shadow': 'A live filtering mode is not built',
  };
  for (const [mode, meaning] of Object.entries(meanings)) {
    await browserExpect(page.getByTestId(`copy-${mode}`)).toContainText(meaning);
  }
  await browserExpect(page.getByTestId('copy-depthFilter-shadow').getByRole('button', { name: 'LIVE', exact: true })).toHaveCount(0);
  const sizes = await page.locator('.rec-note, .rec-meta, .rec-line, .rec-med-badge, .rec-btn').evaluateAll(
    (nodes) => nodes.map((node) => Number.parseFloat(globalThis.getComputedStyle(node).fontSize)),
  );
  expect(sizes.length).toBeGreaterThan(10);
  expect(sizes.every((size) => size >= 14), JSON.stringify(sizes)).toBe(true);
  await page.screenshot({ path: '/tmp/neuma-inner-life-readable.png', fullPage: true });
  expect(errors).toEqual([]);
  await page.close();
}, 30000);
