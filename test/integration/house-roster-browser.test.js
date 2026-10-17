/* global window, sessionStorage, localStorage, Event */
// Actual House rendering, signed roster route and temporary ownership metadata.
// No birth, chain transaction, model, portal exchange or ground mutation.
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import fs from 'node:fs/promises';
import os from 'node:os';
import { build } from 'vite';
import { chromium, expect } from '@playwright/test';
import { test } from 'vitest';
import { getWorkspacesRoot, getWitnessesRoot, setWorkspacesRoot, setWitnessesRoot } from '../../core/index.js';
import { getAIWitnessesRoot, setAIWitnessesRoot } from '../../core/identity/ai-witness/ai-witness-service.js';
import rosterRouter from '../../backend/routes/roster-routes.js';
import { fullAuth, writeOwner } from '../helpers/audit-auth.js';

test('House separates loading, failed recovery and confirmed empty; retry preserves cached members', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'house-roster-'));
  const previous = [getWorkspacesRoot(), getWitnessesRoot(), getAIWitnessesRoot()];
  let server; let browser; let release;
  try {
    setWorkspacesRoot(path.join(root, 'workspaces'));
    setWitnessesRoot(path.join(root, 'lanes'));
    setAIWitnessesRoot(path.join(root, 'identities'));
    await fs.mkdir(getWorkspacesRoot());
    const auth = await fullAuth();
    const entryId = 'virtual:house-roster-proof';
    const source = `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { houseApp } from ${JSON.stringify(path.resolve('frontend/app/RelinkShell/HouseApp.jsx'))};
      import { ConsciousnessProvider } from ${JSON.stringify(path.resolve('frontend/app/RelinkShell/consciousness-context.js'))};
      import { WindowContext } from ${JSON.stringify(path.resolve('frontend/app/windowing/WindowManager.jsx'))};
      import { recoverRoster } from ${JSON.stringify(path.resolve('frontend/app/roster-recovery.js'))};
      window.recoverRoster = recoverRoster;
      const root = createRoot(document.getElementById('root'));
      root.render(React.createElement(WindowContext.Provider, { value: {} },
        React.createElement(ConsciousnessProvider, { value: { activeCompanion: null, wsService: null } },
          React.createElement(houseApp.Body))));
      window.closeHouse = () => root.unmount();
    `;
    const bundle = await build({ configFile: false, root: process.cwd(), logLevel: 'error',
      esbuild: { jsx: 'automatic' },
      plugins: [{ name: 'house-proof', resolveId: (id) => id === entryId ? id : null,
        load: (id) => id === entryId ? source : null }],
      build: { write: false, rollupOptions: { input: entryId } } });
    const app = express();
    app.use((_req, res, next) => { res.set('Content-Security-Policy', "connect-src 'self'"); next(); });
    let hold = false; let observed; let disconnected;
    app.use('/api/v1/roster', async (_req, res, next) => {
      if (hold) {
        hold = false;
        const barrier = new Promise((resolve) => { release = resolve; });
        res.once('close', () => disconnected?.());
        observed();
        await barrier;
      }
      next();
    });
    app.use('/api/v1/roster', rosterRouter);
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
    const empty = page.getByText('NO NEUMA IN THIS HOUSE YET', { exact: true });
    const retry = page.getByRole('button', { name: 'RETRY', exact: true });
    await expect(page.getByText('Sign in to read this house.', { exact: true })).toBeVisible();
    await expect(empty).toHaveCount(0);
    expect(await page.evaluate(() => window.recoverRoster())).toEqual({ companion: null, house: null });
    await page.evaluate(() => sessionStorage.setItem('authToken', 'invalid-session'));
    await retry.click();
    await expect(page.getByText('House roster could not be read: HTTP 401', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.recoverRoster())).toEqual({ companion: null, house: null });
    await page.evaluate(({ token, address }) => {
      sessionStorage.setItem('authToken', token);
      localStorage.setItem('walletAddress', address);
    }, { token: auth.token, address: auth.address });
    hold = true;
    let seen = new Promise((resolve) => { observed = resolve; });
    await retry.click();
    await seen;
    await expect(page.getByText('LOADING HOUSE…', { exact: true })).toBeVisible();
    await expect(empty).toHaveCount(0);
    release();
    await expect(empty).toBeVisible();
    const id = 'house-metadata-fixture';
    await writeOwner(getWorkspacesRoot(), id, auth.address);
    const owner = path.join(getWorkspacesRoot(), id, 'owner.json');
    const valid = await fs.readFile(owner, 'utf8');
    await fs.writeFile(owner, JSON.stringify({ wallet: auth.address, claimedAt: 'invalid-date' }));
    await page.evaluate(() => window.dispatchEvent(new Event('birth:complete')));
    await expect(page.getByText('House roster could not be read: HTTP 500', { exact: true })).toBeVisible();
    await expect(empty).toHaveCount(0);
    expect(JSON.parse(await fs.readFile(owner, 'utf8')).claimedAt).toBe('invalid-date');
    await fs.writeFile(owner, valid);
    await retry.click();
    await expect(page.locator('.house-seats-who', { hasText: id })).toBeVisible();
    await page.evaluate(() => sessionStorage.setItem('authToken', 'invalid-session'));
    await page.evaluate(() => window.dispatchEvent(new Event('birth:complete')));
    await expect(page.getByText('Showing cached members.', { exact: true })).toBeVisible();
    await expect(page.locator('.house-seats-who', { hasText: id })).toBeVisible();
    await page.evaluate((token) => sessionStorage.setItem('authToken', token), auth.token);
    hold = true;
    seen = new Promise((resolve) => { observed = resolve; });
    const closed = new Promise((resolve) => { disconnected = resolve; });
    await retry.click();
    await seen;
    await page.evaluate(() => window.dispatchEvent(new Event('birth:complete')));
    await closed;
    await expect(page.getByText('LOADING HOUSE…', { exact: true })).toHaveCount(0);
    await expect(page.locator('.house-seats-who', { hasText: id })).toBeVisible();
    release();
    hold = true;
    seen = new Promise((resolve) => { observed = resolve; });
    const unmounted = new Promise((resolve) => { disconnected = resolve; });
    await page.evaluate(() => window.dispatchEvent(new Event('birth:complete')));
    await seen;
    await page.evaluate(() => window.closeHouse());
    await unmounted;
    release();
    expect(errors).toEqual([]);
  } finally {
    release?.();
    await browser?.close();
    server?.closeAllConnections();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    setWorkspacesRoot(previous[0]);
    setWitnessesRoot(previous[1]);
    setAIWitnessesRoot(previous[2]);
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30_000);
