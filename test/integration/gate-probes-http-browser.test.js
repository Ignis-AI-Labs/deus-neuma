/* global window, sessionStorage, setTimeout */
// The desk's fail-open gate probe, mounted as the REAL component in a real
// Chromium against the REAL signed router: an owed lane stands the gate;
// every refusal shape (401 without/with a token, 403 foreign owner, 404
// missing lane) fails OPEN — the desk is never blocked — and a 401 against a
// held token raises the shared neuma:auth_expired alarm exactly once. No
// birth, seal, chain, model or portal exchange. (The first-seal notice that
// stood beside it left the desk on 2026-11-14: the voice seal is never
// forced.)
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import fs from 'node:fs/promises';
import os from 'node:os';
import { build } from 'vite';
import { chromium, expect } from '@playwright/test';
import { test } from 'vitest';
import { getWorkspacesRoot, setWorkspacesRoot } from '../../core/index.js';
import birthSetupRouter from '../../backend/routes/birth-setup-routes.js';
import { fullAuth, writeOwner } from '../helpers/audit-auth.js';

test('the setup gate stands on an owed lane, fails open on every refusal and raises the auth alarm once', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gate-probes-http-'));
  const previous = getWorkspacesRoot();
  let server; let browser;
  try {
    setWorkspacesRoot(path.join(root, 'lanes'));
    const auth = await fullAuth();
    const foreign = await fullAuth();
    await writeOwner(getWorkspacesRoot(), 'owed', auth.address);
    await writeOwner(getWorkspacesRoot(), 'foreign', foreign.address);
    const entryId = 'virtual:gate-probes-proof';
    const source = `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { BirthSetupGate } from ${JSON.stringify(path.resolve('frontend/app/RelinkShell/BirthSetupGate.jsx'))};
      window.expired = 0;
      window.addEventListener('neuma:auth_expired', () => window.expired++);
      let root = null;
      window.mount = (neumaId) => {
        root?.unmount();
        const host = document.createElement('div');
        document.body.replaceChildren(host);
        root = createRoot(host);
        root.render(React.createElement(BirthSetupGate, { wsService: null, companion: { neumaId, name: neumaId } }));
      };
    `;
    const bundle = await build({ configFile: false, root: process.cwd(), logLevel: 'error',
      esbuild: { jsx: 'automatic' },
      plugins: [{ name: 'gate-probes-proof', resolveId: (id) => id === entryId ? id : null,
        load: (id) => id === entryId ? source : null }],
      build: { write: false, rollupOptions: { input: entryId } } });
    const app = express();
    const requests = [];
    app.use('/api', (req, res, next) => { res.on('finish', () => requests.push({ method: req.method, url: req.originalUrl, status: res.statusCode })); next(); });
    app.use('/api/v1/birth-setup', birthSetupRouter);
    for (const file of bundle.output) app.get(`/${file.fileName}`, (_req, res) =>
      res.type(path.extname(file.fileName)).send(file.type === 'chunk' ? file.code : file.source));
    const entry = bundle.output.find((file) => file.type === 'chunk' && file.isEntry).fileName;
    app.get('/', (_req, res) => res.send(`<div id="root"></div><script type="module" src="/${entry}"></script>`));
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ args: ['--disable-gpu'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.mount);
    const setupGate = page.getByText(/«NOTICE» SETUP TO COMPLETE/);
    const mount = async (neumaId) => {
      const probes = [page.waitForResponse((r) => r.url().includes(`/api/v1/birth-setup/${neumaId}`))];
      await page.evaluate((id) => window.mount(id), neumaId);
      await Promise.all(probes);
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
    };

    // No session token: the probe 401s and fails open, and the rot alarm
    // stays silent — the guard fires only against a token we BELIEVE we hold.
    await mount('owed');
    await expect(setupGate).toHaveCount(0);
    expect(await page.evaluate(() => window.expired)).toBe(0);
    expect(requests.map((r) => r.status)).toEqual([401]);

    // Real session, owned lane owing its setup acts: the gate stands on the
    // real probe answer. Its founding words are unsealed too, and nothing
    // stands for them: the voice seal is never forced.
    await page.evaluate((token) => sessionStorage.setItem('authToken', token), auth.token);
    await mount('owed');
    await expect(setupGate).toBeVisible();
    await expect(page.getByText(/FIRST SEAL/)).toHaveCount(0);
    expect(await page.evaluate(() => window.expired)).toBe(0);

    // A dead token: the probe 401s, the gate falls open, and the probe
    // raises the shared alarm exactly once.
    await page.evaluate(() => sessionStorage.setItem('authToken', 'invalid-session-proof'));
    await mount('owed');
    await expect(setupGate).toHaveCount(0);
    expect(await page.evaluate(() => window.expired)).toBe(1);

    // Back on the real token: a missing lane (404) and a foreign-owned lane
    // (403) fail open the same way — the desk is never blocked.
    await page.evaluate((token) => sessionStorage.setItem('authToken', token), auth.token);
    await mount('missing');
    await expect(setupGate).toHaveCount(0);
    await mount('foreign');
    await expect(setupGate).toHaveCount(0);
    expect(await page.evaluate(() => window.expired)).toBe(1);
    expect(requests.slice(-2).map((r) => r.status)).toEqual([404, 403]);
    expect(requests.every((r) => r.method === 'GET')).toBe(true);
    expect(await fs.readdir(path.join(getWorkspacesRoot(), 'owed'))).toEqual(['owner.json']);
    expect(await fs.readdir(path.join(getWorkspacesRoot(), 'foreign'))).toEqual(['owner.json']);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    server?.closeAllConnections();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    setWorkspacesRoot(previous);
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30_000);
