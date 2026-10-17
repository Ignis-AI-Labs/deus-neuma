/* global window, sessionStorage, localStorage */
// Real production snapshots, signed router and SecuritySection in Chromium.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import http from 'node:http';
import express from 'express';
import { build } from 'vite';
import { chromium, expect } from '@playwright/test';
import { test } from 'vitest';
import { getWorkspacesRoot, setWorkspacesRoot, getWitnessesRoot, setWitnessesRoot } from '../../core/index.js';
import { getRealmRoot, setRealmRoot, walletDir } from '../../backend/services/user-realm.js';
import { createBackup } from '../../backend/services/backup-service.js';
import securityRouter from '../../backend/routes/security-routes.js';
import { fullAuth } from '../helpers/audit-auth.js';

test('backup confirmation cancels, preserves foreign/source data, and retries a refused delete', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-confirm-'));
  const roots = [getWorkspacesRoot(), getWitnessesRoot(), getRealmRoot()];
  const names = ['NEUMA_BACKUPS_ROOT', 'NEUMA_BACKUP_DESTINATION_PATH', 'NEUMA_WORKSPACE_SETTINGS_PATH'];
  const env = names.map((name) => process.env[name]);
  let server; let browser; let release;
  try {
    setWorkspacesRoot(path.join(root, 'workspaces'));
    setWitnessesRoot(path.join(root, 'witnesses'));
    setRealmRoot(path.join(root, 'realm'));
    await fs.mkdir(getWorkspacesRoot());
    process.env.NEUMA_BACKUPS_ROOT = path.join(root, 'backups');
    process.env.NEUMA_BACKUP_DESTINATION_PATH = path.join(root, 'destination.json');
    process.env.NEUMA_WORKSPACE_SETTINGS_PATH = path.join(root, 'workspace.json');
    const auth = await fullAuth(); const stranger = await fullAuth();
    await fs.mkdir(walletDir(auth.address), { recursive: true });
    const sourceFile = path.join(walletDir(auth.address), 'preserved.txt');
    await fs.writeFile(sourceFile, 'source-must-survive');
    const owned = await createBackup(auth.address, { now: new Date('2026-09-10T00:00:00Z') });
    const foreign = await createBackup(stranger.address, { now: new Date('2026-09-10T00:00:01Z') });
    const copied = path.join(owned.path, 'realm', 'preserved.txt');
    expect(await fs.readFile(copied, 'utf8')).toBe('source-must-survive');
    const entryId = 'virtual:backup-confirm-proof';
    const source = `
      import React from 'react';
      // The engine initializes before render, exactly as main.jsx boots it —
      // the section's accessible names come from the catalogs now.
      import ${JSON.stringify(path.resolve('frontend/i18n/index.js'))};
      import { getSecurityStatus, listBackups } from ${JSON.stringify(path.resolve('frontend/services/security.js'))};
      window.readSettings = { getSecurityStatus, listBackups };
      window.expired = 0;
      window.addEventListener('neuma:auth_expired', () => window.expired++);
      import { createRoot } from 'react-dom/client';
      import { SecuritySection } from ${JSON.stringify(path.resolve('frontend/app/RelinkShell/SecuritySection.jsx'))};
      const root = createRoot(document.getElementById('root'));
      window.mountSecurity = () => root.render(React.createElement(SecuritySection));
    `;
    const bundle = await build({ configFile: false, root: process.cwd(), logLevel: 'error',
      esbuild: { jsx: 'automatic' },
      plugins: [{ name: 'backup-proof', resolveId: (id) => id === entryId ? id : null,
        load: (id) => id === entryId ? source : null }],
      build: { write: false, rollupOptions: { input: entryId } } });
    const app = express(); app.use(express.json());
    app.use((_req, res, next) => { res.set('Content-Security-Policy', "connect-src 'self'"); next(); });
    let deletes = 0; let hold = false; let observed;
    app.use('/api/v1/security', async (req, _res, next) => {
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
    app.use('/api/v1/security', securityRouter);
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
    await page.waitForFunction(() => window.mountSecurity);
    await page.evaluate(({ token, address }) => {
      sessionStorage.setItem('authToken', token); localStorage.setItem('walletAddress', address); window.mountSecurity();
    }, { token: auth.token, address: auth.address });
    const rows = page.locator('.settings-backup-row');
    const trigger = page.getByRole('button', { name: /^Delete backup from / });
    const group = page.getByRole('group', { name: 'Confirm backup deletion' });
    await expect(rows).toHaveCount(1);
    await trigger.click();
    await expect(group).toContainText('Your beings are untouched.');
    await expect(group.getByRole('button', { name: 'CANCEL' })).toBeFocused();
    await expect(page.getByRole('button', { name: 'CREATE BACKUP', exact: true })).toBeDisabled();
    await page.keyboard.press('Enter');
    await expect(group).toHaveCount(0);
    await trigger.click();
    await page.keyboard.press('Escape');
    await expect(group).toHaveCount(0);
    expect(deletes).toBe(0);
    expect(await fs.readFile(copied, 'utf8')).toBe('source-must-survive');
    await trigger.click();
    await page.evaluate((token) => sessionStorage.setItem('authToken', token), stranger.token);
    await group.getByRole('button', { name: 'DELETE', exact: true }).click();
    await expect(page.getByText('Backup not found', { exact: true })).toBeVisible();
    await expect(group).toBeVisible();
    expect(await fs.readFile(copied, 'utf8')).toBe('source-must-survive');
    await page.evaluate((token) => sessionStorage.setItem('authToken', token), auth.token);
    hold = true;
    const seen = new Promise((resolve) => { observed = resolve; });
    await group.getByRole('button', { name: 'DELETE', exact: true }).click();
    await seen;
    await expect(group.getByRole('button', { name: 'WORKING…' })).toBeDisabled();
    await expect(group.getByRole('button', { name: 'CANCEL' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'CREATE BACKUP', exact: true })).toBeDisabled();
    release();
    await expect(rows).toHaveCount(0);
    await expect(page.getByText('NO BACKUPS YET — CREATE ONE ABOVE.', { exact: true })).toBeVisible();
    await expect(fs.stat(owned.path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(sourceFile, 'utf8')).toBe('source-must-survive');
    expect(JSON.parse(await fs.readFile(path.join(foreign.path, 'manifest.json'), 'utf8')).wallet).toBe(stranger.address);
    expect(deletes).toBe(2);
    await page.evaluate(() => { window.expired = 0; sessionStorage.setItem('authToken', 'expired-invalid-token'); });
    expect(await page.evaluate(async () => {
      try { await window.readSettings.getSecurityStatus(); return null; }
      catch (error) { return { message: error.message, http: error.http }; }
    })).toEqual({ message: 'Could not read security status (401)', http: 401 });
    expect(await page.evaluate(async () => {
      try { await window.readSettings.listBackups(); return null; }
      catch (error) { return { message: error.message, http: error.http }; }
    })).toEqual({ message: 'Could not list backups (401)', http: 401 });
    expect(await page.evaluate(() => window.expired)).toBe(2);
    expect(errors).toEqual([]);
  } finally {
    release?.();
    await browser?.close();
    server?.closeAllConnections();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    setWorkspacesRoot(roots[0]); setWitnessesRoot(roots[1]); setRealmRoot(roots[2]);
    names.forEach((name, i) => { if (env[i] === undefined) delete process.env[name]; else process.env[name] = env[i]; });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30_000);
