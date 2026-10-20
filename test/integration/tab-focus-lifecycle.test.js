/* global window */
// Real React registration effects, transfer and persisted tab hook; no portal/inference claim.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, URL } from 'node:url';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { expect, test } from 'vitest';

test('tab changes preserve the active stream through effect cleanup and unmount', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-tab-focus-'));
  let vite; let server; let browser;
  try {
    vite = await createServer({ configFile: false,
      root: fileURLToPath(new URL('../..', import.meta.url)), cacheDir: path.join(root, 'cache'),
      appType: 'custom', esbuild: { jsx: 'automatic' },
      optimizeDeps: { entries: ['test/fixtures/tab-focus-lifecycle.jsx'], include: ['react', 'react-dom/client', 'react/jsx-runtime'] },
      server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null },
    });
    server = http.createServer((req, res) => {
      if (req.url === '/') {
        res.setHeader('Content-Type', 'text/html');
        res.end('<!doctype html><div id="root"></div><script type="module" src="/test/fixtures/tab-focus-lifecycle.jsx"></script>');
      } else vite.middlewares(req, res);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const folder = (value) => page.waitForFunction((expected) =>
      globalThis.document.querySelector('#folder')?.textContent === expected, value);
    await page.getByRole('button', { name: 'Select a', exact: true }).click();
    await folder('/tmp/a');
    await page.getByRole('button', { name: 'Select b', exact: true }).click();
    await folder('/tmp/b');
    await page.getByRole('button', { name: 'Select c', exact: true }).click();
    await folder('/tmp/c');
    await page.getByRole('button', { name: 'Select empty', exact: true }).click();
    await folder('CHOOSE A FOLDER');
    await page.getByRole('button', { name: 'Select b', exact: true }).click();
    await folder('/tmp/b');
    await page.getByRole('button', { name: 'Toggle second stream' }).click();
    await folder('/tmp/a');
    await page.getByRole('button', { name: 'Toggle second stream' }).click();
    await page.getByRole('button', { name: 'Select c', exact: true }).click();
    await folder('/tmp/c');
    const readStrip = async (id) => JSON.parse(await page.locator(`[data-strip="${id}"]`).textContent());
    const original = (await readStrip('chat#2')).find(tab => tab.id === 'c');
    expect(await page.evaluate(() => window.transferTab('chat#2', 'chat', 'c', 0))).toEqual({ ok: true });
    await page.waitForFunction(() => window.readSavedTabs('chat').tabs[0]?.id === 'c'
      && !window.readSavedTabs('chat#2').tabs.some(tab => tab.id === 'c'));
    expect((await readStrip('chat'))[0]).toEqual(original);
    expect((await readStrip('chat#2')).map(tab => tab.id)).toEqual(['b', 'empty']);
    await page.reload();
    await page.getByRole('button', { name: 'Select c', exact: true }).click();
    await folder('/tmp/c');
    expect((await readStrip('chat'))[0]).toEqual(original);
    expect((await readStrip('chat#2')).map(tab => tab.id)).toEqual(['b', 'empty']);
    await page.getByRole('button', { name: 'Toggle second stream' }).click();
    expect(await page.evaluate(() => window.transferTab('chat', 'chat#2', 'c'))).toMatchObject({ ok: false });
    expect((await readStrip('chat'))[0]).toEqual(original);
    await page.getByRole('button', { name: 'Toggle second stream' }).click();
    expect(await page.evaluate(() => window.transferTab('chat', 'chat#2', 'c', 0))).toEqual({ ok: true });
    await page.waitForFunction(() => window.readSavedTabs('chat#2').tabs[0]?.id === 'c');
    expect((await readStrip('chat#2'))[0]).toEqual(original);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await vite?.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30000);
