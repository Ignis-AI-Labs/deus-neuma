/* global window, sessionStorage, document, Image */
// Real Chromium, signed auth, root grant storage and native PNG decoding.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { fileURLToPath, URL } from 'node:url';
import express from 'express';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { expect, test } from 'vitest';
import { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { fullAuth } from '../helpers/audit-auth.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('gallery client grants, lists, displays and revokes a real temporary root', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gallery-client-browser-'));
  const keys = ['NEUMA_DATA_ROOT', 'NEUMA_GALLERY_ROOTS_PATH', 'COMFYUI_DATA_DIR', 'COMFYUI_OUTPUT_DIR'];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const oldRoot = getWorkspacesRoot();
  let browser; let server; let vite;
  try {
    process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
    process.env.NEUMA_GALLERY_ROOTS_PATH = path.join(root, 'roots.json');
    process.env.COMFYUI_DATA_DIR = path.join(root, 'comfy');
    process.env.COMFYUI_OUTPUT_DIR = path.join(root, 'comfy', 'output');
    setWorkspacesRoot(path.join(root, 'lanes'));
    const folder = path.join(root, 'pictures');
    await fs.mkdir(folder);
    await fs.writeFile(path.join(folder, 'proof & image.png'), PNG);
    const auth = await fullAuth();
    const app = express();
    app.use(express.json());
    app.use('/api/v1/gallery', (await import('../../backend/routes/gallery-routes.js')).default);
    vite = await createServer({ configFile: false, root: fileURLToPath(new URL('../..', import.meta.url)),
      cacheDir: path.join(root, 'vite'), appType: 'custom',
      server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null }, optimizeDeps: { noDiscovery: true } });
    app.get('/', (_req, res) => res.type('html').send('<script type="module">import * as client from "/frontend/services/gallery-client.js"; window.client=client; window.expired=0; window.addEventListener("neuma:auth_expired",()=>window.expired++);</script>'));
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
    expect((await invoke('getRoots')).error).toBe('Not authenticated.');
    expect((await invoke('addRoot', [folder])).http).toBe(401);
    await expect(fs.access(process.env.NEUMA_GALLERY_ROOTS_PATH)).rejects.toMatchObject({ code: 'ENOENT' });
    await page.evaluate((token) => sessionStorage.setItem('authToken', token), auth.token);
    expect((await invoke('addRoot', ['relative-path'])).error).toBe('a root must be an absolute path');
    const added = await invoke('addRoot', [folder, 'Temporary pictures']);
    const granted = added.result.roots.find((entry) => entry.dir === folder);
    expect(granted.label).toBe('Temporary pictures');
    expect((await invoke('getRoots')).result.roots.some((entry) => entry.id === granted.id)).toBe(true);
    const items = (await invoke('getItems', [granted.id])).result.items;
    expect(items).toHaveLength(1);
    const dimensions = await page.evaluate((item) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve([image.naturalWidth, image.naturalHeight]);
      image.onerror = () => reject(new Error('Gallery image did not decode'));
      image.src = window.client.fileSrc(item);
      document.body.append(image);
    }), items[0]);
    expect(dimensions).toEqual([1, 1]);
    expect((await invoke('removeRoot', ['comfy-output'])).http).toBe(400);
    expect((await invoke('removeRoot', [granted.id])).result.roots.some((entry) => entry.id === granted.id)).toBe(false);
    const denied = await page.evaluate(async (item) => (await window.fetch(window.client.fileSrc(item), { cache: 'no-store' })).status, items[0]);
    expect(denied).toBe(404);
    expect(await fs.readFile(path.join(folder, 'proof & image.png'))).toEqual(PNG);
    await page.evaluate(() => sessionStorage.setItem('authToken', 'expired-proof'));
    expect((await invoke('getRoots')).http).toBe(401);
    expect(await page.evaluate(() => window.expired)).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await vite?.close();
    setWorkspacesRoot(oldRoot);
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30_000);
