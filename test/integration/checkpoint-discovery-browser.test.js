/* global process, URL, sessionStorage, window */
// Real React host, WebSocketService, signed portal and filesystem. No model.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { expect, test } from 'vitest';
import { recoveryKit } from '../helpers/summoning-recovery-kit.js';

// Supply this session's own sealed witness env; CI must never borrow a wallet.
const recoveryTest = test.skipIf(!process.env.NEUMA_WITNESS_ENV);
import covenantRouter from '../../backend/routes/covenant-routes.js';

const browserKit = async () => {
  const app = express();
  const kit = await recoveryKit(app);
  const repo = fileURLToPath(new URL('../..', import.meta.url));
  const vite = await createServer({ configFile: false, root: repo, cacheDir: path.join(kit.root, 'cache-vite'),
    appType: 'custom', esbuild: { jsx: 'automatic' },
    resolve: { alias: { '/@kotodama': path.join(repo, 'core/kotodama') } },
    optimizeDeps: { entries: ['test/fixtures/summoning-recovery.jsx'] },
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  app.use('/api/v1/covenant', covenantRouter);
  app.get('/', (_req, res) => res.type('html').send('<!doctype html><script type="module" src="/test/fixtures/summoning-recovery.jsx"></script>'));
  app.use(vite.middlewares);
  const browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
  const page = await browser.newPage();
  page.setDefaultTimeout(8000);
  await page.addInitScript(token => sessionStorage.setItem('authToken', token), kit.token);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const open = async () => {
    await page.goto(kit.url);
    await page.waitForSelector('.birth-resume-note');
  };
  const close = async () => {
    await browser.close();
    await vite.close();
    await kit.close();
    expect(errors).toEqual([]);
  };
  return { ...kit, page, open, close };
};

recoveryTest('silent discovery holds the door, retries a real checkpoint, and detaches after unmount', async () => {
  const kit = await browserKit();
  try {
    const record = await kit.seed('Checkpoint fixture');
    const before = await fs.readFile(record.file, 'utf8');
    kit.wss.on('connection', peer => peer._socket.pause());
    await kit.page.goto(kit.url);
    await kit.page.getByRole('button', { name: 'RETRY DISCOVERY' }).waitFor({ timeout: 8000 });
    expect(await kit.page.locator('.witness-commitment-overlay').count()).toBe(0);
    const peer = [...kit.wss.clients][0];
    await kit.page.getByRole('button', { name: 'RETRY DISCOVERY' }).click();
    peer._socket.resume();
    await kit.page.getByRole('button', { name: 'RESUME THE SUMMONING' }).waitFor();
    expect(await fs.readFile(record.file, 'utf8')).toBe(before);
    await kit.page.evaluate(() => window.recovery.unmount());
    expect(await kit.page.locator('.birth-resume-note').count()).toBe(0);
    expect(await kit.page.locator('.witness-commitment-overlay').count()).toBe(0);
  } finally { await kit.close(); }
}, 30000);

recoveryTest('a real checkpoint-directory failure is an error; retry finds the record; only an empty scan opens commitment', async () => {
  const kit = await browserKit();
  try {
    const record = await kit.seed('Checkpoint fixture');
    const dir = path.dirname(record.file);
    const held = dir + '-held';
    await fs.rename(dir, held);
    await fs.writeFile(dir, 'directory unavailable');
    await kit.page.goto(kit.url);
    await kit.page.getByRole('button', { name: 'RETRY DISCOVERY' }).waitFor();
    expect(await kit.page.getByRole('alert').textContent()).toContain('Checkpoint discovery failed');
    expect(await kit.page.locator('.witness-commitment-overlay').count()).toBe(0);
    await fs.unlink(dir);
    await fs.rename(held, dir);
    await kit.page.getByRole('button', { name: 'RETRY DISCOVERY' }).click();
    await kit.page.getByRole('button', { name: 'RESUME THE SUMMONING' }).waitFor();
    await fs.unlink(record.file);
    await kit.page.reload();
    await kit.page.waitForSelector('.witness-commitment-overlay');
  } finally { await kit.close(); }
}, 30000);

recoveryTest('unmount during discovery detaches its listener and a late empty reply opens nothing', async () => {
  const kit = await browserKit();
  try {
    kit.wss.on('connection', peer => peer._socket.pause());
    await kit.page.goto(kit.url);
    await kit.page.getByRole('status').waitFor();
    await kit.page.waitForFunction(() => window.recovery.service.isConnected);
    expect(await kit.page.evaluate(() => window.recovery.service.listeners.get('birth:interrupted')?.length)).toBe(1);
    await kit.page.evaluate(() => window.recovery.unmount());
    expect(await kit.page.evaluate(() => window.recovery.service.listeners.get('birth:interrupted')?.length || 0)).toBe(0);
    await kit.page.evaluate(() => window.recovery.service.on('birth:interrupted', () => { window.lateDiscovery = true; }));
    [...kit.wss.clients][0]._socket.resume();
    await kit.page.waitForFunction(() => window.lateDiscovery === true);
    await kit.page.waitForTimeout(4200);
    expect(await kit.page.locator('.birth-resume-note, .witness-commitment-overlay').count()).toBe(0);
  } finally { await kit.close(); }
}, 30000);
