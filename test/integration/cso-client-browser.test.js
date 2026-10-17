/* global window, sessionStorage */
// Actual signed CSO HTTP, isolated governance files; no host scan or live seat.
// The office is the signed-in operator's house, in a tmp realm.
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
import { fullAuth } from '../helpers/audit-auth.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';

test('CSO client preserves temporary records, route refusals and expired-auth delivery', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cso-client-browser-'));
  const keys = ['NEUMA_SECURITY_WATCH_PATH', 'NEUMA_SECURITY_CSO_PATH',
    'NEUMA_SECURITY_THREATS_PATH', 'NEUMA_SECURITY_SCAN_STATE_PATH', 'NEUMA_SECURITY_HOST_PATH'];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const priorRealm = getRealmRoot();
  let browser; let server; let vite;
  try {
    keys.forEach((key) => { process.env[key] = path.join(root, `${key}.json`); });
    setRealmRoot(path.join(root, 'realm'));
    const auth = await fullAuth();
    const office = (name) => path.join(root, 'realm', auth.address, 'offices', 'security', name);
    const watchFile = office('security-watch.json');
    // A deliberate empty watch avoids default repository discovery; real store reads/writes follow.
    await fs.mkdir(path.dirname(watchFile), { recursive: true });
    await fs.writeFile(watchFile, JSON.stringify({ repos: [], host: { expectedPorts: [] } }));
    const app = express();
    app.use(express.json());
    app.use('/api/v1/cso', (await import('../../backend/routes/cso-routes.js')).default);
    vite = await createServer({ configFile: false, root: fileURLToPath(new URL('../..', import.meta.url)),
      cacheDir: path.join(root, 'vite'), appType: 'custom',
      server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true } });
    app.get('/', (_req, res) => res.type('html').send('<script type="module">import * as client from "/frontend/services/cso-client.js"; window.client=client; window.expired=0; window.addEventListener("neuma:auth_expired",()=>window.expired++);</script>'));
    app.use(vite.middlewares);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => Boolean(window.client));
    const invoke = (name, args = []) => page.evaluate(async ({ name, args }) => {
      try { return { result: await window.client[name](...args) }; }
      catch (error) { return { error: error.message, http: error.http }; }
    }, { name, args });
    const calls = [['seatCso', ['']], ['clearCso', []], ['getThreats', [{ status: 'new', repo: 'a & b' }]],
      ['getThreat', ['missing']], ['getWatch', []], ['addWatchedRepo', ['relative']],
      ['removeWatchedRepo', ['missing']], ['setExpectedPorts', [[]]], ['getScan', []],
      ['runScan', []], ['getPosture', []]];
    let requests = 0;
    page.on('request', (request) => { if (request.url().includes('/api/v1/cso')) requests++; });
    for (const [name, args] of calls) expect((await invoke(name, args)).error).toBe('Not authenticated.');
    expect(requests).toBe(0);
    await page.evaluate((token) => sessionStorage.setItem('authToken', token), auth.token);
    expect((await invoke('getWatch')).result.watch).toEqual({ repos: [], host: { expectedPorts: [] } });
    expect((await invoke('getThreats')).result.threats).toEqual([]);
    expect((await invoke('getScan')).result.scan).toEqual({ lastRunAt: null, host: null, runs: [] });
    expect((await invoke('getPosture')).result.cso).toBeNull();
    expect((await invoke('seatCso', [''])).http).toBe(400);
    expect((await invoke('getThreat', ['missing'])).error).toBe('no such threat');
    expect((await invoke('addWatchedRepo', ['relative'])).error).toBe('a watched repo needs an absolute path');
    expect((await invoke('removeWatchedRepo', ['missing'])).http).toBe(404);
    expect((await invoke('setExpectedPorts', [[70000]])).http).toBe(400);
    expect((await invoke('setExpectedPorts', [[7777, 3333, 7777]])).result.host.expectedPorts).toEqual([3333, 7777]);
    expect(JSON.parse(await fs.readFile(watchFile, 'utf8')).host.expectedPorts).toEqual([3333, 7777]);
    expect((await invoke('clearCso')).result).toEqual({ cleared: true });
    expect(JSON.parse(await fs.readFile(path.join(root, 'realm', auth.address, 'house-cso.json'), 'utf8'))).toBeNull();
    await fs.writeFile(watchFile, '{broken');
    expect(await invoke('getWatch')).toEqual({ error: 'Failed to read the watch list', http: 500 });
    expect(await fs.readFile(watchFile, 'utf8')).toBe('{broken');
    await page.evaluate(() => sessionStorage.setItem('authToken', 'expired-proof'));
    for (const [index, [name, args]] of calls.entries()) {
      expect((await invoke(name, args)).http).toBe(401);
      expect(await page.evaluate(() => window.expired)).toBe(index + 1);
    }
    await expect(fs.access(office('security-scan-state.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await browser?.close();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await vite?.close();
    setRealmRoot(priorRealm);
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30_000);
