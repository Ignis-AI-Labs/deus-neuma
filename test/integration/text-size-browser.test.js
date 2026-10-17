// Real Chromium, native controls/storage, xterm, CodeMirror and signed LOOK API.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { expect, test } from 'vitest';
import { fullAuth } from '../helpers/audit-auth.js';
import { textScaleCss } from '../../scripts/text-scale-css.mjs';

test('LOOK scales fixed, token, inherited, editor and terminal text; persists, syncs and resets', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-text-size-'));
  const previous = process.env.NEUMA_LOOK_SETTINGS_PATH;
  process.env.NEUMA_LOOK_SETTINGS_PATH = path.join(root, 'look.json');
  let vite; let server; let browser;
  try {
    const auth = await fullAuth();
    const app = express();
    app.use(express.json());
    app.use('/api/v1/look', (await import('../../backend/routes/look-routes.js')).default);
    vite = await createServer({ configFile: false,
      root: fileURLToPath(new URL('../..', import.meta.url)), cacheDir: path.join(root, 'cache'),
      appType: 'custom', esbuild: { jsx: 'automatic' },
      css: { postcss: { plugins: [textScaleCss()] } },
      optimizeDeps: { entries: ['test/fixtures/text-size.jsx'] },
      server: { middlewareMode: true, hmr: false, watch: null },
    });
    app.get('/', (_req, res) => res.type('html').send('<!doctype html><div id="root"></div><script type="module" src="/test/fixtures/text-size.jsx"></script>'));
    app.use(vite.middlewares);
    server = http.createServer(app);
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
    const context = await browser.newContext({ viewport: { width: 1000, height: 900 } });
    await context.addInitScript((token) => sessionStorage.setItem('authToken', token), auth.token);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const url = `http://127.0.0.1:${server.address().port}/`;
    await page.goto(url);
    await page.locator('#terminal[data-font-size="13"]').waitFor();
    const selectors = ['#fixed', '#fixed span', '#relative', '#relative em', '.cm-content', '.settings-look-hex'];
    const sizes = () => page.evaluate((items) => items.map((selector) =>
      parseFloat(getComputedStyle(document.querySelector(selector)).fontSize)), selectors);
    const initial = await sizes();
    const columns = Number(await page.locator('#terminal').getAttribute('data-cols'));
    const slider = page.getByRole('slider', { name: 'TEXT SIZE' });
    await slider.focus();
    await page.keyboard.press('End');
    expect(await slider.inputValue()).toBe('200');
    expect(await sizes()).toEqual(initial.map((size) => size * 2));
    expect(await page.locator('#terminal').getAttribute('data-font-size')).toBe('26');
    expect(Number(await page.locator('#terminal').getAttribute('data-cols'))).toBeLessThan(columns);
    await page.getByRole('button', { name: 'Ember', exact: false }).first().click();
    expect(await slider.inputValue()).toBe('200');
    await page.reload();
    await page.getByRole('slider').waitFor();
    expect(await slider.inputValue()).toBe('200');
    expect(await sizes()).toEqual(initial.map((size) => size * 2));
    const peer = await context.newPage();
    await peer.goto(url);
    await peer.getByRole('slider').waitFor();
    await slider.focus();
    await page.keyboard.press('ArrowLeft');
    await peer.waitForFunction(() => document.querySelector('input[type=range]')?.value === '195');
    await page.setViewportSize({ width: 420, height: 900 });
    const control = page.locator('.text-size-control');
    expect(await control.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await control.screenshot({ path: '/tmp/neuma-text-size-narrow.png' });
    await page.getByRole('button', { name: 'RESET TEXT SIZE' }).click();
    expect(await sizes()).toEqual(initial);
    await peer.waitForFunction(() => document.querySelector('input[type=range]')?.value === '100');
    // Invalid saved values never make the UI unreadably small or enormous.
    await page.evaluate(() => localStorage.setItem('neuma-text-size', '900'));
    await page.reload();
    await page.getByRole('slider').waitFor();
    expect(await slider.inputValue()).toBe('100');
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await vite?.close();
    if (previous === undefined) delete process.env.NEUMA_LOOK_SETTINGS_PATH;
    else process.env.NEUMA_LOOK_SETTINGS_PATH = previous;
    await fs.rm(root, { recursive: true, force: true });
  }
}, 60000);
