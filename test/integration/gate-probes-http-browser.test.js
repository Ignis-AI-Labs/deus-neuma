/* global window, sessionStorage, setTimeout */
// The desk's two fail-open gate probes, mounted as the REAL components in a
// real Chromium against the REAL signed routers: an owed lane stands both
// gates; every refusal shape (401 without/with a token, 403 foreign owner,
// 404 missing lane) fails OPEN — the desk is never blocked — and a 401
// against a held token raises the shared neuma:auth_expired alarm exactly
// once per probe. No birth, seal, chain, model or portal exchange.
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
import voicePackRouter from '../../backend/routes/voice-pack-routes.js';
import birthSetupRouter from '../../backend/routes/birth-setup-routes.js';
import { fullAuth, writeOwner } from '../helpers/audit-auth.js';

test('gate probes stand on owed lanes, fail open on every refusal and raise the auth alarm once per probe', async () => {
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
      import { VoiceSealGate } from ${JSON.stringify(path.resolve('frontend/app/RelinkShell/VoiceSealGate.jsx'))};
      import { BirthSetupGate } from ${JSON.stringify(path.resolve('frontend/app/RelinkShell/BirthSetupGate.jsx'))};
      window.expired = 0;
      window.addEventListener('neuma:auth_expired', () => window.expired++);
      let root = null;
      window.mount = (neumaId) => {
        root?.unmount();
        const host = document.createElement('div');
        document.body.replaceChildren(host);
        root = createRoot(host);
        root.render(React.createElement(React.Fragment, null,
          React.createElement(VoiceSealGate, { companion: { neumaId, name: neumaId } }),
          React.createElement(BirthSetupGate, { wsService: null, companion: { neumaId, name: neumaId } })));
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
    app.use('/api/v1/voice-pack', voicePackRouter);
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
    const sealGate = page.getByText(/«NOTICE» THE FIRST SEAL IS OWED/);
    const setupGate = page.getByText(/«NOTICE» SETUP TO COMPLETE/);
    const mount = async (neumaId) => {
      const probes = [page.waitForResponse((r) => r.url().includes(`/api/v1/voice-pack/${neumaId}`)),
        page.waitForResponse((r) => r.url().includes(`/api/v1/birth-setup/${neumaId}`))];
      await page.evaluate((id) => window.mount(id), neumaId);
      await Promise.all(probes);
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
    };

    // No session token: both probes 401 and fail open, and the rot alarm
    // stays silent — the guard fires only against a token we BELIEVE we hold.
    await mount('owed');
    await expect(sealGate).toHaveCount(0);
    await expect(setupGate).toHaveCount(0);
    expect(await page.evaluate(() => window.expired)).toBe(0);
    expect(requests.map((r) => r.status)).toEqual([401, 401]);

    // Real session, owned lane owing both its founding words and its setup
    // acts: BOTH gates stand on the real probe answers.
    await page.evaluate((token) => sessionStorage.setItem('authToken', token), auth.token);
    await mount('owed');
    await expect(sealGate).toBeVisible();
    await expect(setupGate).toBeVisible();
    expect(await page.evaluate(() => window.expired)).toBe(0);

    // A dead token: both probes 401, both gates fall open, and each probe
    // raises the shared alarm exactly once.
    await page.evaluate(() => sessionStorage.setItem('authToken', 'invalid-session-proof'));
    await mount('owed');
    await expect(sealGate).toHaveCount(0);
    await expect(setupGate).toHaveCount(0);
    expect(await page.evaluate(() => window.expired)).toBe(2);

    // Back on the real token: a missing lane (404) and a foreign-owned lane
    // (403) fail open the same way — the desk is never blocked.
    await page.evaluate((token) => sessionStorage.setItem('authToken', token), auth.token);
    await mount('missing');
    await expect(sealGate).toHaveCount(0);
    await expect(setupGate).toHaveCount(0);
    await mount('foreign');
    await expect(sealGate).toHaveCount(0);
    await expect(setupGate).toHaveCount(0);
    expect(await page.evaluate(() => window.expired)).toBe(2);
    expect(requests.slice(-4).map((r) => r.status)).toEqual([404, 404, 403, 403]);
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
