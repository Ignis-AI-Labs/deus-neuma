/* global window, sessionStorage */
// The null-idiom substrate reads (vessel-client fetchTelemetry, substrate-client
// loadTelemetry, capacity-client loadCapacity) proven through a REAL browser
// against the REAL substrate router (RULE 0 — no mocks): anonymous bailout
// without a request, an honest snapshot with a signed session, the 401 rot
// alarm with recovery, and the unreachable-platform null.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import http from 'node:http';
import express from 'express';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { test, expect } from 'vitest';
import { fullAuth } from '../helpers/audit-auth.js';

test('substrate null-read clients preserve the resolve-null idiom and sound the auth rot alarm', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'null-read-clients-'));
  const paths = { NEUMA_CAPACITY_PATH: 'capacity', NEUMA_MODELS_DIRS: 'models', NEUMA_SUBSTRATE_CLAIM_DIR: 'claims' };
  // The telemetry read probes the served llama-server: pinned to the discard port, never the live one.
  const pinned = { LLAMA_SERVER_URL: 'http://127.0.0.1:9' };
  const saved = Object.fromEntries([...Object.keys(paths), ...Object.keys(pinned)].map(key => [key, process.env[key]]));
  let vite; let server; let browser;
  try {
    for (const [key, dir] of Object.entries(paths)) process.env[key] = path.join(root, dir);
    Object.assign(process.env, pinned);
    const auth = await fullAuth(); const app = express(); const requests = [];
    app.use('/api', (req, res, next) => { res.on('finish', () => requests.push({ method: req.method, status: res.statusCode })); next(); });
    app.use('/api/v1/substrate', (await import('../../backend/routes/substrate-routes.js')).default);
    vite = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(root, 'vite'),
      appType: 'custom', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null } });
    app.get('/', (_req, res) => res.type('html').send('<script type="module">'
      + 'import {fetchTelemetry} from "/frontend/app/RelinkShell/vessel-client.js";'
      + 'import {loadTelemetry} from "/frontend/app/RelinkShell/substrate-client.js";'
      + 'import {loadCapacity} from "/frontend/app/RelinkShell/capacity-client.js";'
      + 'window.reads={vessel:fetchTelemetry,hud:loadTelemetry,capacity:loadCapacity};'
      + 'window.expired=0; window.addEventListener("neuma:auth_expired",()=>window.expired++);'
      + '</script>'));
    app.use(vite.middlewares); server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ args: ['--disable-gpu'] }); const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => window.reads);

    expect(await page.evaluate(() => window.reads.vessel())).toBeNull();
    expect(await page.evaluate(() => window.reads.hud())).toBeNull();
    expect(await page.evaluate(() => window.reads.capacity())).toBeNull();
    expect(requests).toEqual([]);

    await page.evaluate(token => sessionStorage.setItem('authToken', token), auth.token);
    const telemetry = await page.evaluate(() => window.reads.vessel());
    expect(typeof telemetry.at).toBe('string');
    expect(typeof telemetry.serving).toBe('boolean');
    expect(telemetry.endpoint).toBe('http://127.0.0.1:9');
    const hudTelemetry = await page.evaluate(() => window.reads.hud());
    expect(typeof hudTelemetry.at).toBe('string');
    expect(hudTelemetry.provider).toBe(telemetry.provider);
    const capacity = await page.evaluate(() => window.reads.capacity());
    expect(capacity).toMatchObject({ runs: [], latest: null, scan: { running: false } });
    expect(typeof capacity.measurable).toBe('boolean');
    expect(requests.length).toBe(3);
    // 304 is success too: the lens reads share one telemetry snapshot for 1.2 s
    // (shared-snapshot.js), so a second read inside it is an identical body the
    // browser revalidates by ETag and hands the page from its cache.
    expect(requests.every(request => request.method === 'GET' && [200, 304].includes(request.status))).toBe(true);

    await page.evaluate(() => sessionStorage.setItem('authToken', 'invalid-session-proof'));
    expect(await page.evaluate(() => window.reads.vessel())).toBeNull();
    expect(await page.evaluate(() => window.reads.hud())).toBeNull();
    expect(await page.evaluate(() => window.reads.capacity())).toBeNull();
    expect(await page.evaluate(() => window.expired)).toBe(3);
    expect(requests.slice(3).every(request => request.status === 401)).toBe(true);

    await page.evaluate(token => sessionStorage.setItem('authToken', token), auth.token);
    expect(await page.evaluate(() => window.reads.capacity())).toMatchObject({ runs: [], latest: null });

    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    expect(await page.evaluate(() => window.reads.vessel())).toBeNull();
    expect(await page.evaluate(() => window.reads.hud())).toBeNull();
    expect(await page.evaluate(() => window.reads.capacity())).toBeNull();
    expect(errors).toEqual([]);
  } finally {
    await browser?.close(); await vite?.close(); server?.closeAllConnections();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30_000);
