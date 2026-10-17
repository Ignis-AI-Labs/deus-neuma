/* global window, sessionStorage, localStorage */
// Actual realm UI, signed route, persisted root and preserved source files.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import http from 'node:http';
import express from 'express';
import { build } from 'vite';
import { chromium, expect } from '@playwright/test';
import { test } from 'vitest';
import realmRouter from '../../backend/routes/user-realm-routes.js';
import { getRealmRoot, setRealmRoot, walletDir } from '../../backend/services/user-realm.js';
import { saveRealmSettings, loadRealmSettings } from '../../backend/services/user-realm-settings.js';
import { fullAuth } from '../helpers/audit-auth.js';

test('realm confirmation preserves source files, cancels and retries a refused pointer switch', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'realm-confirm-'));
  const previousRoot = getRealmRoot();
  const previousSettings = process.env.NEUMA_REALM_SETTINGS_PATH;
  let server; let browser; let release;
  try {
    const original = path.join(root, 'original'); const destination = path.join(root, 'destination');
    process.env.NEUMA_REALM_SETTINGS_PATH = path.join(root, 'settings.json');
    setRealmRoot(original); await saveRealmSettings({ root: original });
    const auth = await fullAuth();
    await fs.mkdir(walletDir(auth.address), { recursive: true });
    const sourceFile = path.join(walletDir(auth.address), 'preserved.txt');
    await fs.writeFile(sourceFile, 'realm-source-survives');
    const entryId = 'virtual:realm-confirm-proof';
    const source = `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      // The engine initializes before render, exactly as main.jsx boots it —
      // the section's accessible names come from the catalogs now.
      import ${JSON.stringify(path.resolve('frontend/i18n/index.js'))};
      import { RealmSection } from ${JSON.stringify(path.resolve('frontend/app/RelinkShell/RealmSection.jsx'))};
      const root = createRoot(document.getElementById('root'));
      window.mountRealm = () => root.render(React.createElement(RealmSection));
    `;
    const bundle = await build({ configFile: false, root: process.cwd(), logLevel: 'error',
      esbuild: { jsx: 'automatic' },
      plugins: [{ name: 'realm-proof', resolveId: (id) => id === entryId ? id : null,
        load: (id) => id === entryId ? source : null }],
      build: { write: false, rollupOptions: { input: entryId } } });
    const app = express(); app.use(express.json());
    app.use((_req, res, next) => { res.set('Content-Security-Policy', "connect-src 'self'"); next(); });
    let changes = 0; let hold = false; let observed;
    app.use('/api/v1/user/realm', async (req, _res, next) => {
      if (req.method === 'POST') {
        changes++;
        if (hold) {
          hold = false;
          const barrier = new Promise((resolve) => { release = resolve; });
          observed();
          await barrier;
        }
      }
      next();
    });
    app.use('/api/v1/user/realm', realmRouter);
    for (const file of bundle.output) app.get(`/${file.fileName}`, (_req, res) =>
      res.type(path.extname(file.fileName)).send(file.type === 'chunk' ? file.code : file.source));
    const entry = bundle.output.find((file) => file.type === 'chunk' && file.isEntry).fileName;
    const styles = bundle.output.filter((file) => file.fileName.endsWith('.css')).map((file) => `<link rel="stylesheet" href="/${file.fileName}">`).join('');
    app.get('/', (_req, res) => res.send(`${styles}<div id="root"></div><script type="module" src="/${entry}"></script>`));
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ args: ['--disable-gpu'] });
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.mountRealm);
    await page.evaluate(({ token, address }) => {
      sessionStorage.setItem('authToken', token); localStorage.setItem('walletAddress', address); window.mountRealm();
    }, { token: auth.token, address: auth.address });
    const input = page.getByRole('textbox', { name: 'Realm location' });
    const trigger = page.getByRole('button', { name: 'SET', exact: true });
    const group = page.getByRole('group', { name: 'Confirm realm location change' });
    await expect(input).toHaveValue(original);
    await expect(trigger).toBeDisabled();
    await input.fill(destination); await trigger.click();
    await expect(group).toContainText(destination);
    await expect(group).toContainText('Existing conversations and settings stay in the old folder');
    await expect(input).toBeDisabled();
    await expect(group.getByRole('button', { name: 'CANCEL' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(group).toHaveCount(0);
    await trigger.click(); await page.keyboard.press('Escape');
    await expect(group).toHaveCount(0);
    expect(changes).toBe(0);
    expect(getRealmRoot()).toBe(original);
    await input.fill('relative-path'); await trigger.click();
    await group.getByRole('button', { name: 'SET LOCATION' }).click();
    await expect(page.getByText('root must be an absolute path', { exact: true })).toBeVisible();
    await expect(group).toBeVisible();
    expect(await loadRealmSettings()).toEqual({ root: original });
    await group.getByRole('button', { name: 'CANCEL' }).click();
    await input.fill(destination); await trigger.click();
    await page.evaluate(() => sessionStorage.removeItem('authToken'));
    await group.getByRole('button', { name: 'SET LOCATION' }).click();
    await expect(page.locator('.settings-err')).toContainText(/[Aa]uth|401|[Tt]oken/);
    expect(getRealmRoot()).toBe(original);
    expect(await loadRealmSettings()).toEqual({ root: original });
    await page.evaluate((token) => sessionStorage.setItem('authToken', token), auth.token);
    hold = true;
    const seen = new Promise((resolve) => { observed = resolve; });
    await group.getByRole('button', { name: 'SET LOCATION' }).click(); await seen;
    await expect(group.getByRole('button', { name: 'WORKING…' })).toBeDisabled();
    await expect(group.getByRole('button', { name: 'CANCEL' })).toBeDisabled();
    await expect(input).toBeDisabled();
    release();
    await expect(group).toHaveCount(0);
    await expect(input).toHaveValue(destination);
    await expect(trigger).toBeDisabled();
    expect(getRealmRoot()).toBe(destination);
    expect(await loadRealmSettings()).toEqual({ root: destination });
    expect(await fs.readFile(sourceFile, 'utf8')).toBe('realm-source-survives');
    await expect(fs.stat(path.join(walletDir(auth.address), 'preserved.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(changes).toBe(3);
    expect(errors).toEqual([]);
  } finally {
    release?.(); await browser?.close(); server?.closeAllConnections();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    setRealmRoot(previousRoot);
    if (previousSettings === undefined) delete process.env.NEUMA_REALM_SETTINGS_PATH;
    else process.env.NEUMA_REALM_SETTINGS_PATH = previousSettings;
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30_000);
