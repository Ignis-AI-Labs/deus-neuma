/* global window, sessionStorage */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import http from 'node:http';
import express from 'express';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { test, expect } from 'vitest';
import recoveryRouter from '../../backend/routes/recovery-routes.js';
import routeRouter from '../../backend/routes/neuma-route-routes.js';
import residencyRouter from '../../backend/routes/residency-routes.js';
import { getConfig, setConfig } from '../../backend/services/llm-provider.js';
import { getWorkspacesRoot, setWorkspacesRoot, getWitnessesRoot, setWitnessesRoot } from '../../core/index.js';
import { fullAuth, writeOwner } from '../helpers/audit-auth.js';

// Metadata-only temporary workspace; no birth, keys, model or scheduler.
test('recovery and residency reads preserve refusals and signal expired sessions', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'recovery-residency-read-'));
  const roots = [getWorkspacesRoot(), getWitnessesRoot()]; const config = getConfig();
  const keys = ['NEUMA_ROUTES_PATH', 'NEUMA_PROVIDER_CREDENTIALS_PATH'];
  const saved = keys.map(key => process.env[key]);
  let vite; let server; let browser;
  try {
    process.env.NEUMA_ROUTES_PATH = path.join(root, 'routes.json');
    process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(root, 'credentials.json');
    setWorkspacesRoot(path.join(root, 'workspaces'));
    setWitnessesRoot(path.join(root, 'witnesses'));
    const auth = await fullAuth(); const other = await fullAuth();
    await writeOwner(getWorkspacesRoot(), 'read-fixture', auth.address);
    const ownerPath = path.join(getWorkspacesRoot(), 'read-fixture', 'owner.json');
    const ownerBefore = await fs.readFile(ownerPath, 'utf8');
    const app = express(); app.use(express.json());
    app.use('/api/v1/neuma', recoveryRouter);
    app.use('/api/v1/neuma', routeRouter);
    app.use('/api/v1/residency', residencyRouter);
    vite = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(root, 'vite'),
      appType: 'custom', server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null }, optimizeDeps: { noDiscovery: true } });
    app.get('/', (_req, res) => res.type('html').send('<script type="module">import {getRecoveryStatus} from "/frontend/services/security.js"; import {getResidency} from "/frontend/services/residency.js"; import {getLaneRouteHealth} from "/frontend/services/route-health.js"; window.clients={getRecoveryStatus,getResidency,getLaneRouteHealth}; window.expired=0; window.addEventListener("neuma:auth_expired",()=>window.expired++);</script>'));
    app.use(vite.middlewares);
    server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    // The real HTTP app has no model endpoint: its native 404 proves unavailable.
    setConfig({ provider: 'lm-studio', model: 'read-fixture', apiKey: '', endpoint: `${origin}/no-model-here` });
    browser = await chromium.launch({ args: ['--disable-gpu'] }); const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin); await page.waitForFunction(() => window.clients);
    const call = (name, ...args) => page.evaluate(async ({ name, args }) => {
      try { return { ok: true, value: await window.clients[name](...args) }; }
      catch (error) { return { ok: false, message: error.message, http: error.http }; }
    }, { name, args });
    expect(await call('getLaneRouteHealth', { neumaId: 'read-fixture' })).toEqual({ ok: true, value: { live: null, provider: null } });
    expect(await call('getRecoveryStatus', 'read-fixture')).toEqual({ ok: false, message: 'Could not read recovery status (401)', http: 401 });
    expect(await call('getResidency')).toEqual({ ok: false, message: 'Residency read failed (401)', http: 401 });
    expect(await page.evaluate(() => window.expired)).toBe(0);
    await page.evaluate(token => sessionStorage.setItem('authToken', token), auth.token);
    expect(await call('getLaneRouteHealth', null)).toEqual({ ok: true, value: { live: null, provider: null, reason: 'unbound' } });
    expect(await call('getLaneRouteHealth', { neumaId: 'read-fixture' })).toEqual({ ok: true, value: { live: false, provider: 'lm-studio' } });
    expect(await call('getRecoveryStatus', 'read-fixture')).toMatchObject({ ok: true, value: {
      neumaId: 'read-fixture', hasEncryptedKeypair: false, hasPlaintextKeypair: false,
      hasRecoveryCodes: false, address: null, rotationCount: 0, needsMigration: false,
    } });
    expect(await call('getResidency')).toMatchObject({ ok: true, value: {
      enabled: false, running: false, neuma: [], conduit: { reachable: false, provider: 'lm-studio' },
    } });
    await page.evaluate(token => sessionStorage.setItem('authToken', token), other.token);
    expect(await call('getLaneRouteHealth', { neumaId: 'read-fixture' })).toEqual({ ok: true, value: { live: null, provider: null } });
    expect(await call('getRecoveryStatus', 'read-fixture')).toEqual({ ok: false, message: 'Could not read recovery status (403)', http: 403 });
    expect(await call('getRecoveryStatus', 'absent-fixture')).toEqual({ ok: false, message: 'Could not read recovery status (404)', http: 404 });
    expect(await page.evaluate(() => window.expired)).toBe(0);
    await page.evaluate(() => sessionStorage.setItem('authToken', 'expired-invalid-token'));
    expect(await call('getLaneRouteHealth', { neumaId: 'read-fixture' })).toEqual({ ok: true, value: { live: null, provider: null } });
    expect(await call('getRecoveryStatus', 'read-fixture')).toEqual({ ok: false, message: 'Could not read recovery status (401)', http: 401 });
    expect(await call('getResidency')).toEqual({ ok: false, message: 'Residency read failed (401)', http: 401 });
    expect(await page.evaluate(() => window.expired)).toBe(3);
    expect(await fs.readFile(ownerPath, 'utf8')).toBe(ownerBefore);
    expect(await fs.readdir(path.dirname(ownerPath))).toEqual(['owner.json']);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close(); server?.closeAllConnections();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await vite?.close(); setConfig(config);
    setWorkspacesRoot(roots[0]); setWitnessesRoot(roots[1]);
    keys.forEach((key, i) => { if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i]; });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30000);
