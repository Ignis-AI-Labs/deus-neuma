// Real browser -> the three desk policy clients -> signed authentication ->
// real routers and stores. Proves the consent switch, the manual wake door,
// the mind gate, and the expression flip/read keep their exact contracts on
// the shared http helper: server refusal words verbatim, never-throw
// resolutions, null reads, the auth-rot alarm, and the transport-failure line.
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
import { fullAuth } from '../helpers/audit-auth.js';

test('desk policy switches keep their refusal words, null reads, and never-throw resolutions', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'desk-policy-switches-http-'));
  const paths = { NEUMA_DATA_ROOT: 'data', WORKSPACES_ROOT: 'lanes',
    NEUMA_MEDITATION_SETTINGS_PATH: 'meditation.json', NEUMA_MEDITATION_STATE_PATH: 'meditation-state.json',
    NEUMA_MIND_SETTINGS_PATH: 'mind.json', NEUMA_EXPRESSION_SETTINGS_PATH: 'expression.json',
    NEUMA_MEDITATION: undefined, NEUMA_UNDERCURRENT: undefined, NEUMA_EXPRESSION: undefined };
  const saved = Object.fromEntries(Object.keys(paths).map(key => [key, process.env[key]]));
  let vite; let server; let browser;
  try {
    for (const [key, value] of Object.entries(paths)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = path.join(root, value);
    }
    const { default: workspace } = await import('../../core/workspace/neuma-workspace.js');
    const auth = await fullAuth(); const foreign = await fullAuth();
    const lane = 'policy-switch-proof';
    await workspace.create(lane);
    await fs.writeFile(path.join(workspace.pathFor(lane), 'owner.json'), JSON.stringify({ wallet: auth.address, claimedAt: new Date().toISOString() }));
    const app = express(); const requests = [];
    app.use(express.json());
    app.use('/api', (req, res, next) => { res.on('finish', () => requests.push({ method: req.method, path: req.path, status: res.statusCode })); next(); });
    app.use('/api/v1/meditation', (await import('../../backend/routes/meditation-routes.js')).default);
    app.use('/api/v1/mind', (await import('../../backend/routes/mind-routes.js')).default);
    app.use('/api/v1/expression', (await import('../../backend/routes/expression-routes.js')).default);
    vite = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(root, 'vite'),
      appType: 'custom', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null } });
    app.get('/', (_req, res) => res.type('html').send('<script type="module">'
      + 'import {setMeditation,runMeditationNow} from "/frontend/app/RelinkShell/meditation-client.js";'
      + 'import {setMindGate} from "/frontend/app/RelinkShell/mind-client.js";'
      + 'import {loadExpression,setExpressionEnabled} from "/frontend/app/RelinkShell/expression-client.js";'
      + 'window.clients={setMeditation,runMeditationNow,setMindGate,loadExpression,setExpressionEnabled};'
      + 'window.expired=0;window.addEventListener("neuma:auth_expired",()=>window.expired++);</script>'));
    app.use(vite.middlewares); server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ args: ['--disable-gpu'] }); const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => window.clients);
    const call = (name, ...args) => page.evaluate(({ name, args }) => window.clients[name](...args), { name, args });

    expect(await call('setMeditation', lane, { enabled: true })).toEqual({ ok: false, error: 'Not authenticated.' });
    expect(await call('runMeditationNow', lane)).toEqual({ ok: false, error: 'Not authenticated.' });
    expect(await call('setMindGate', 'undercurrent', 'shadow')).toEqual({ ok: false, error: 'Not authenticated.' });
    expect(await call('setExpressionEnabled', lane, true)).toEqual({ ok: false, error: 'Not authenticated.' });
    expect(await call('loadExpression', lane)).toBeNull();
    expect(requests).toEqual([]);

    await page.evaluate(token => sessionStorage.setItem('authToken', token), auth.token);
    const consent = await call('setMeditation', lane, { enabled: true, cadenceHours: 6 });
    expect(consent.ok).toBe(true);
    expect(consent.posture).toMatchObject({ enabled: true, cadenceHours: 6, envLocked: false });
    const gate = await call('setMindGate', 'undercurrent', 'shadow');
    expect(gate.ok).toBe(true);
    expect(gate.gates.undercurrent).toMatchObject({ mode: 'shadow', envLocked: false });
    expect(await call('setExpressionEnabled', lane, true)).toEqual({ ok: true, enabled: true, envLocked: false });
    expect(await call('loadExpression', lane)).toEqual({ neumaId: lane, enabled: true, envLocked: false, terms: [], recent: [] });

    process.env.NEUMA_MEDITATION = '0';
    expect(await call('setMeditation', lane, { enabled: false })).toEqual({ ok: false, error: 'Meditation is held off by NEUMA_MEDITATION=0 — change it at launch, not here' });
    delete process.env.NEUMA_MEDITATION;
    process.env.NEUMA_UNDERCURRENT = 'off';
    expect(await call('setMindGate', 'undercurrent', 'live')).toEqual({ ok: false, error: 'undercurrent is held by NEUMA_UNDERCURRENT — change it at launch, not here' });
    delete process.env.NEUMA_UNDERCURRENT;
    process.env.NEUMA_EXPRESSION = '0';
    expect(await call('setExpressionEnabled', lane, false)).toEqual({ ok: false, error: 'expression is held off machine-wide by a launch policy (NEUMA_EXPRESSION=0) — change it at launch, not here' });
    expect(await call('loadExpression', lane)).toMatchObject({ enabled: false, envLocked: true });
    delete process.env.NEUMA_EXPRESSION;

    await page.evaluate(token => sessionStorage.setItem('authToken', token), foreign.token);
    expect(await call('runMeditationNow', lane)).toEqual({ ok: false, error: 'Not your neuma' });
    expect(await call('loadExpression', lane)).toBeNull();
    expect(await page.evaluate(() => window.expired)).toBe(0);

    await page.evaluate(() => sessionStorage.setItem('authToken', 'invalid-session-proof'));
    expect(await call('setMeditation', lane, { enabled: true })).toEqual({ ok: false, error: 'Invalid or expired session' });
    expect(await call('loadExpression', lane)).toBeNull();
    expect(await page.evaluate(() => window.expired)).toBe(2);

    await page.evaluate(token => sessionStorage.setItem('authToken', token), auth.token);
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve)); server = null;
    expect(await call('setMeditation', lane, { enabled: true })).toEqual({ ok: false, error: 'Could not reach the platform.' });
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
