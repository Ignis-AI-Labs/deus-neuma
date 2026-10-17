/* global window, sessionStorage */
// Real Chromium, signed auth and disposable campaign stores.
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

test('campaign client preserves campaigns, files, designation and auth boundaries', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'campaign-browser-'));
  const keys = ['NEUMA_CAMPAIGNS_PATH', 'NEUMA_CMO_PATH'];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const oldRoot = getWorkspacesRoot();
  process.env.NEUMA_CAMPAIGNS_PATH = path.join(root, 'campaigns.json');
  process.env.NEUMA_CMO_PATH = path.join(root, 'cmo.json');
  setWorkspacesRoot(path.join(root, 'lanes'));
  // The operator's house — its bench and seat — lands in tmp.
  const oldRealm = getRealmRoot();
  setRealmRoot(path.join(root, 'realm'));
  let browser; let server; let vite;
  try {
    const auth = await fullAuth();
    const stranger = await fullAuth();
    const house = (...parts) => path.join(root, 'realm', auth.address.toLowerCase(), ...parts);
    const benchFile = house('offices', 'marketing', 'marketing-campaigns.json');
    const seatFile = house('house-cmo.json');
    const lane = 'campaign-test';
    await workspace.create(lane);
    await writeOwner(getWorkspacesRoot(), lane, auth.address);
    const app = express();
    app.use(express.json());
    app.use('/api/v1/campaigns', (await import('../../backend/routes/campaign-routes.js')).default);
    vite = await createServer({ configFile: false, root: fileURLToPath(new URL('../..', import.meta.url)),
      cacheDir: path.join(root, 'vite'), appType: 'custom',
      server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true } });
    app.get('/', (_req, res) => res.type('html').send('<script type="module">import * as client from "/frontend/services/campaigns-client.js"; window.client=client; window.expired=0; window.addEventListener("neuma:auth_expired",()=>window.expired++);</script>'));
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

    expect((await invoke('getCampaigns')).error).toBe('Not authenticated.');
    expect((await invoke('createCampaign', [{ name: 'No auth' }])).error).toBe('Not authenticated.');
    await expect(fs.access(benchFile)).rejects.toMatchObject({ code: 'ENOENT' });
    await page.evaluate((token) => sessionStorage.setItem('authToken', token), auth.token);
    expect((await invoke('getCampaigns')).result.campaigns).toEqual([]);
    expect((await invoke('createCampaign', [{}])).http).toBe(400);
    const campaign = (await invoke('createCampaign', [{ name: 'Temporary campaign', brand: 'Test' }])).result.campaign;
    const changed = (await invoke('updateCampaign', [campaign.id, { status: 'paused', notes: 'Local review' }])).result.campaign;
    expect(changed).toMatchObject({ status: 'paused', notes: 'Local review' });
    expect((await invoke('getCampaigns')).result.campaigns).toEqual([changed]);
    expect(await fs.readFile(benchFile, 'utf8')).toContain('Local review');
    const brief = path.join(root, 'brief.md');
    await fs.writeFile(brief, 'Temporary brief');
    const attached = (await invoke('attachCampaignFile', [campaign.id, brief])).result.campaign;
    expect(attached.sharedFiles).toHaveLength(1);
    expect(attached.sharedFiles[0].path).toBe(await fs.realpath(brief));
    expect(attached.sharedFiles[0].addedBy.toLowerCase()).toBe(auth.address.toLowerCase());
    const forbidden = path.join(root, '.env');
    await fs.writeFile(forbidden, 'NON_SECRET_TEST_MARKER=1');
    expect((await invoke('attachCampaignFile', [campaign.id, forbidden])).http).toBe(403);
    expect((await invoke('detachCampaignFile', [campaign.id, brief])).result.campaign.sharedFiles).toEqual([]);
    expect(await fs.readFile(brief, 'utf8')).toBe('Temporary brief');
    expect((await invoke('getCmo')).result.cmo).toBeNull();
    expect((await invoke('setCmo', [''])).http).toBe(400);
    await page.evaluate((token) => sessionStorage.setItem('authToken', token), stranger.token);
    expect((await invoke('setCmo', [lane])).http).toBe(403);
    await expect(fs.access(seatFile)).rejects.toMatchObject({ code: 'ENOENT' });
    await page.evaluate((token) => sessionStorage.setItem('authToken', token), auth.token);
    const cmo = (await invoke('setCmo', [lane])).result.cmo;
    expect(cmo.laneId).toBe(lane);
    expect((await invoke('getCmo')).result.cmo).toEqual(cmo);
    expect(JSON.parse(await fs.readFile(seatFile, 'utf8'))).toEqual(cmo);
    expect(await fs.readFile(path.join(workspace.pathFor(lane), 'marketing/playbook.md'), 'utf8')).toContain('CMO Playbook');
    expect((await invoke('clearCmo')).result.cleared).toBe(true);
    expect((await invoke('getCmo')).result.cmo).toBeNull();
    expect((await invoke('removeCampaign', [campaign.id])).result.removed).toBeTruthy();
    expect((await invoke('getCampaigns')).result.campaigns).toEqual([]);
    expect(await invoke('removeCampaign', [campaign.id])).toMatchObject({ http: 404, error: 'no such campaign' });
    await page.evaluate(() => sessionStorage.setItem('authToken', 'expired-proof'));
    expect((await invoke('getCampaigns')).http).toBe(401);
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
