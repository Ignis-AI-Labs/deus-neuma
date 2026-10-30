// Real signed auth, production HTTP route/client, Git and Explorer row rendering.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import express from 'express';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { expect, test } from 'vitest';
import router from '../../backend/routes/user-files-routes.js';
import { getRoots, setRoots } from '../../backend/services/user-files.js';
import { fullAuth } from '../helpers/audit-auth.js';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';

test.skipIf(process.platform === 'win32')('quoted names carry their Git badges through the signed API into Explorer rows', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-git-badges-'));
  const repo = path.join(temp, 'repo');
  const priorRoots = getRoots();
  let vite, server, browser;
  const names = ['plain.txt', 'üñïçödé.txt', 'back\\slash.txt', 'quote"double.txt', 'newline\nin-name.txt', 'a -> b.txt'];
  try {
    await fs.mkdir(repo);
    execFileSync('git', ['-c', 'init.templateDir=', 'init', '-q', repo]);
    for (const name of names) await fs.writeFile(path.join(repo, name), name);
    await fs.writeFile(path.join(repo, '.gitignore'), '*.ignored\n');
    const ignored = 'quote" -> name.ignored';
    await fs.writeFile(path.join(repo, ignored), 'ignored');
    setRoots([repo]);
    const { token, address } = await fullAuth();
    // A fresh install's first owner is seated by the owner claim, never by a first request (owner-claim.js): seated here.
    await makeInstallOwner(address);
    vite = await createServer({ configFile: false,
      root: fileURLToPath(new URL('../..', import.meta.url)), cacheDir: path.join(temp, 'cache'),
      appType: 'custom', esbuild: { jsx: 'automatic' },
      optimizeDeps: { entries: ['test/fixtures/git-status-filenames.jsx'], include: ['react', 'react-dom/client', 'react/jsx-runtime'] },
      server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null },
    });
    const app = express();
    app.use('/api/v1/user/files', router);
    app.get('/', (_req, res) => res.type('html').send('<!doctype html><div id="root"></div><script type="module" src="/test/fixtures/git-status-filenames.jsx"></script>'));
    app.use(vite.middlewares);
    server = await new Promise(resolve => { const live = app.listen(0, '127.0.0.1', () => resolve(live)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const endpoint = `${base}/api/v1/user/files/git-status?path=${encodeURIComponent(repo)}`;
    expect((await globalThis.fetch(endpoint)).status).toBe(401);
    const response = await globalThis.fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    const status = await response.json();
    for (const name of names) expect(status.files[name]).toBe('U');
    expect(status.ignored).toContain(ignored);

    browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(value => globalThis.sessionStorage.setItem('authToken', value), token);
    await page.goto(`${base}/?folder=${encodeURIComponent(repo)}`);
    await page.waitForFunction(expected => globalThis.document.querySelectorAll('.files-rowwrap').length === expected, names.length + 2);
    const rows = await page.locator('.files-rowwrap').evaluateAll(elements => elements.map(element => ({
      name: element.querySelector('.files-name')?.textContent,
      badge: element.querySelector('.files-git')?.textContent ?? null,
      ignored: element.classList.contains('is-ignored'),
    })));
    for (const name of names) expect(rows.find(row => row.name === name)).toMatchObject({ badge: 'U', ignored: false });
    expect(rows.find(row => row.name === ignored)).toMatchObject({ badge: null, ignored: true });
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await vite?.close();
    setRoots(priorRoots);
    await fs.rm(temp, { recursive: true, force: true });
  }
}, 30000);
