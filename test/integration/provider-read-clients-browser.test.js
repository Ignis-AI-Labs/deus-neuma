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
import { loadConfig, _resetConfig } from '../../backend/config.js';
import { getConfig, setConfig } from '../../backend/services/llm-provider.js';
import { fullAuth } from '../helpers/audit-auth.js';

test('provider reads distinguish unavailable models from expired-auth uncertainty', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-read-'));
  const keys = ['LM_STUDIO_URL', 'LM_STUDIO_API_KEY', 'NEUMA_SUBSTRATE_CLAIM_DIR', 'LLAMA_SERVER_URL', 'LLAMA_SERVER_BIN', 'LLAMA_SERVER_MODEL', 'LLAMA_SERVER_MMPROJ', 'SUBSTRATE_MODEL', 'SUBSTRATE_CONTEXT_LENGTH'];
  const saved = keys.map(key => process.env[key]); const config = getConfig();
  let vite; let server; let browser;
  try {
    const auth = await fullAuth();
    const app = express(); app.use(express.json());
    server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    process.env.NEUMA_SUBSTRATE_CLAIM_DIR = path.join(root, 'claims');
    await fs.mkdir(process.env.NEUMA_SUBSTRATE_CLAIM_DIR);
    process.env.LLAMA_SERVER_URL = origin;
    process.env.LLAMA_SERVER_BIN = ''; process.env.LLAMA_SERVER_MODEL = ''; process.env.LLAMA_SERVER_MMPROJ = '';
    delete process.env.SUBSTRATE_MODEL; process.env.SUBSTRATE_CONTEXT_LENGTH = '4096';
    process.env.LM_STUDIO_URL = `${origin}/no-model-here`; process.env.LM_STUDIO_API_KEY = '';
    setConfig({ provider: 'lm-studio', endpoint: process.env.LM_STUDIO_URL, model: '', apiKey: '' });
    loadConfig({ NODE_ENV: 'test', PORT: String(server.address().port), FRONTEND_PORT: String(server.address().port) });
    app.use('/api/v1', (await import('../../backend/routes/llm-routes.js')).default);
    vite = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(root, 'vite'),
      appType: 'custom', server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null }, optimizeDeps: { noDiscovery: true } });
    app.get('/', (_req, res) => res.type('html').send('<script type="module">import {getModelInfo} from "/frontend/services/llm-presets.js"; import {getSubstrateHealth} from "/frontend/services/substrate-health.js"; import {getIgnitionStatus} from "/frontend/services/substrate-ignition.js"; import {substrateSeesImages} from "/frontend/services/attachments-client.js"; window.clients={getModelInfo,getSubstrateHealth,getIgnitionStatus,substrateSeesImages}; window.expired=0; window.addEventListener("neuma:auth_expired",()=>window.expired++);</script>'));
    app.use(vite.middlewares);
    browser = await chromium.launch({ args: ['--disable-gpu'] }); const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin); await page.waitForFunction(() => window.clients);
    const call = name => page.evaluate(name => window.clients[name](), name);
    expect(await call('getIgnitionStatus')).toBeNull();
    expect(await call('substrateSeesImages')).toBeNull();
    expect(await call('getModelInfo')).toBeNull();
    expect(await call('getSubstrateHealth')).toEqual({ reachable: null, standby: false });
    expect(await page.evaluate(() => window.expired)).toBe(0);
    await page.evaluate(token => sessionStorage.setItem('authToken', token), auth.token);
    // Both real provider implementations reach the app's native missing-route 404.
    expect(await call('getModelInfo')).toEqual({ model: 'Not Connected', contextLength: 'Unknown' });
    expect(await call('getSubstrateHealth')).toEqual({ reachable: false, standby: false, provider: 'lm-studio', model: null });
    expect(await call('substrateSeesImages')).toBe(false);
    setConfig({ provider: 'llama-server' });
    // Invalid present-but-empty launch settings produce a real backend 500.
    expect(await call('getIgnitionStatus')).toBeNull();
    expect(await page.evaluate(() => window.expired)).toBe(0);
    delete process.env.LLAMA_SERVER_BIN; delete process.env.LLAMA_SERVER_MODEL; delete process.env.LLAMA_SERVER_MMPROJ;
    expect(await call('getIgnitionStatus')).toEqual({ available: false, target: '', targetLoaded: false, igniting: null, lastError: null, loaded: [] });
    expect(await fs.readdir(process.env.NEUMA_SUBSTRATE_CLAIM_DIR)).toEqual([]);
    await page.evaluate(() => sessionStorage.setItem('authToken', 'expired-invalid-token'));
    expect(await call('getIgnitionStatus')).toBeNull();
    expect(await call('substrateSeesImages')).toBeNull();
    expect(await call('getModelInfo')).toBeNull();
    expect(await call('getSubstrateHealth')).toEqual({ reachable: null, standby: false });
    expect(await page.evaluate(() => window.expired)).toBe(4);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close(); server?.closeAllConnections();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await vite?.close(); setConfig(config); _resetConfig();
    keys.forEach((key, i) => { if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i]; });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30000);
