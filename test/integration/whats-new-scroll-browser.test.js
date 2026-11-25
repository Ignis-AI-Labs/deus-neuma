/* global window, document */
// WHAT'S NEW scrolls (deus-neuma #37: long notes were cut off and CLOSE was out of view, nothing
// scrolled). The real panel and its real styles, built by vite, in a real Chromium at the
// reporter's window height (713 px): the panel stays inside the window, the notes body scrolls to
// its last line, the title and CLOSE stay in view, and CLOSE closes.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { chromium, expect as pw } from '@playwright/test';
import { test, expect, beforeAll, afterAll } from 'vitest';

let root; let server; let browser; let origin;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'whats-new-'));
  const { build } = await import('vite');
  const bundle = await build({ configFile: false, root: process.cwd(), logLevel: 'error',
    esbuild: { jsx: 'automatic' },
    build: { write: false, outDir: path.join(root, 'bundle'),
      rollupOptions: { input: path.resolve('test/fixtures/whats-new-panel.jsx') } } });
  const app = express();
  for (const file of bundle.output) {
    app.get(`/${file.fileName}`, (_req, res) => res.type(path.extname(file.fileName)).send(file.type === 'chunk' ? file.code : file.source));
  }
  const entry = bundle.output.find((file) => file.type === 'chunk' && file.isEntry).fileName;
  const styles = bundle.output.filter((file) => file.fileName.endsWith('.css')).map((file) => `<link rel="stylesheet" href="/${file.fileName}">`).join('');
  app.get('/', (_req, res) => res.type('html').send(`${styles}<div id="root"></div><script type="module" src="/${entry}"></script>`));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ args: ['--disable-gpu'] });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  server?.closeAllConnections();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  if (root) await fs.rm(root, { recursive: true, force: true });
});

test('long notes scroll inside the panel; the title and CLOSE stay in view at 713 px', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 713 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  await page.waitForFunction(() => window.panelReady);

  const box = (sel) => page.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, height: r.height };
  }, sel);
  const panel = await box('.update-notes');
  const inner = await box('.update-notes-in');
  expect(panel.bottom).toBeLessThanOrEqual(713);
  // the inner frame is the panel's height, not its content's (it was 3084 px inside a 651 px panel)
  expect(Math.abs(inner.height - panel.height)).toBeLessThan(4);

  const body = page.locator('.update-notes-body');
  const sizes = await body.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
  expect(sizes.scroll).toBeGreaterThan(sizes.client);
  const close = page.getByRole('button', { name: 'CLOSE' });
  await pw(close).toBeInViewport({ ratio: 1 });
  await pw(page.locator('.update-notes-title')).toBeInViewport({ ratio: 1 });

  // the wheel reaches the last line, and the title and CLOSE never leave
  await body.hover();
  for (let i = 0; i < 20; i += 1) await page.mouse.wheel(0, 400);
  await pw(page.getByText('THE LAST LINE OF THE NOTES.')).toBeInViewport();
  await pw(close).toBeInViewport({ ratio: 1 });
  await pw(page.locator('.update-notes-title')).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: path.join(os.tmpdir(), 'whats-new-713.png') });

  await close.click();
  expect(await page.evaluate(() => window.closeCount)).toBe(1);
  expect(errors).toEqual([]);
  await page.close();
}, 60_000);
