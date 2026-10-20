/* global window, sessionStorage */
// Real account storage through browser transport; no SMTP/IMAP connection or email send.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import express from 'express';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { expect, test } from 'vitest';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { fullAuth, writeOwner } from '../helpers/audit-auth.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';

test('email client uses real authenticated routes, sealed storage and shared error handling', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'email-client-browser-'));
  const keys = ['NEUMA_EMAIL_CREDENTIALS_PATH', 'NEUMA_EMAIL_BINDING_PATH', 'NEUMA_DATA_ROOT',
    'EMAIL_ADDRESS', 'EMAIL_USERNAME', 'EMAIL_PASSWORD', 'EMAIL_SMTP_HOST', 'EMAIL_SMTP_PORT', 'EMAIL_IMAP_HOST', 'EMAIL_IMAP_PORT'];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const oldRoot = getWorkspacesRoot();
  const oldRealm = getRealmRoot();
  let browser; let server; let vite;
  try {
    for (const key of keys) delete process.env[key];
    process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
    process.env.NEUMA_EMAIL_CREDENTIALS_PATH = path.join(root, 'credentials.json');
    process.env.NEUMA_EMAIL_BINDING_PATH = path.join(root, 'binding.json');
    setWorkspacesRoot(path.join(root, 'lanes'));
    // The mailbox is the caller's house's own, kept in its realm dir — tmp.
    setRealmRoot(path.join(root, 'realm'));
    const auth = await fullAuth();
    await workspace.create('email-control');
    await writeOwner(workspace.root, 'email-control', auth.address);
    const app = express();
    app.use(express.json());
    app.use('/api/v1/email', (await import('../../backend/routes/email-routes.js')).default);
    vite = await createServer({ configFile: false, root: fileURLToPath(new URL('../..', import.meta.url)),
      cacheDir: path.join(root, 'vite'), appType: 'custom',
      server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null }, optimizeDeps: { noDiscovery: true } });
    app.get('/', (_req, res) => res.type('html').send('<script type="module">import * as client from "/frontend/services/email-client.js"; import {apiCall} from "/frontend/utils/http.js"; window.client=client; window.apiCall=apiCall; window.expired=0; window.addEventListener("neuma:auth_expired",()=>window.expired++);</script>'));
    app.use(vite.middlewares);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => Boolean(window.client));
    const invoke = (name, arg) => page.evaluate(async ({ name, arg }) => {
      try { return { result: await window.client[name](arg) }; }
      catch (error) { return { error: error.message, http: error.http }; }
    }, { name, arg });
    expect((await invoke('getEmailBoard')).error).toBe('Not authenticated.');
    await page.evaluate((token) => sessionStorage.setItem('authToken', token), auth.token);
    expect((await invoke('getEmailBoard')).result.account.configured).toBe(false);
    const fields = { address: 'proof@example.invalid', username: 'proof', password: 'temporary-account-proof' };
    const set = await invoke('setEmailCredentials', fields);
    expect(set.result.configured).toBe(true);
    expect(JSON.stringify(set.result)).not.toContain(fields.password);
    const raw = await fs.readFile(path.join(root, 'realm', auth.address.toLowerCase(), 'email-credentials.json'), 'utf8');
    expect(raw).not.toContain(fields.password);
    expect(JSON.parse(raw)).toHaveProperty('ct');
    expect((await invoke('getEmailBoard')).result.account.configured).toBe(true);
    expect((await invoke('bindEmail', 'email-control')).result.binding.neumaId).toBe('email-control');
    await invoke('releaseEmail');
    expect((await invoke('getEmailBoard')).result.account.binding).toBeNull();
    expect((await invoke('setEmailCredentials', { password: 42 })).error).toBe('Each field value must be a string');
    await invoke('clearEmailCredentials');
    expect((await invoke('getEmailBoard')).result.account.configured).toBe(false);
    const fallback = await page.evaluate(async () => {
      try { await window.apiCall('GET', '/missing-proof', { errorPrefix: 'Email request failed', errorSuffix: '.' }); }
      catch (error) { return { message: error.message, http: error.http }; }
    });
    expect(fallback).toEqual({ message: 'Email request failed (404).', http: 404 });
    await page.evaluate(() => sessionStorage.setItem('authToken', 'expired-proof'));
    expect((await invoke('getEmailBoard')).http).toBe(401);
    expect(await page.evaluate(() => window.expired)).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await vite?.close();
    setWorkspacesRoot(oldRoot);
    setRealmRoot(oldRealm);
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30_000);
