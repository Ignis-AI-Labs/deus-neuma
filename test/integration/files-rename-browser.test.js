// Real FilesApp, signed auth, production HTTP client/router and temporary disk.
import fs from 'node:fs/promises';
import process from 'node:process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import express from 'express';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { expect, test } from 'vitest';
import router from '../../backend/routes/user-files-routes.js';
import { getRoots, setRoots } from '../../backend/services/user-files.js';
import { fullAuth } from '../helpers/audit-auth.js';

test.skipIf(process.platform === 'win32')('FilesApp preserves exact rename input through signed HTTP and the filesystem', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-rename-'));
  const repo = path.join(temp, 'repo');
  const priorRoots = getRoots();
  let vite, server, browser;
  let renameRequests = 0;
  try {
    await fs.mkdir(repo);
    await fs.writeFile(path.join(repo, ' leading-space.txt'), 'contents');
    await fs.mkdir(path.join(repo, 'dir with trailing space '));
    setRoots([repo]);
    const { token } = await fullAuth();
    vite = await createServer({ configFile: false,
      root: fileURLToPath(new URL('../..', import.meta.url)), cacheDir: path.join(temp, 'cache'),
      appType: 'custom', esbuild: { jsx: 'automatic' },
      optimizeDeps: { entries: ['test/fixtures/files-rename.jsx'], include: ['react', 'react-dom/client', 'react/jsx-runtime'] },
      server: { middlewareMode: true, hmr: false, watch: null },
    });
    const app = express();
    app.use(express.json());
    app.use('/api/v1/user/files/rename', (_req, _res, next) => { renameRequests += 1; next(); });
    app.use('/api/v1/user/files', router);
    app.get('/', (_req, res) => res.type('html').send('<!doctype html><div id="root"></div><script type="module" src="/test/fixtures/files-rename.jsx"></script>'));
    app.use(vite.middlewares);
    server = await new Promise(resolve => { const live = app.listen(0, '127.0.0.1', () => resolve(live)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    expect((await globalThis.fetch(`${base}/api/v1/user/files/roots`)).status).toBe(401);
    browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(value => globalThis.sessionStorage.setItem('authToken', value), token);
    await page.goto(`${base}/?folder=${encodeURIComponent(repo)}`);
    const row = name => page.locator('.files-rowwrap').filter({ has: page.locator(`button.files-row[title=${JSON.stringify(path.join(repo, name))}]`) });
    const openRename = async name => {
      await row(name).getByRole('button', { name: 'Rename', exact: true }).click();
      expect(await page.locator('.files-prompt-input').inputValue()).toBe(name);
    };
    const submit = async () => {
      await page.locator('.files-prompt-go').click();
      await page.locator('.files-prompt-input').waitFor({ state: 'detached' });
    };
    for (const name of [' leading-space.txt', 'dir with trailing space ']) {
      await openRename(name);
      await submit();
      expect((await fs.readdir(repo)).includes(name)).toBe(true);
    }
    expect(renameRequests).toBe(0);
    let current = ' leading-space.txt';
    for (const next of [' leading-space-2.txt', 'plain.txt', 'trailing space .txt', 'trailing.txt ']) {
      await openRename(current);
      await page.locator('.files-prompt-input').fill(next);
      await submit();
      expect(await fs.readFile(path.join(repo, next), 'utf8')).toBe('contents');
      current = next;
    }
    expect(renameRequests).toBe(4);
    await openRename(current);
    for (const invalid of ['', '   ']) {
      await page.locator('.files-prompt-input').fill(invalid);
      await page.locator('.files-prompt-go').click();
      expect(await page.locator('.files-prompt-input').count()).toBe(1);
      expect(renameRequests).toBe(4);
      expect(await fs.readFile(path.join(repo, current), 'utf8')).toBe('contents');
    }
    await page.locator('.files-prompt-input').press('Escape');
    await row('').getByRole('button', { name: 'New file', exact: true }).click();
    await page.locator('.files-prompt-input').fill('  spaced  ');
    await submit();
    expect(await fs.readFile(path.join(repo, 'spaced'), 'utf8')).toBe('');
    const refused = await globalThis.fetch(`${base}/api/v1/user/files/rename`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: path.join(repo, current), to: path.join(repo, '   ') }),
    });
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toContain('whitespace-only');
    expect(await fs.readFile(path.join(repo, current), 'utf8')).toBe('contents');
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await vite?.close();
    setRoots(priorRoots);
    await fs.rm(temp, { recursive: true, force: true });
  }
}, 30000);
