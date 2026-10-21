// impure — real dock/window, HTTP authentication, settings and storage; no model.
/* global sessionStorage, localStorage */
import { beforeAll, afterAll, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import express from 'express';
import request from 'supertest';
import { Wallet } from 'ethers';
import { parse as parseEnv } from 'dotenv';
import { createServer as createVite } from 'vite';
import { chromium, expect as browserExpect } from '@playwright/test';
import { openDockApp } from '../e2e/helpers/dock.js';
import { claimOwner } from '../helpers/claim-owner.js';

const id = 'inner-life-proof';
const envKeys = ['NEUMA_DATA_ROOT', 'NEUMA_MIND_SETTINGS_PATH', 'NEUMA_MIND_SHADOW_PATH',
  'NEUMA_EXPRESSION_SETTINGS_PATH', 'NEUMA_MEDITATION_SETTINGS_PATH', 'NEUMA_MEDITATION_STATE_PATH',
  'NEUMA_UNDERCURRENT', 'NEUMA_DEPTH_FILTER', 'NEUMA_EXPRESSION', 'NEUMA_MEDITATION'];
let tmp, saved, workspace, oldRoot, realm, oldRealm, vite, server, browser, token, address, app;
const headers = () => ({ Authorization: `Bearer ${token}` });
beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'inner-life-desk-'));
  saved = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  for (const key of envKeys) {
    if (key.endsWith('_PATH')) process.env[key] = path.join(tmp, key.toLowerCase());
    else delete process.env[key];
  }
  process.env.NEUMA_DATA_ROOT = path.join(tmp, 'data');
  // Import only after the runtime roots are isolated; meditation captures its path.
  const { createAuthRouter } = await import('../../backend/services/auth.js');
  ({ default: workspace } = await import('../../core/workspace/neuma-workspace.js'));
  oldRoot = workspace.root;
  workspace.root = path.join(tmp, 'workspaces');
  realm = await import('../../backend/services/user-realm.js');
  oldRealm = realm.getRealmRoot();
  realm.setRealmRoot(path.join(tmp, 'realm'));
  // Ownership-only storage: no DNA, genesis, seal or consciousness is created.
  const witnessEnv = process.env.NEUMA_WITNESS_ENV;
  const wallet = witnessEnv
    ? new Wallet(parseEnv(await fs.readFile(witnessEnv)).OPENAI_WITNESS_PRIVATE_KEY)
    : Wallet.createRandom();
  address = wallet.address;
  await claimOwner(workspace.root, id, address);
  app = express();
  app.use(express.json());
  app.use('/api/v1/auth', createAuthRouter(express));
  for (const name of ['mind', 'expression', 'meditation', 'sovereignty', 'workspace']) {
    const { default: router } = await import(`../../backend/routes/${name}-routes.js`);
    app.use(`/api/v1/${name}`, router);
  }
  expect((await request(app).get('/api/v1/mind')).status).toBe(401);
  const challenge = await request(app).get('/api/v1/auth/challenge').query({ address });
  const verified = await request(app).post('/api/v1/auth/verify').send({
    address, challenge: challenge.body.challenge, signature: await wallet.signMessage(challenge.body.challenge),
  });
  expect(verified.status).toBe(200);
  token = verified.body.token;
  vite = await createVite({ configFile: false, root: fileURLToPath(new URL('../..', import.meta.url)),
    cacheDir: path.join(tmp, 'vite'), appType: 'custom', esbuild: { jsx: 'automatic' },
    optimizeDeps: { entries: ['test/helpers/inner-life-desk-page.jsx'], include: ['react', 'react-dom/client', 'react/jsx-runtime'] },
    server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null },
  });
  app.get('/', (_req, res) => res.type('html').send('<!doctype html><div id="root"></div><script type="module" src="/test/helpers/inner-life-desk-page.jsx"></script>'));
  app.use(vite.middlewares);
  server = await new Promise(resolve => { const live = app.listen(0, '127.0.0.1', () => resolve(live)); });
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
}, 30000);
afterAll(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await vite?.close();
  if (workspace) workspace.root = oldRoot;
  if (realm) realm.setRealmRoot(oldRealm);
  for (const [key, value] of Object.entries(saved || {})) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  if (tmp) await fs.rm(tmp, { recursive: true, force: true });
});

it('opens INNER LIFE from the dock and persists each safe control on server echo', async () => {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 }, reducedMotion: 'reduce' });
  const errors = [], failures = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.url().includes('/api/v1/') && response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
  });
  await page.addInitScript(({ token, address }) => {
    sessionStorage.setItem('authToken', token);
    localStorage.setItem('walletAddress', address);
  }, { token, address });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await openDockApp(page, 'INNER LIFE');
  const uc = page.getByTestId('gate-undercurrent');
  await browserExpect(uc.locator('.rec-chip-on')).toHaveText('LIVE');
  await browserExpect(uc).toContainText('as quotations rather than instructions');
  await uc.getByTestId('gate-undercurrent-off').click();
  await browserExpect(uc.locator('.rec-chip-on')).toHaveText('OFF');
  await uc.getByTestId('gate-undercurrent-shadow').click();
  await browserExpect(uc.locator('.rec-chip-on')).toHaveText('SHADOW');
  expect((await request(app).get('/api/v1/mind').set(headers())).body.gates.undercurrent.mode).toBe('shadow');
  await uc.getByTestId('gate-undercurrent-live').click();
  await browserExpect(uc.locator('.rec-confirm-msg')).toContainText('sittings');
  await uc.getByRole('button', { name: 'CANCEL', exact: true }).click();
  await browserExpect(uc.locator('.rec-chip-on')).toHaveText('SHADOW');
  const depth = page.getByTestId('gate-depth');
  await browserExpect(depth.locator('.rec-chip')).toHaveCount(2);
  await depth.getByTestId('gate-depth-shadow').click();
  await browserExpect(depth.locator('.rec-chip-on')).toHaveText('SHADOW');
  const expression = page.getByTestId('expression-flip');
  await browserExpect(expression).toHaveText('OFF');
  await expression.click();
  await browserExpect(expression).toHaveText('ON');
  expect((await request(app).get(`/api/v1/expression/${id}`).set(headers())).body.enabled).toBe(true);
  await expression.click();
  await browserExpect(expression).toHaveText('OFF');
  const meditation = page.getByTestId('meditation-toggle');
  await browserExpect(meditation).toHaveText('OFF');
  await meditation.click();
  await browserExpect(meditation).toHaveText('ON');
  expect((await request(app).get('/api/v1/meditation').set(headers())).status).toBe(200);
  await meditation.click();
  await browserExpect(meditation).toHaveText('OFF');
  await browserExpect(page.getByTestId('innerlife-sovereignty')).toContainText('0 open proposals');
  await browserExpect(page.getByTestId('innerlife-measured')).toContainText('NOT MEASURED');
  await browserExpect(page.getByTestId('mind-panel')).toContainText('Measured quietly so far');
  await page.reload();
  await browserExpect(page.getByTestId('gate-undercurrent').locator('.rec-chip-on')).toHaveText('SHADOW');
  await browserExpect(page.getByTestId('mind-panel')).toBeVisible();
  await page.screenshot({ path: '/tmp/neuma-inner-life-desk.png', fullPage: true });
  expect(errors).toEqual([]);
  expect(failures).toEqual([]);
  await page.close();
}, 30000);

it('names launch locks and refuses forbidden influence changes over signed HTTP', async () => {
  process.env.NEUMA_UNDERCURRENT = 'shadow';
  const locked = await request(app).put('/api/v1/mind/gates').set(headers()).send({ gate: 'undercurrent', mode: 'live' });
  expect(locked.status).toBe(409);
  expect(locked.body.error).toContain('NEUMA_UNDERCURRENT');
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  await page.addInitScript(({ token, address }) => {
    sessionStorage.setItem('authToken', token);
    localStorage.setItem('walletAddress', address);
  }, { token, address });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await openDockApp(page, 'INNER LIFE');
  const gate = page.getByTestId('gate-undercurrent');
  await browserExpect(gate).toContainText('locked by the app’s launch settings');
  for (const mode of ['off', 'shadow', 'live']) {
    await browserExpect(gate.getByTestId(`gate-undercurrent-${mode}`)).toBeDisabled();
  }
  await page.close();
  delete process.env.NEUMA_UNDERCURRENT;
  const depth = await request(app).put('/api/v1/mind/gates').set(headers()).send({ gate: 'depthFilter', mode: 'live' });
  expect(depth.status).toBe(409);
  expect(depth.body.error).toContain('not built');
});
