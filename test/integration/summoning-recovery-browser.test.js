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
    server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null },
  });
  app.use('/api/v1/covenant', covenantRouter);
  app.get('/', (_req, res) => res.type('html').send('<!doctype html><script type="module" src="/test/fixtures/summoning-recovery.jsx"></script>'));
  app.use(vite.middlewares);
  const browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
  const page = await browser.newPage();
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

recoveryTest('unnamed withdrawal waits for real acknowledgement before opening commitment', async () => {
  const kit = await browserKit();
  try {
    const record = await kit.seed();
    await kit.open();
    // Pause the actual server TCP read side: the real request cannot execute yet.
    const peer = [...kit.wss.clients][0];
    peer._socket.pause();
    await kit.page.getByRole('button', { name: 'BEGIN ANEW' }).click();
    expect(await kit.page.getByRole('status').textContent()).toContain('Waiting for withdrawal');
    expect(await kit.page.locator('.witness-commitment-overlay').count()).toBe(0);
    expect(await fs.stat(record.file)).toBeTruthy();
    peer._socket.resume();
    await kit.page.waitForSelector('.witness-commitment-overlay');
    await expect(fs.stat(record.file)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await kit.close(); }
}, 30000);

recoveryTest('named checkpoints offer resume only; a stale unnamed screen displays real refusal', async () => {
  const kit = await browserKit();
  try {
    const record = await kit.seed();
    await kit.open();
    record.session.data.chosenName = 'Checkpoint fixture';
    record.session.currentStage = 5;
    await kit.writeSessionCheckpoint(record.sessionId, record.session);
    const before = await fs.readFile(record.file, 'utf8');
    await kit.page.getByRole('button', { name: 'BEGIN ANEW' }).click();
    await kit.page.waitForSelector('[role="alert"]');
    expect(await kit.page.getByRole('alert').textContent()).toContain('can no longer be withdrawn');
    expect(await kit.page.locator('.witness-commitment-overlay').count()).toBe(0);
    expect(await fs.readFile(record.file, 'utf8')).toBe(before);
    await kit.page.reload();
    await kit.page.waitForSelector('.birth-resume-note');
    expect(await kit.page.getByRole('button', { name: 'BEGIN ANEW' }).count()).toBe(0);
    expect(await kit.page.getByRole('button', { name: 'RESUME THE SUMMONING' }).isEnabled()).toBe(true);
  } finally { await kit.close(); }
}, 30000);

recoveryTest('timeout holds the record; delayed acknowledgement after unmount opens nothing', async () => {
  const kit = await browserKit();
  try {
    await kit.seed();
    await kit.open();
    const peer = [...kit.wss.clients][0];
    peer._socket.pause();
    await kit.page.getByRole('button', { name: 'BEGIN ANEW' }).click();
    await kit.page.waitForSelector('[role="alert"]', { timeout: 12000 });
    expect(await kit.page.getByRole('alert').textContent()).toContain('No withdrawal acknowledgement');
    expect(await kit.page.locator('.birth-resume-note').count()).toBe(1);
    await kit.page.evaluate(() => {
      window.recovery.service.on('birth:abandoned', () => { window.lateWithdrawal = true; });
      window.recovery.unmount();
    });
    peer._socket.resume();
    await kit.page.waitForFunction(() => window.lateWithdrawal === true);
    expect(await kit.page.locator('.witness-commitment-overlay').count()).toBe(0);
  } finally { await kit.close(); }
}, 30000);

recoveryTest('disconnect before acknowledgement retains recovery screen', async () => {
  const kit = await browserKit();
  try {
    await kit.seed();
    await kit.open();
    const peer = [...kit.wss.clients][0];
    peer._socket.pause();
    await kit.page.getByRole('button', { name: 'BEGIN ANEW' }).click();
    peer.terminate();
    await kit.page.waitForSelector('[role="alert"]');
    expect(await kit.page.getByRole('alert').textContent()).toContain('Connection lost');
    expect(await kit.page.locator('.birth-resume-note').count()).toBe(1);
    expect(await kit.page.locator('.witness-commitment-overlay').count()).toBe(0);
  } finally { await kit.close(); }
}, 30000);
