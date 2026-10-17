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
import realmRouter from '../../backend/routes/user-realm-routes.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { getConfig, setConfig } from '../../backend/services/llm-provider.js';
import { fullAuth } from '../helpers/audit-auth.js';

// Real browser clients, signed production routes and disposable on-disk grounds.
test('ground reads preserve wallet state and fallbacks while signaling expired auth', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ground-client-'));
  const previous = getRealmRoot(); const config = getConfig();
  const credentialPath = process.env.NEUMA_PROVIDER_CREDENTIALS_PATH;
  let vite; let server; let browser;
  try {
    setRealmRoot(path.join(root, 'realm'));
    process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(root, 'credentials.json');
    // Titling's real sovereignty gate refuses this unconfigured foreign route.
    setConfig({ provider: 'openai', model: 'no-title-model', apiKey: '', endpoint: 'https://api.openai.com' });
    const auth = await fullAuth(); const other = await fullAuth();
    const bodies = path.join(root, 'bodies'); await fs.mkdir(bodies);
    await fs.writeFile(path.join(bodies, 'invalid.json'), '{');
    await fs.writeFile(path.join(bodies, 'null.json'), 'null');
    const app = express(); app.use(express.json());
    let titleRequests = 0;
    app.use('/api/v1/user/realm/council-labels/autotitle', (_req, _res, next) => { titleRequests++; next(); });
    app.use('/api/v1/user/realm', realmRouter);
    app.use('/bodies', express.static(bodies));
    vite = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(root, 'vite'),
      appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true } });
    app.get('/', (_req, res) => res.type('html').send('<script type="module">import * as house from "/frontend/services/house-workspace.js"; import * as alliance from "/frontend/services/alliance-ground.js"; import * as realm from "/frontend/services/user-realm.js"; import * as operator from "/frontend/services/operator-name.js"; import {apiCall} from "/frontend/utils/http.js"; import * as labels from "/frontend/services/council-labels.js"; window.clients={...house,...alliance,...realm,...operator,...labels,apiCall}; window.expired=0; window.addEventListener("neuma:auth_expired",()=>window.expired++);</script>'));
    app.use(vite.middlewares);
    server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ args: ['--disable-gpu'] }); const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.clients);
    const call = (name, ...args) => page.evaluate(async ({ name, args }) => {
      try { return { ok: true, value: await window.clients[name](...args) }; }
      catch (error) { return { ok: false, name: error.name, message: error.message }; }
    }, { name, args });
    expect(await call('autotitleCouncils', { councilIds: [] })).toEqual({ ok: true, value: { results: [], labels: null } });
    expect(titleRequests).toBe(0);
    const houseEmpty = { root: null, repos: [] };
    const allianceEmpty = { root: null, suggestion: null, alliances: [] };
    expect((await call('getHouseWorkspace')).value).toEqual(houseEmpty);
    expect((await call('getAllianceGrounds')).value).toEqual(allianceEmpty);
    expect(await page.evaluate(() => window.expired)).toBe(0);
    await page.evaluate(token => sessionStorage.setItem('authToken', token), auth.token);
    expect(await call('getOperatorName')).toEqual({ ok: true, value: '' });
    expect(await call('setOperatorNameSynced', 'Trace fixture')).toEqual({ ok: true, value: 'Trace fixture' });
    expect(await call('getOperatorName')).toEqual({ ok: true, value: 'Trace fixture' });
    expect((await call('getRealm')).value.root).toBe(getRealmRoot());
    expect((await call('setCouncilLabel', 'council-1', 'Retained label')).value).toEqual({ 'council-1': 'Retained label' });
    expect(await call('autotitleCouncils', { councilIds: [] })).toEqual({ ok: true, value: { results: [], labels: { 'council-1': 'Retained label' } } });
    expect(await call('autotitleCouncils', { councilIds: ['invalid-id'] })).toEqual({ ok: true, value: { results: [], labels: null } });
    expect((await call('getCouncilLabels')).value).toEqual({ 'council-1': 'Retained label' });
    expect(await page.evaluate(() => window.expired)).toBe(0);

    const house = path.join(root, 'house'); const alliances = path.join(root, 'alliances');
    expect((await call('setHouseWorkspace', house)).ok).toBe(true);
    expect((await call('setAllianceRoot', alliances)).ok).toBe(true);
    expect((await call('getHouseWorkspace')).value.root).toBe(house);
    expect((await call('getAllianceGrounds')).value.root).toBe(alliances);
    const before = await fs.readdir(house);
    await page.evaluate(token => sessionStorage.setItem('authToken', token), other.token);
    expect(await call('getOperatorName')).toEqual({ ok: true, value: '' });
    expect((await call('getHouseWorkspace')).value.root).toBeNull();
    expect((await call('getAllianceGrounds')).value.root).toBeNull();
    await page.evaluate(() => sessionStorage.setItem('authToken', 'expired-invalid-token'));
    expect((await call('getHouseWorkspace')).value).toEqual(houseEmpty);
    expect((await call('getAllianceGrounds')).value).toEqual(allianceEmpty);
    expect(await page.evaluate(() => window.expired)).toBe(2);
    expect(await call('getOperatorName')).toEqual({ ok: false, name: 'Error', message: 'Could not read the operator name (401)' });
    expect(await call('getRealm')).toEqual({ ok: false, name: 'Error', message: 'Could not read the data realm (401)' });
    expect(await call('autotitleCouncils', { councilIds: [] })).toEqual({ ok: true, value: { results: [], labels: null } });
    expect(await page.evaluate(() => window.expired)).toBe(5);
    expect(titleRequests).toBe(3);
    expect(await fs.readdir(house)).toEqual(before);
    expect(await call('apiCall', 'GET', '/bodies/invalid.json', { strictJson: true })).toMatchObject({ ok: false, name: 'SyntaxError' });
    expect(await call('apiCall', 'GET', '/bodies/invalid.json')).toEqual({ ok: true, value: {} });
    expect(await call('apiCall', 'GET', '/bodies/null.json', { strictJson: true })).toEqual({ ok: true, value: null });
    expect(await fs.readFile(path.join(bodies, 'invalid.json'), 'utf8')).toBe('{');
    expect(errors).toEqual([]);
  } finally {
    await browser?.close(); server?.closeAllConnections();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await vite?.close(); setRealmRoot(previous); setConfig(config);
    if (credentialPath === undefined) delete process.env.NEUMA_PROVIDER_CREDENTIALS_PATH;
    else process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = credentialPath;
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30000);
