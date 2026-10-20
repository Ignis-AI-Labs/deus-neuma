/* global document, sessionStorage, localStorage */
// Real Chromium, signed auth, production routers, and isolated encrypted stores.
// No model inference, network substitution, or benchmark/meditation act is run.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { setTimeout } from 'node:timers';
import express from 'express';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { expect, test } from 'vitest';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { fullAuth, writeOwner } from '../helpers/audit-auth.js';
import { openDockApp, openLauncher } from '../e2e/helpers/dock.js';

test('Record preserves neuma views and lane switching while neuma-only windows refuse witnesses', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-record-browser-'));
  const oldRoot = getWorkspacesRoot();
  const oldEnv = Object.fromEntries(['NEUMA_DATA_ROOT', 'LLAMA_SERVER_URL'].map((key) => [key, process.env[key]]));
  let vite; let server; let browser; let release;
  try {
    process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
    process.env.LLAMA_SERVER_URL = 'http://127.0.0.1:1';
    setWorkspacesRoot(path.join(root, 'lanes'));
    const { setConfig } = await import('../../backend/services/llm-selection.js');
    setConfig({ provider: 'lm-studio', endpoint: 'http://127.0.0.1:1', model: 'unavailable-test-model' });
    const auth = await fullAuth();
    for (const [id, name] of [['record-a', 'Record Alpha'], ['record-b', 'Record Beta']]) {
      await workspace.create(id);
      await writeOwner(workspace.root, id, auth.address);
      await workspace.writeNeumaDEK(id, (id === 'record-a' ? 'a' : 'b').repeat(64));
      await workspace.writeDNA(id, { identity: { name, essence: `${name} private identity` } });
      await workspace.appendMessage(id, 'session-record', { role: 'user', content: `${name} history` });
    }
    const app = express();
    const requests = [];
    let pauseBeta = true;
    app.use(async (req, _res, next) => {
      requests.push(`${req.method} ${req.path}`);
      if (pauseBeta && req.path === '/api/v1/workspace/record-b/stats') {
        pauseBeta = false;
        await new Promise((resolve) => { release = resolve; });
      }
      next();
    });
    for (const [prefix, file] of [
      ['workspace', 'workspace-routes'], ['attunement', 'attunement-routes'],
      ['residency', 'residency-routes'], ['meditation', 'meditation-routes'], ['substrate', 'substrate-routes'],
    ]) app.use(`/api/v1/${prefix}`, (await import(`../../backend/routes/${file}.js`)).default);
    vite = await createServer({ configFile: false,
      root: fileURLToPath(new URL('../..', import.meta.url)), cacheDir: path.join(root, 'cache'),
      appType: 'custom', esbuild: { jsx: 'automatic' },
      optimizeDeps: { entries: ['test/fixtures/record-sheet.jsx'], include: ['react', 'react-dom/client', 'react/jsx-runtime'] },
      server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null },
    });
    app.get('/', (_req, res) => res.type('html').send('<!doctype html><body style="margin:0;background:#020b0e;color:#bbced2"><div id="root"></div><script type="module" src="/test/fixtures/record-sheet.jsx"></script>'));
    app.use(vite.middlewares);
    server = http.createServer(app);
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(({ token, address }) => {
      sessionStorage.setItem('authToken', token);
      localStorage.setItem('walletAddress', address);
    }, { token: auth.token, address: auth.address });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => document.querySelector('.sheet-id-name')?.textContent === 'Record Alpha');
    expect(await page.locator('#window-ids').textContent()).toBe('sheet');
    expect(await page.getByRole('heading', { name: 'IDENTITY', exact: true }).count()).toBe(1); // the dossier's cover plate
    expect(await page.locator('.dos-plate').count()).toBe(1); // the aura's plate, where a file keeps its photograph
    // Each tab is its own page (Design note, 2026-09-26: a section is reached by its
    // tab, and the operator's live panels ride the tab they belong to.
    await page.getByRole('tab', { name: /STATE/ }).click();
    expect(await page.getByRole('heading', { name: 'STATE — MEASURED FUNCTIONING', exact: true }).count()).toBe(1);
    await page.getByRole('tab', { name: /SUBSTRATE/ }).click();
    expect(await page.getByRole('heading', { name: 'RESIDENCY', exact: true }).count()).toBe(1);
    await page.getByRole('tab', { name: /MIND/ }).click();
    expect(await page.getByTestId('meditation-panel').count()).toBe(1);
    await openLauncher(page);
    expect(await page.locator('.launcher-tile[title="RECORD"]').count()).toBe(1);
    expect(await page.locator('.launcher-tile[title="SHEET"]').count()).toBe(0);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Switch to Beta', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.sheet')?.textContent.includes('LOADING'));
    expect(await page.locator('.sheet').textContent()).not.toContain('Record Alpha');
    const deadline = Date.now() + 5000;
    while (!release && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(release).toBeTypeOf('function');
    await page.getByRole('button', { name: 'Switch to Alpha', exact: true }).click();
    release(); release = null;
    await page.waitForFunction(() => document.querySelector('.sheet-id-name')?.textContent === 'Record Alpha');
    expect(await page.locator('.sheet').textContent()).not.toContain('Record Beta');
    await page.screenshot({ path: '/tmp/neuma-record-unified.png', fullPage: true });
    for (const button of ['Switch to witness ID', 'Switch to witness kind']) {
      await page.getByRole('button', { name: button, exact: true }).click();
      await page.getByText('NEUMA RECORD ONLY', { exact: true }).waitFor();
      expect(await page.locator('.sheet-id-name').count()).toBe(0);
      expect(await page.getByTestId('meditation-panel').count()).toBe(0);
      expect(await page.getByRole('heading', { name: 'STATE — MEASURED FUNCTIONING', exact: true }).count()).toBe(0);
    }
    await openDockApp(page, 'DATA');
    await page.waitForFunction(() => [...document.querySelectorAll('small')].some((el) => el.textContent.includes('DATA shows a neuma')));
    expect(await page.locator('.data-realm').count()).toBe(0);
    await page.screenshot({ path: '/tmp/neuma-witness-window-boundary.png', fullPage: true });
    expect(requests.filter((row) => /witness-record-proof|record-marked/.test(row))).toEqual([]);
    // Close DATA before restoring a neuma, so this test does not launch unrelated custody probes.
    await page.getByRole('button', { name: /close/i }).last().click();
    await page.waitForFunction(() => document.querySelector('#window-ids')?.textContent === 'sheet');
    await page.getByRole('button', { name: 'Switch to Alpha', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.sheet-id-name')?.textContent === 'Record Alpha');
    await page.getByRole('button', { name: 'Unbind', exact: true }).click();
    await page.getByText('NO BEING BOUND', { exact: true }).waitFor();
    expect(await page.locator('.sheet').textContent()).not.toContain('Record Alpha');
    expect(requests.filter((row) => row.startsWith('POST '))).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    release?.();
    await browser?.close();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await vite?.close();
    setWorkspacesRoot(oldRoot);
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}, 60000);
