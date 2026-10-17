// Real browser, HTTP, signed auth, ownership and inference views. The engine is
// offline: metadata supplies Gemma's ladder. This does not test model inference.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import express from 'express';
import { createServer } from 'vite';
import { chromium, expect as browserExpect } from '@playwright/test';
import { expect, test } from 'vitest';
import { mountRecoveryRoutes } from '../helpers/model-bar-recovery-kit.js';

test('model and effort reads recover from a real network outage and refuse another chat', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-bar-recovery-'));
  let vite; let server; let browser; let restore;
  try {
    const app = express();
    app.use(express.json());
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const setup = await mountRecoveryRoutes(app, root, url);
    restore = setup.restore;
    vite = await createServer({ configFile: false,
      root: fileURLToPath(new URL('../..', import.meta.url)), cacheDir: path.join(root, 'cache'),
      appType: 'custom', esbuild: { jsx: 'automatic' },
      // One React in the bundle: without dedupe the fixture's components and
      // the pre-bundled optimizeDeps copies resolve to two module instances,
      // and the page dies pre-mount ([…]) — the bar never renders, every locator reads absent.
      resolve: { dedupe: ['react', 'react-dom'] },
      optimizeDeps: { entries: ['test/fixtures/model-bar-read-recovery.jsx'], include: ['react', 'react-dom/client', 'react/jsx-runtime'] },
      server: { middlewareMode: true, hmr: false, watch: null },
    });
    app.get('/', (_req, res) => res.type('html').send('<!doctype html><div id="root"></div><script type="module" src="/test/fixtures/model-bar-read-recovery.jsx"></script>'));
    // The app genuinely has no engine endpoints. Its ordinary 404 is the
    // offline think probe; no substitute ever emits a model response.
    app.use(vite.middlewares);
    browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
    const context = await browser.newContext();
    await context.addInitScript((token) => globalThis.sessionStorage.setItem('authToken', token), setup.token);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url);
    const group = page.getByRole('group', { name: 'Model and effort' });
    const model = group.getByRole('button', { name: 'Model', exact: true });
    const effort = group.getByRole('button', { name: 'Effort', exact: true });
    await browserExpect(model).toBeEnabled();
    const initialEffort = await page.evaluate(async () => (await globalThis.fetch('/api/v1/inference/model-bar-proof/effort', {
      headers: { Authorization: `Bearer ${globalThis.sessionStorage.getItem('authToken')}` },
    })).json());
    expect(initialEffort.capability?.tiers?.length, JSON.stringify(initialEffort)).toBeGreaterThan(0);
    await browserExpect(effort).toBeEnabled();
    await effort.click();
    await page.getByRole('option', { name: 'HIGH', exact: true }).click();
    await browserExpect(effort).toHaveText(/HIGH/);
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Other chat' }).click();
    await browserExpect(group.getByRole('button', { name: 'Retry model settings' })).toBeVisible();
    await browserExpect(model).toBeDisabled();
    await browserExpect(effort).toBeDisabled();
    await browserExpect(group).not.toContainText('NO EFFORT TIERS');
    await browserExpect(group).not.toContainText('gemma-4-offline');
    await page.getByRole('button', { name: 'Original chat' }).click();
    await browserExpect(group.getByRole('button', { name: 'Retry model settings' })).toBeVisible();
    // Retry really travels through the client again while the network is down.
    let reads = 0;
    page.on('request', (request) => { if (request.url().includes('/api/v1/inference/')) reads += 1; });
    await group.getByRole('button', { name: 'Retry model settings' }).click();
    await page.waitForFunction(() => globalThis.document.querySelector('[aria-label="Retry model settings"]'));
    await browserExpect.poll(() => reads).toBeGreaterThanOrEqual(2);
    await context.setOffline(false);
    await group.getByRole('button', { name: 'Retry model settings' }).click();
    await browserExpect(model).toBeEnabled();
    await browserExpect(effort).toBeEnabled();
    await browserExpect(effort).toHaveText(/HIGH/);
    await browserExpect(group.getByRole('button', { name: 'Retry model settings' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Other chat' }).click();
    await browserExpect(group).toContainText(/owner|owned|workspace/i);
    await browserExpect(model).toBeDisabled();
    await page.getByRole('button', { name: 'Original chat' }).click();
    await browserExpect(model).toBeEnabled();
    await browserExpect(effort).toBeEnabled();
    await browserExpect(effort).toHaveText(/HIGH/);
    await browserExpect(group.getByRole('button', { name: 'Retry model settings' })).toHaveCount(0);
    process.env.SUBSTRATE_MODEL = 'offline-without-reasoning-metadata';
    await page.evaluate(() => globalThis.window.dispatchEvent(new globalThis.CustomEvent('neuma:substrate-change', { detail: { kind: 'change' } })));
    await browserExpect(group).toContainText('NO EFFORT TIERS');
    await browserExpect(model).toBeEnabled();
    await browserExpect(effort).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await vite?.close();
    restore?.();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 60000);
