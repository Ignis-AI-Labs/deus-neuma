/* global fetch */
// Real signed HTTP auth, production roster reads, temporary identity records
// and actual browser storage. No ceremony, provider call or model response.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import express from 'express';
import { Wallet } from 'ethers';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { expect, test } from 'vitest';
import { createAuthRouter } from '../../backend/services/auth.js';
import { getWorkspacesRoot, getWitnessesRoot, setWorkspacesRoot, setWitnessesRoot } from '../../core/index.js';
import { getAIWitnessesRoot, setAIWitnessesRoot } from '../../core/identity/ai-witness/ai-witness-service.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import rosterRouter from '../../backend/routes/roster-routes.js';

// impure — metadata fixtures only; no permanent seal or being is created.
const writeWitness = async (root, name, wallet) => {
  const home = path.join(root, 'identities', 'vendor-with-dashes', name);
  const lane = path.join(root, 'lanes', `witness-vendor-with-dashes-${name}`);
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(lane, { recursive: true });
  await fs.writeFile(path.join(home, 'dna.json'), JSON.stringify({
    substrate: { vendor: 'vendor-with-dashes', model: 'offline' },
    genesisSeal: { genesisHash: `sha256:${'a'.repeat(64)}` },
    capturedAt: '2026-09-10T00:00:00.000Z',
  }));
  await fs.writeFile(path.join(lane, 'lane.json'), JSON.stringify({
    kind: 'witness', vendorSlug: 'vendor-with-dashes', chosenName: name,
  }));
  await fs.writeFile(path.join(lane, 'owner.json'), JSON.stringify({ wallet }));
};

test('roster recovery heals the window and shared bindings independently through real browser storage', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-window-recovery-'));
  const oldRoots = [getWorkspacesRoot(), getWitnessesRoot(), getAIWitnessesRoot(), getRealmRoot()];
  let server; let vite; let browser;
  try {
    setRealmRoot(path.join(root, 'realm'));
    setWorkspacesRoot(path.join(root, 'workspaces'));
    setWitnessesRoot(path.join(root, 'lanes'));
    setAIWitnessesRoot(path.join(root, 'identities'));
    await fs.mkdir(path.join(root, 'workspaces'));
    const wallet = Wallet.createRandom();
    await writeWitness(root, 'Window', wallet.address);
    await writeWitness(root, 'Shared', wallet.address);
    const app = express();
    app.use(express.json());
    app.use('/api/v1/auth', createAuthRouter(express));
    app.use('/api/v1/roster', rosterRouter);
    vite = await createServer({ configFile: false,
      root: fileURLToPath(new URL('../..', import.meta.url)),
      cacheDir: path.join(root, 'cache'), appType: 'custom',
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { middlewareMode: true, hmr: false, watch: null },
    });
    app.get('/', (_req, res) => res.type('html').send(`<!doctype html><title>Binding recovery proof</title>
      <script type="module">
        import * as storage from '/frontend/utils/companion-data.js';
        import { recoverRoster } from '/frontend/app/roster-recovery.js';
        import { routeHealthPathFor } from '/frontend/services/route-health.js';
        import { getRosterForBinding } from '/frontend/services/social-channels-client.js';
        window.proof = { storage, recoverRoster, routeHealthPathFor, getRosterForBinding };
        window.expired = 0;
        window.addEventListener('neuma:auth_expired', () => window.expired++);
      </script>`));
    app.use(vite.middlewares);
    server = await new Promise((resolve) => {
      const live = app.listen(0, '127.0.0.1', () => resolve(live));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    expect((await fetch(`${base}/api/v1/roster`)).status).toBe(401);
    const { challenge } = await (await fetch(`${base}/api/v1/auth/challenge?address=${wallet.address}`)).json();
    const verified = await fetch(`${base}/api/v1/auth/verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: wallet.address, challenge, signature: await wallet.signMessage(challenge) }),
    });
    expect(verified.status).toBe(200);
    const { token } = await verified.json();
    browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(base);
    await page.waitForFunction(() => globalThis.proof);
    await page.evaluate(({ token, address }) => {
      globalThis.localStorage.setItem('walletAddress', address);
      globalThis.sessionStorage.setItem('authToken', token);
    }, { token, address: wallet.address });
    const bindingRoster = await page.evaluate(() => globalThis.proof.getRosterForBinding());
    expect(bindingRoster.map(row => ({ name: row.name, kind: row.participantKind }))).toEqual([
      { name: 'Shared', kind: 'witness' }, { name: 'Window', kind: 'witness' },
    ]);
    const result = await page.evaluate(async () => {
      const { storage, recoverRoster, routeHealthPathFor } = globalThis.proof;
      storage.setActiveCompanion({ neumaId: 'witness-vendor-with-dashes-Shared', name: 'Shared' });
      storage.setWindowCompanion({ neumaId: 'witness-vendor-with-dashes-Window', name: 'Window', vessel: 'kept' });
      const before = routeHealthPathFor(storage.resolveBoundCompanion());
      const recovered = await recoverRoster();
      return { before, recovered, bound: storage.resolveBoundCompanion(),
        route: routeHealthPathFor(storage.resolveBoundCompanion()), witnesses: storage.getWitnesses() };
    });
    expect(result.before).toBeNull();
    expect(result.recovered.companion.name).toBe('Shared');
    expect(result.recovered.companion.vendorSlug).toBe('vendor-with-dashes');
    expect(result.witnesses.map((row) => row.name)).toEqual(['Shared', 'Window']);
    expect(result.bound.name).toBe('Window');
    expect(result.bound.vessel).toBe('kept');
    expect(result.route).toBe('/api/v1/witnesses/vendor-with-dashes/Window/health');
    await page.reload();
    await page.waitForFunction(() => globalThis.proof);
    expect(await page.evaluate(async () => {
      const { resolveBoundCompanion } = globalThis.proof.storage;
      return resolveBoundCompanion();
    })).toEqual(result.bound);
    expect(await page.evaluate(async () => {
      globalThis.sessionStorage.setItem('authToken', 'expired-invalid-token');
      try { await globalThis.proof.getRosterForBinding(); return null; }
      catch (error) { return { http: error.http, expired: globalThis.expired }; }
    })).toEqual({ http: 401, expired: 1 });
    await page.evaluate(token => globalThis.sessionStorage.setItem('authToken', token), token);
    await context.setOffline(true);
    expect(await page.evaluate(async () => {
      const { recoverRoster } = globalThis.proof;
      const { resolveBoundCompanion } = globalThis.proof.storage;
      await recoverRoster();
      return resolveBoundCompanion();
    })).toEqual(result.bound);
  } finally {
    await browser?.close();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await vite?.close();
    setWorkspacesRoot(oldRoots[0]);
    setWitnessesRoot(oldRoots[1]);
    setAIWitnessesRoot(oldRoots[2]);
    setRealmRoot(oldRoots[3]);
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30000);
