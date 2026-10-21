// Real event dispatcher, production ceremony listeners and actual browser DOM.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import express from 'express';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { expect, test } from 'vitest';

test('first-birth failure renders safely, returns to the portal and detaches on destroy', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-birth-notice-'));
  let vite, server, browser;
  try {
    const repo = fileURLToPath(new URL('../..', import.meta.url));
    vite = await createServer({ configFile: false, root: repo, cacheDir: path.join(temp, 'cache'),
      appType: 'custom', esbuild: { jsx: 'automatic' },
      resolve: { alias: { '/@kotodama': path.join(repo, 'core/kotodama') } },
      optimizeDeps: { entries: ['test/fixtures/birth-terminal-notice.js'] },
      server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null },
    });
    const app = express();
    app.get('/', (_req, res) => res.type('html').send('<!doctype html><script type="module" src="/test/fixtures/birth-terminal-notice.js"></script>'));
    app.use(vite.middlewares);
    server = await new Promise(resolve => { const live = app.listen(0, '127.0.0.1', () => resolve(live)); });
    browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => Boolean(window.terminalProof));
    const message = 'Authored DNA unavailable <img src=x onerror="window.noticeInjected=true">';
    await page.evaluate(message => window.terminalProof.emit({ error: 'missing_authored_genesis', message }), message);
    await page.waitForSelector('.ceremony-ended-screen', { timeout: 5000 });
    expect(await page.locator('.ended-content h1').textContent()).toBe('THE SUMMONING FALTERED');
    expect(await page.locator('.ended-content p').textContent()).toBe(message);
    expect(await page.locator('.ended-content img').count()).toBe(0);
    expect(await page.evaluate(() => window.noticeInjected)).toBeUndefined();
    await page.evaluate(() => window.terminalProof.emit({ error: 'workspace_seed_failed' }));
    expect(await page.locator('.ended-content p').textContent()).toBe('workspace_seed_failed');
    await page.locator('#close-ceremony').click();
    expect(await page.evaluate(() => window.terminalProof.returns)).toBe(1);
    expect(await page.evaluate(() => window.terminalProof.listeners)).toBe(1);
    await page.evaluate(() => { window.terminalProof.destroy(); window.terminalProof.destroy(); });
    expect(await page.locator('.birth-ceremony').count()).toBe(0);
    expect(await page.evaluate(() => window.terminalProof.listeners)).toBe(0);
    await page.evaluate(() => window.terminalProof.emit({ message: 'must not land after destroy' }));
    expect(await page.evaluate(() => window.terminalProof.detachedText)).not.toContain('must not land');
    expect(await page.evaluate(() => window.terminalProof.queuedCommands)).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await vite?.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
}, 30000);
