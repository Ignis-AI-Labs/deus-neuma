/* global window, sessionStorage */
// The substrate ignite client (substrate-client.js igniteSubstrate) proven
// through a REAL browser against the REAL llm router (RULE 0 — no mocks):
// the unauthenticated bail with zero requests, the two pre-ignition refusals
// answered in the server's own words, and the unreachable-platform line — the
// never-throw idiom holds at every step. The IGNITE_REFUSALS legs (busy /
// unowned) come only from a supervised rig mid-generation and stay Founder-gated
// with the rest of the live ignition lane (no LIVE_IGNITION here, per the
// family brief); every call in this test refuses BEFORE the lms CLI or any
// spawn is touched, which the request log proves.
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

test('substrate ignite client keeps its refusal grammar and never-throw idiom', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'substrate-ignite-http-'));
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
    delete process.env.LLAMA_SERVER_BIN; delete process.env.LLAMA_SERVER_MODEL; delete process.env.LLAMA_SERVER_MMPROJ;
    delete process.env.SUBSTRATE_MODEL; process.env.SUBSTRATE_CONTEXT_LENGTH = '4096';
    process.env.LM_STUDIO_URL = `${origin}/no-model-here`; process.env.LM_STUDIO_API_KEY = '';
    setConfig({ provider: 'lm-studio', endpoint: process.env.LM_STUDIO_URL, model: '', apiKey: '' });
    loadConfig({ NODE_ENV: 'test', PORT: String(server.address().port), FRONTEND_PORT: String(server.address().port) });
    const requests = [];
    app.use('/api', (req, res, next) => { res.on('finish', () => requests.push({ method: req.method, status: res.statusCode })); next(); });
    app.use('/api/v1', (await import('../../backend/routes/llm-routes.js')).default);
    vite = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(root, 'vite'),
      appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true } });
    app.get('/', (_req, res) => res.type('html').send('<script type="module">'
      + 'import {igniteSubstrate} from "/frontend/app/RelinkShell/substrate-client.js";'
      + 'window.ignite=igniteSubstrate;'
      + 'window.expired=0; window.addEventListener("neuma:auth_expired",()=>window.expired++);'
      + '</script>'));
    app.use(vite.middlewares);
    browser = await chromium.launch({ args: ['--disable-gpu'] }); const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin); await page.waitForFunction(() => window.ignite);

    // Unauthenticated: the bail is local; nothing touches the wire.
    expect(await page.evaluate(() => window.ignite())).toEqual({ ok: false, error: 'Not authenticated.' });
    expect(requests).toEqual([]);

    await page.evaluate(token => sessionStorage.setItem('authToken', token), auth.token);
    // No target configured anywhere — the route refuses in its own words.
    expect(await page.evaluate(() => window.ignite())).toEqual({
      ok: false, error: 'No substrate model configured — set SUBSTRATE_MODEL in .env or pass { model }',
    });
    // A shell-meaningful key is refused before the CLI is ever touched.
    expect(await page.evaluate(() => window.ignite('x; rm -rf /'))).toEqual({ ok: false, error: 'Invalid model key' });
    expect(requests.map(r => [r.method, r.status])).toEqual([['POST', 400], ['POST', 400]]);
    expect(await fs.readdir(process.env.NEUMA_SUBSTRATE_CLAIM_DIR)).toEqual([]);

    // A dead session is a plain refusal here: this site keeps a manual
    // failure-in-body round-trip (IGNITE_REFUSALS keys off the answer body's
    // `status`), so the apiCall auth-rot alarm does not ride it.
    await page.evaluate(() => sessionStorage.setItem('authToken', 'invalid-session-proof'));
    expect(await page.evaluate(() => window.ignite())).toEqual({ ok: false, error: 'Invalid or expired session' });
    expect(await page.evaluate(() => window.expired)).toBe(0);

    // The platform gone: the never-throw line.
    await page.evaluate(token => sessionStorage.setItem('authToken', token), auth.token);
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    expect(await page.evaluate(() => window.ignite())).toEqual({ ok: false, error: 'Could not reach the platform.' });
    expect(errors).toEqual([]);
  } finally {
    await browser?.close(); server?.closeAllConnections();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await vite?.close(); setConfig(config); _resetConfig();
    keys.forEach((key, i) => { if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i]; });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30_000);
