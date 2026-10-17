/** Signed HTTP over actual private ground and image bytes; no publish/inference. */
import { afterEach, beforeEach, expect, test } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import socialRoutes from '../../backend/routes/social-channel-routes.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { setHouseWorkspace } from '../../backend/services/house-workspace.js';
import { fullAuth, writeOwner } from '../helpers/audit-auth.js';
import { solidPng } from '../helpers/image-fixtures.js';

let root, cards, auth, server, base, priorRealm, priorLanes, app;
const png = solidPng([30, 90, 120], 12, 12);
const lane = 'preview-fixture';
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'intent-preview-'));
  priorRealm = getRealmRoot(); priorLanes = getWorkspacesRoot();
  setRealmRoot(path.join(root, 'realm'));
  setWorkspacesRoot(path.join(root, 'lanes'));
  auth = await fullAuth();
  await writeOwner(path.join(root, 'lanes'), lane, auth.address);
  await setHouseWorkspace(auth.address, path.join(root, 'house'));
  cards = path.join(root, 'house', 'workspaces', lane, 'cards');
  await fs.mkdir(cards, { recursive: true });
  await fs.writeFile(path.join(cards, 'card.png'), png);
  app = express();
  app.use('/api/v1/social-channels', socialRoutes);
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1/social-channels/intent-media`;
});
afterEach(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  setRealmRoot(priorRealm); setWorkspacesRoot(priorLanes);
  await fs.rm(root, { recursive: true, force: true });
});
const preview = (name = 'card.png', target = lane, token = auth.token) => fetch(
  `${base}?${new URLSearchParams({ lane: target, name })}`,
  { headers: token ? { Authorization: `Bearer ${token}` } : {} },
);

test('signed owner receives exact image bytes with private caching; anonymous request is refused', async () => {
  const res = await preview();
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('image/png');
  expect(res.headers.get('cache-control')).toBe('private, no-store');
  expect(Buffer.from(await res.arrayBuffer())).toEqual(png);
  expect((await preview('card.png', lane, '')).status).toBe(401);
});

test('another signed wallet and unclaimed lane cannot preview or create ground', async () => {
  const other = await fullAuth();
  expect((await preview('card.png', lane, other.token)).status).toBe(403);
  expect((await preview('card.png', 'unclaimed')).status).toBe(404);
  await expect(fs.stat(path.join(root, 'house', 'workspaces', 'unclaimed'))).rejects.toMatchObject({ code: 'ENOENT' });
});

test('a file symlink cannot expose image bytes from outside the cards directory', async () => {
  await fs.writeFile(path.join(root, 'outside.png'), png);
  await fs.symlink(path.join(root, 'outside.png'), path.join(cards, 'escape.png'));
  const res = await preview('escape.png');
  expect(res.status).toBe(404);
  expect(await res.text()).not.toContain(root);
});

test('a symlinked cards directory cannot turn an outside directory into preview authority', async () => {
  const outside = path.join(root, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'card.png'), png);
  await fs.rm(cards, { recursive: true });
  await fs.symlink(outside, cards);
  expect((await preview()).status).toBe(404);
});

test('missing cards stay absent, and traversal or non-image bytes are refused', async () => {
  expect((await preview('../card.png')).status).toBe(400);
  await fs.writeFile(path.join(cards, 'text.png'), 'this is not an image');
  expect((await preview('text.png')).status).toBe(404);
  await fs.rm(cards, { recursive: true });
  expect((await preview()).status).toBe(404);
  await expect(fs.stat(cards)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('browser chip releases preview URLs and shows actual missing-image failures', async () => {
  const { build } = await import('vite');
  const { chromium } = await import('@playwright/test');
  // Only the component boundary is mounted. Real React, auth, fetch, images
  // and blob lifetimes run unchanged; this is not a portal approval test.
  const bundle = await build({ configFile: false, root: process.cwd(), logLevel: 'error',
    esbuild: { jsx: 'automatic' },
    build: { write: false, outDir: path.join(root, 'bundle'),
      rollupOptions: { input: path.resolve('test/fixtures/approval-chip-entry.jsx') } },
  });
  for (const file of bundle.output) {
    app.get(`/${file.fileName}`, (req, res) => res.type(path.extname(file.fileName)).send(file.type === 'chunk' ? file.code : file.source));
  }
  const entry = bundle.output.find((file) => file.type === 'chunk' && file.isEntry).fileName;
  const styles = bundle.output.filter((file) => file.fileName.endsWith('.css'))
    .map((file) => `<link rel="stylesheet" href="/${file.fileName}">`).join('');
  app.get('/proof', (req, res) => res.send(`<div id="root"></div>${styles}<script type="module" src="/${entry}"></script>`));
  const browser = await chromium.launch({ args: ['--disable-gpu'] });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(new URL('/proof', base).href);
    await page.waitForFunction(() => typeof window.showApproval === 'function')
      .catch((error) => { throw new Error(`${error.message}; browser errors: ${pageErrors.join('; ')}`); });
    await page.evaluate(({ token, lane }) => {
      sessionStorage.setItem('authToken', token);
      window.showApproval({ id: 'preview', phase: 'pending', tool: 'intents/social.post', lane, media: ['card.png'] });
    }, { token: auth.token, lane });
    await page.waitForFunction(() => document.querySelector('.approval-media img')?.naturalWidth === 12);
    const url = await page.locator('.approval-media img').getAttribute('src');
    await page.evaluate(() => window.showApproval({ id: 'preview', phase: 'resolved', tool: 'intents/social.post', decision: 'deny' }));
    await page.waitForFunction(() => document.querySelector('.approval-chip.resolved'));
    expect(await page.evaluate(async (src) => fetch(src).then(() => true, () => false), url)).toBe(false);
    await page.evaluate((lane) => window.showApproval({ id: 'next', phase: 'pending', tool: 'intents/social.post', lane, media: ['missing.png'] }), lane);
    await page.waitForFunction(() => document.body.textContent.includes('Preview unavailable: missing.png'));
    expect(await page.locator('.approval-media img').count()).toBe(0);
  } finally {
    await browser.close();
  }
}, 30000);
