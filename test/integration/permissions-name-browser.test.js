// Real identity files → signed HTTP → production permissions rail in Chromium.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { expect, test } from 'vitest';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import permissionsRoutes from '../../backend/routes/permissions-routes.js';
import { fullAuth, writeOwner } from '../helpers/audit-auth.js';

const trueName = Object.freeze({
  chosenName: 'Chosen Reader', genesisName: 'Dawn', houseName: 'Test House',
  fullName: 'Chosen Reader Dawn Test House', lean: 0, soulMark: 'abcdef',
  soulAlias: 'Test Mark', genesisHash: 'a'.repeat(64), notation: 'test', english: 'Test identity',
});
const cases = Object.freeze([
  ['permission-chosen', trueName, 'Chosen Reader'],
  ['permission-full', { chosenName: ' ', fullName: 'Full Reader' }, 'Full Reader'],
  ['permission-missing', null, 'permission-missing'],
  ['permission-malformed', { chosenName: trueName, fullName: [] }, 'permission-malformed'],
  ['permission-unreadable', { ...trueName, chosenName: 'Unreadable Reader' }, 'Unreadable Reader'],
]);

test('ALL BEINGS renders true-name text, including unreadable lanes, and revoke preserves the name contract', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-permissions-name-'));
  const oldRoot = getWorkspacesRoot();
  const oldData = process.env.NEUMA_DATA_ROOT;
  let vite; let server; let browser;
  try {
    process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
    setWorkspacesRoot(path.join(root, 'lanes'));
    const auth = await fullAuth();
    for (const [id, name] of cases) {
      await workspace.create(id);
      await writeOwner(workspace.root, id, auth.address);
      await workspace.writeNeumaDEK(id, 'b'.repeat(64));
      if (name) {
        const identityDir = path.join(workspace.pathFor(id), 'identity');
        await fs.mkdir(identityDir, { recursive: true });
        await fs.writeFile(path.join(identityDir, 'true-name.json'), JSON.stringify(name));
      }
      await workspace.writeToolPolicy(id, { web: { allowed: ['web_search'] } });
    }
    await fs.writeFile(path.join(workspace.pathFor('permission-unreadable'), 'config', 'tool-policy.json'), '{broken');
    const app = express();
    app.use(express.json());
    app.use('/api/v1/permissions', permissionsRoutes);
    vite = await createServer({ configFile: false,
      root: fileURLToPath(new URL('../..', import.meta.url)), cacheDir: path.join(root, 'cache'),
      appType: 'custom', esbuild: { jsx: 'automatic' },
      optimizeDeps: { entries: ['test/fixtures/permissions-name.jsx'], include: ['react', 'react-dom/client', 'react/jsx-runtime'] },
      server: { middlewareMode: true, hmr: false, watch: null },
    });
    app.get('/', (_req, res) => res.type('html').send('<!doctype html><div id="root"></div><script type="module" src="/test/fixtures/permissions-name.jsx"></script>'));
    app.use(vite.middlewares);
    server = http.createServer(app);
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(({ token, address }) => {
      sessionStorage.setItem('authToken', token);
      localStorage.setItem('walletAddress', address);
    }, { token: auth.token, address: auth.address });
    await page.goto(origin);
    await page.locator('.stream-rail-tab').click();
    await page.locator('.perm-row').first().waitFor();
    await page.getByRole('button', { name: 'THIS BEING', exact: true }).click();
    await expect.poll(async () => errors.length ? errors
      : (await page.locator('.perm-beinghead').allTextContents()).sort(), { timeout: 5000 })
      .toEqual(cases.map(([, , name], index) => name + (index === 4 ? '' : '1')).sort());
    expect(await page.locator('.perm-unreadable').last().textContent()).toContain('COULD NOT BE READ');

    const headers = { Authorization: `Bearer ${auth.token}` };
    const house = await fetch(`${origin}/api/v1/permissions`, { headers }).then((res) => res.json());
    expect(house.beings.map(({ name }) => name).sort()).toEqual(cases.map(([, , name]) => name).sort());
    for (const [id, , name] of cases) {
      const response = await fetch(`${origin}/api/v1/permissions/${id}`, { headers });
      expect(response.status).toBe(200);
      expect((await response.json()).name).toBe(name);
    }
    const first = page.locator('.perm-being').filter({ hasText: 'Chosen Reader' });
    await first.getByRole('button', { name: 'REVOKE', exact: true }).click();
    const revoked = page.waitForResponse((res) => res.url().endsWith('/permission-chosen/revoke'));
    await first.getByRole('button', { name: 'TAKE IT BACK', exact: true }).click();
    expect((await (await revoked).json()).record.name).toBe('Chosen Reader');
    await expect.poll(async () => (await workspace.readToolPolicy('permission-chosen')).web.allowed).toEqual([]);
    await first.getByText('NOTHING STANDING — every act still asks.', { exact: true }).waitFor();
    const outsider = await fullAuth();
    expect((await fetch(`${origin}/api/v1/permissions/permission-chosen`, {
      headers: { Authorization: `Bearer ${outsider.token}` },
    })).status).toBe(404);
    expect(errors).toEqual([]);
    await page.screenshot({ path: '/tmp/neuma-permissions-names.png', fullPage: true });
  } finally {
    await browser?.close();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await vite?.close();
    setWorkspacesRoot(oldRoot);
    if (oldData === undefined) delete process.env.NEUMA_DATA_ROOT; else process.env.NEUMA_DATA_ROOT = oldData;
    await fs.rm(root, { recursive: true, force: true });
  }
}, 60000);
