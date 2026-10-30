/* global window, sessionStorage, localStorage */
// Actual ModelsSection, signed routing API and temporary encrypted credentials.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import http from 'node:http';
import express from 'express';
import { build } from 'vite';
import { chromium, expect } from '@playwright/test';
import { test } from 'vitest';
import routingRouter from '../../backend/routes/routing-routes.js';
import { setCredential, loadCredentials } from '../../backend/services/provider-credentials.js';
import { fullAuth } from '../helpers/audit-auth.js';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';

test('provider removal confirms its target, cancels safely and retries signed deletion', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-confirm-'));
  const names = ['NEUMA_PROVIDER_CREDENTIALS_PATH', 'NEUMA_CONNECTIONS_PATH', 'DNA_ENCRYPTION_KEY', 'OPENAI_API_KEY'];
  const env = names.map((name) => process.env[name]);
  let server; let browser; let release;
  try {
    process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(root, 'credentials.json');
    process.env.NEUMA_CONNECTIONS_PATH = path.join(root, 'connections.json');
    process.env.DNA_ENCRYPTION_KEY = 'temporary-provider-confirm-encryption';
    process.env.OPENAI_API_KEY = 'temporary-environment-fallback';
    await setCredential('openai', { apiKey: 'temporary-openai-key', endpoint: 'https://api.openai.com/v1' });
    await setCredential('anthropic', { apiKey: 'temporary-anthropic-key' });
    const before = await loadCredentials();
    const encrypted = await fs.readFile(process.env.NEUMA_PROVIDER_CREDENTIALS_PATH, 'utf8');
    expect(encrypted).not.toContain('temporary-openai-key');
    const auth = await fullAuth();
    // The first local wallet no longer owns a fresh install on its word (owner-claim.js): seated here.
    await makeInstallOwner(auth.address);
    const entryId = 'virtual:provider-key-confirm-proof';
    const source = `
      import React from 'react';
      import { listProviders } from ${JSON.stringify(path.resolve('frontend/services/routing.js'))};
      window.readSettings = { listProviders };
      window.expired = 0;
      window.addEventListener('neuma:auth_expired', () => window.expired++);
      import { createRoot } from 'react-dom/client';
      import { ModelsSection } from ${JSON.stringify(path.resolve('frontend/app/RelinkShell/ModelsSection.jsx'))};
      const root = createRoot(document.getElementById('root'));
      window.mountModels = () => root.render(React.createElement(ModelsSection));
    `;
    const bundle = await build({ configFile: false, root: process.cwd(), logLevel: 'error',
      esbuild: { jsx: 'automatic' },
      plugins: [{ name: 'provider-proof', resolveId: (id) => id === entryId ? id : null,
        load: (id) => id === entryId ? source : null }],
      build: { write: false, rollupOptions: { input: entryId } } });
    const app = express(); app.use(express.json());
    app.use((_req, res, next) => { res.set('Content-Security-Policy', "connect-src 'self'"); next(); });
    let deletes = 0; let hold = false; let observed;
    app.use('/api/v1/routing', async (req, _res, next) => {
      if (req.method === 'DELETE') {
        deletes++;
        if (hold) {
          hold = false;
          const barrier = new Promise((resolve) => { release = resolve; });
          observed();
          await barrier;
        }
      }
      next();
    });
    app.use('/api/v1/routing', routingRouter);
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
    await page.waitForFunction(() => window.mountModels);
    await page.evaluate(({ token, address }) => {
      sessionStorage.setItem('authToken', token); localStorage.setItem('walletAddress', address); window.mountModels();
    }, { token: auth.token, address: auth.address });
    const openai = page.locator('.settings-provider-row').filter({ has: page.locator('code', { hasText: /^OpenAI$/ }) });
    const anthropic = page.locator('.settings-provider-row').filter({ has: page.locator('code', { hasText: /^Anthropic$/ }) });
    const trigger = page.getByRole('button', { name: 'REMOVE', exact: true });
    const group = page.getByRole('group', { name: 'Confirm provider credential removal' });
    await openai.click();
    await trigger.click();
    await expect(group).toContainText('custom endpoint for OpenAI');
    await expect(group).toContainText('Environment credentials remain available.');
    await expect(group.getByRole('button', { name: 'CANCEL' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(group).toHaveCount(0);
    await trigger.click(); await page.keyboard.press('Escape');
    await expect(group).toHaveCount(0);
    await trigger.click(); await anthropic.click();
    await expect(group).toHaveCount(0);
    expect(deletes).toBe(0);
    expect(await loadCredentials()).toEqual(before);
    await openai.click(); await trigger.click();
    await page.evaluate(() => sessionStorage.removeItem('authToken'));
    await group.getByRole('button', { name: 'REMOVE', exact: true }).click();
    await expect(page.locator('.settings-err').filter({ hasText: /[Aa]uth|401|[Tt]oken/ })).toBeVisible();
    await expect(group).toBeVisible();
    expect(await loadCredentials()).toEqual(before);
    await page.evaluate((token) => sessionStorage.setItem('authToken', token), auth.token);
    hold = true;
    const seen = new Promise((resolve) => { observed = resolve; });
    await group.getByRole('button', { name: 'REMOVE', exact: true }).click(); await seen;
    await expect(group.getByRole('button', { name: 'WORKING…' })).toBeDisabled();
    await expect(group.getByRole('button', { name: 'CANCEL' })).toBeDisabled();
    await expect(anthropic).toBeDisabled();
    release();
    await expect(group).toHaveCount(0);
    await expect(anthropic).toBeEnabled();
    const after = await loadCredentials();
    expect(after.openai).toBeUndefined();
    expect(after.anthropic).toEqual(before.anthropic);
    expect(process.env.OPENAI_API_KEY).toBe('temporary-environment-fallback');
    expect(deletes).toBe(2);
    await page.evaluate(() => { window.expired = 0; sessionStorage.setItem('authToken', 'expired-invalid-token'); });
    expect(await page.evaluate(async () => {
      try { await window.readSettings.listProviders(); return null; }
      catch (error) { return { message: error.message, http: error.http }; }
    })).toEqual({ message: 'Could not list providers (401)', http: 401 });
    expect(await page.evaluate(() => window.expired)).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    release?.(); await browser?.close(); server?.closeAllConnections();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    names.forEach((name, i) => { if (env[i] === undefined) delete process.env[name]; else process.env[name] = env[i]; });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30_000);
