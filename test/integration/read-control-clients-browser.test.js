/* global window, sessionStorage */
// Real Chromium, signed auth, temporary settings and encrypted pin storage.
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
import { applyPin, applyUnpin } from '../../core/memory/pin-ledger.js';
import { fullAuth, writeOwner } from '../helpers/audit-auth.js';

test('web settings and memory pin clients preserve real storage and auth boundaries', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'read-control-browser-'));
  const keys = ['NEUMA_DATA_ROOT', 'NEUMA_WEB_ACCESS_PATH', 'NEUMA_WEB_ACCESS'];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const oldRoot = getWorkspacesRoot();
  let browser; let server; let vite;
  try {
    process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
    process.env.NEUMA_WEB_ACCESS_PATH = path.join(root, 'web.json');
    delete process.env.NEUMA_WEB_ACCESS;
    setWorkspacesRoot(path.join(root, 'lanes'));
    const auth = await fullAuth();
    const stranger = await fullAuth();
    const id = 'read-control';
    await workspace.create(id);
    await writeOwner(getWorkspacesRoot(), id, auth.address);
    await workspace.writeNeumaDEK(id, 'a'.repeat(64));
    const app = express();
    app.use(express.json());
    app.use('/api/v1/web', (await import('../../backend/routes/web-routes.js')).default);
    app.use('/api/v1/workspace', (await import('../../backend/routes/workspace-routes.js')).default);
    vite = await createServer({ configFile: false, root: fileURLToPath(new URL('../..', import.meta.url)),
      cacheDir: path.join(root, 'vite'), appType: 'custom',
      server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null }, optimizeDeps: { noDiscovery: true } });
    app.get('/', (_req, res) => res.type('html').send('<script type="module">import * as web from "/frontend/services/web-client.js"; import * as pins from "/frontend/services/memory-pins.js"; window.client={...web,...pins}; window.expired=0; window.addEventListener("neuma:auth_expired",()=>window.expired++);</script>'));
    app.use(vite.middlewares);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => Boolean(window.client));
    const invoke = (name, args = []) => page.evaluate(async ({ name, args }) => {
      try { return { result: await window.client[name](...args) }; }
      catch (error) { return { error: error.message, http: error.http }; }
    }, { name, args });
    for (const [name, args] of [['getWebAccess', []], ['setWebAccess', [true]], ['getActivePins', [id]]]) {
      expect((await invoke(name, args)).error).toBe('Not authenticated.');
    }
    await expect(fs.access(process.env.NEUMA_WEB_ACCESS_PATH)).rejects.toMatchObject({ code: 'ENOENT' });
    await page.evaluate((token) => sessionStorage.setItem('authToken', token), auth.token);
    expect((await invoke('getWebAccess')).result).toMatchObject({ enabled: true, envLocked: false });
    for (const value of [false, true, 'true']) {
      expect((await invoke('setWebAccess', [value])).result.enabled).toBe(value === true);
      expect(JSON.parse(await fs.readFile(process.env.NEUMA_WEB_ACCESS_PATH, 'utf8')).enabled).toBe(value === true);
      expect((await invoke('getWebAccess')).result.enabled).toBe(value === true);
    }
    process.env.NEUMA_WEB_ACCESS = '0';
    expect((await invoke('setWebAccess', [true])).result).toMatchObject({ enabled: false, envLocked: true });
    expect(JSON.parse(await fs.readFile(process.env.NEUMA_WEB_ACCESS_PATH, 'utf8')).enabled).toBe(true);
    expect((await invoke('getActivePins', [id])).result).toEqual([]);
    const first = { ref: 'mem_read-control_1_aaaaaaaa', note: 'Temporary anchor', now: '2026-09-10T00:00:00Z' };
    const second = { ref: 'mem_read-control_2_bbbbbbbb', now: '2026-09-10T00:01:00Z' };
    for (const pin of [first, second]) {
      expect((await workspace.updatePinLedger(id, (ledger) => applyPin(ledger, pin))).ok).toBe(true);
    }
    expect((await workspace.updatePinLedger(id, (ledger) => applyUnpin(ledger, second))).ok).toBe(true);
    const pinFile = path.join(workspace.pathFor(id), 'memory', 'pins.json');
    const sealed = await fs.readFile(pinFile, 'utf8');
    expect(sealed).not.toContain(first.note);
    expect((await invoke('getActivePins', [id])).result).toEqual([{ ref: first.ref, note: first.note, pinnedAt: first.now }]);
    await page.evaluate((token) => sessionStorage.setItem('authToken', token), stranger.token);
    expect((await invoke('getActivePins', [id])).http).toBe(403);
    expect(await fs.readFile(pinFile, 'utf8')).toBe(sealed);
    await page.evaluate(() => sessionStorage.setItem('authToken', 'expired-proof'));
    for (const [index, name] of ['getWebAccess', 'setWebAccess', 'getActivePins'].entries()) {
      expect((await invoke(name, name === 'getActivePins' ? [id] : [true])).http).toBe(401);
      expect(await page.evaluate(() => window.expired)).toBe(index + 1);
    }
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await vite?.close();
    setWorkspacesRoot(oldRoot);
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30_000);
