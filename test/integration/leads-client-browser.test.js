/* global window, sessionStorage */
// Real Chromium, signed auth and disposable lead ledger.
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

test('lead client persists CRUD and surfaces real auth/validation failures', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'leads-browser-'));
  const prior = process.env.NEUMA_LEAD_LEDGER_PATH;
  process.env.NEUMA_LEAD_LEDGER_PATH = path.join(root, 'leads.json');
  // The operator's house — its ledger — lands in tmp.
  const oldRealm = getRealmRoot();
  setRealmRoot(path.join(root, 'realm'));
  let browser; let server; let vite;
  try {
    const auth = await fullAuth();
    const ledgerFile = path.join(root, 'realm', auth.address.toLowerCase(), 'offices', 'marketing', 'lead-ledger.json');
    const app = express();
    app.use(express.json());
    app.use('/api/v1/leads', (await import('../../backend/routes/lead-routes.js')).default);
    vite = await createServer({ configFile: false, root: fileURLToPath(new URL('../..', import.meta.url)),
      cacheDir: path.join(root, 'vite'), appType: 'custom',
      server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null }, optimizeDeps: { noDiscovery: true } });
    app.get('/', (_req, res) => res.type('html').send('<script type="module">import * as client from "/frontend/services/leads-client.js"; window.client=client; window.expired=0; window.addEventListener("neuma:auth_expired",()=>window.expired++);</script>'));
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

    expect((await invoke('getLeadBoard')).error).toBe('Not authenticated.');
    expect((await invoke('captureLead', [{ name: 'No auth' }])).error).toBe('Not authenticated.');
    await expect(fs.access(ledgerFile)).rejects.toMatchObject({ code: 'ENOENT' });
    await page.evaluate((token) => sessionStorage.setItem('authToken', token), auth.token);
    expect((await invoke('getLeadBoard')).result.leads).toEqual([]);
    const invalid = await invoke('captureLead', [{}]);
    expect(invalid).toMatchObject({ error: 'a lead needs a name or a way to reach them', http: 400 });
    const lead = (await invoke('captureLead', [{ name: 'Temporary prospect', channelId: 'other', note: 'Initial note' }])).result.lead;
    expect(lead.touches[0].by.toLowerCase()).toBe(auth.address.toLowerCase());
    const changed = (await invoke('touchLead', [lead.id, { status: 'qualified', note: 'Reviewed locally' }])).result.lead;
    expect(changed.status).toBe('qualified');
    expect(changed.touches.at(-1).note).toBe('Reviewed locally');
    expect((await invoke('getLeadBoard')).result.board.qualified).toEqual([changed]);
    expect(await fs.readFile(ledgerFile, 'utf8')).toContain('Reviewed locally');
    expect((await invoke('removeLead', [lead.id])).result.removed).toBeTruthy();
    expect((await invoke('getLeadBoard')).result.leads).toEqual([]);
    expect(await invoke('removeLead', [lead.id])).toMatchObject({ http: 404, error: 'no such lead' });
    await page.evaluate(() => sessionStorage.setItem('authToken', 'expired-proof'));
    expect((await invoke('getLeadBoard')).http).toBe(401);
    expect(await page.evaluate(() => window.expired)).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await vite?.close();
    setRealmRoot(oldRealm);
    if (prior === undefined) delete process.env.NEUMA_LEAD_LEDGER_PATH;
    else process.env.NEUMA_LEAD_LEDGER_PATH = prior;
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30_000);
