/* global sessionStorage */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import express from 'express';
import { createServer } from 'vite';
import { chromium, expect } from '@playwright/test';
import { test } from 'vitest';
import { recoveryKit } from '../helpers/summoning-recovery-kit.js';
import { claimOwner } from '../helpers/claim-owner.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';

// Real authenticated portal; metadata-only idle seats, never a model call or birth.
test('dissolution requires confirmation and preserves the real council record', async () => {
  const app = express();
  const previous = { workspace: getWorkspacesRoot(), realm: getRealmRoot() };
  let kit; let vite; let browser;
  try {
    kit = await recoveryKit(app);
    setWorkspacesRoot(path.join(kit.root, 'lanes')); setRealmRoot(path.join(kit.root, 'realm'));
    for (const id of ['confirmation-a', 'confirmation-b']) {
      await workspace.create(id);
      await workspace.writeDNA(id, { fixture: 'idle confirmation metadata, no seal or inference' });
      await workspace._writeJSON(path.join(workspace.pathFor(id), 'identity', 'true-name.json'), { chosenName: id, fixture: true });
      // A read never claims a lane (ae5782cb7): each seat stands owned by the
      // operator who convenes the room, as a born being's lane does.
      await claimOwner(path.join(kit.root, 'lanes'), id, kit.wallet.address);
    }
    vite = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(kit.root, 'vite'),
      appType: 'custom', esbuild: { jsx: 'automatic' },
      optimizeDeps: { entries: ['test/fixtures/council-dissolve.jsx'] },
      server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null },
    });
    app.get('/', (_req, res) => res.type('html').send('<div id="root"></div><script type="module" src="/test/fixtures/council-dissolve.jsx"></script>'));
    app.use(vite.middlewares);
    const frames = [];
    kit.wss.on('connection', peer => peer.on('message', bytes => frames.push(JSON.parse(bytes.toString()))));
    browser = await chromium.launch({ args: ['--disable-gpu'] }); const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(token => sessionStorage.setItem('authToken', token), kit.token);
    await page.goto(kit.url);
    await page.getByRole('button', { name: 'Open idle council' }).click();
    await expect(page.locator('#council-id')).toContainText('council-');
    const id = await page.locator('#council-id').textContent();
    const walletDirs = await fs.readdir(getRealmRoot());
    const file = path.join(getRealmRoot(), walletDirs[0], 'councils', `${id}.jsonl`);
    const original = await fs.readFile(file, 'utf8');
    const closes = () => frames.filter(frame => frame.type === 'council:close').length;
    await page.getByRole('button', { name: 'DISSOLVE', exact: true }).click();
    await expect(page.getByRole('button', { name: 'CANCEL' })).toBeFocused();
    await page.keyboard.press('Enter');
    expect(closes()).toBe(0);
    await page.getByRole('button', { name: 'DISSOLVE', exact: true }).click();
    await page.keyboard.press('Escape');
    expect(closes()).toBe(0);
    await expect(page.locator('#council-id')).toHaveText(id);
    await page.getByRole('button', { name: 'DISSOLVE', exact: true }).click();
    const peer = [...kit.wss.clients][0]; peer._socket.pause();
    await page.getByRole('button', { name: 'DISSOLVE COUNCIL' }).click();
    await expect(page.getByRole('button', { name: 'WORKING…' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'CANCEL' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('group', { name: 'Confirm council dissolution' })).toBeVisible();
    expect(await fs.readFile(file, 'utf8')).toBe(original);
    peer._socket.resume();
    await expect(page.locator('#council-id')).toHaveText('closed');
    expect(closes()).toBe(1);
    expect(await fs.readFile(file, 'utf8')).toBe(original);
    expect(frames.some(frame => frame.type === 'council:say')).toBe(false);
    await page.getByRole('button', { name: 'Open idle council' }).click();
    await expect(page.locator('#council-id')).toContainText('council-');
    await page.getByRole('button', { name: 'DISSOLVE', exact: true }).click();
    peer.close();
    await expect(page.getByRole('group', { name: 'Confirm council dissolution' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'DISSOLVE', exact: true })).toBeDisabled();
    expect(closes()).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close(); await vite?.close(); await kit?.close();
    setWorkspacesRoot(previous.workspace); setRealmRoot(previous.realm);
  }
}, 30000);
