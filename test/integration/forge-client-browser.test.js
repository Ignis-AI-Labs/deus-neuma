/* global window, sessionStorage */
// Real Chromium, signed auth and image/review files; no engine or inference.
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
import { collectOutputs } from '../../backend/services/image-forge/image-store.js';
import { Buffer } from 'node:buffer';
import { fullAuth, writeOwner } from '../helpers/audit-auth.js';

test('forge client grades real image records and preserves ownership/auth boundaries', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-client-browser-'));
  const keys = ['NEUMA_DATA_ROOT', 'COMFYUI_REVIEW_LOG_PATH', 'COMFYUI_ATTEMPT_LOG_PATH'];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const oldRoot = getWorkspacesRoot();
  let browser; let server; let vite;
  try {
    process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
    process.env.COMFYUI_REVIEW_LOG_PATH = path.join(root, 'reviews.jsonl');
    process.env.COMFYUI_ATTEMPT_LOG_PATH = path.join(root, 'attempts.jsonl');
    setWorkspacesRoot(path.join(root, 'lanes'));
    const auth = await fullAuth();
    const stranger = await fullAuth();
    const id = 'forge-client';
    await workspace.create(id);
    await writeOwner(getWorkspacesRoot(), id, auth.address);
    const outputDir = path.join(root, 'output');
    await fs.mkdir(outputDir);
    await fs.writeFile(path.join(outputDir, 'image.png'), Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
    const [image] = collectOutputs({ outputDir, laneId: id, jobId: 'proof-job',
      outputs: [{ filename: 'image.png', subfolder: '', type: 'output' }] });
    expect(image.imageId).toBeTruthy();
    const app = express();
    app.use(express.json());
    app.use('/api/v1/image-forge', (await import('../../backend/routes/image-forge-routes.js')).default);
    vite = await createServer({ configFile: false, root: fileURLToPath(new URL('../..', import.meta.url)),
      cacheDir: path.join(root, 'vite'), appType: 'custom',
      server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null }, optimizeDeps: { noDiscovery: true } });
    app.get('/', (_req, res) => res.type('html').send('<script type="module">import * as client from "/frontend/services/image-forge-client.js"; window.client=client; window.expired=0; window.addEventListener("neuma:auth_expired",()=>window.expired++);</script>'));
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
    const calls = [['getForgeStatus', []], ['launchForge', []], ['stopForge', []], ['freeForge', []],
      ['getForgeActivity', []], ['getImageReviews', [id, image.imageId]],
      ['gradeImage', [id, image.imageId, { verdict: 'keep', note: 'A & B' }]]];
    for (const [name, args] of calls) expect((await invoke(name, args)).error).toBe('Not authenticated.');
    await expect(fs.access(process.env.COMFYUI_REVIEW_LOG_PATH)).rejects.toMatchObject({ code: 'ENOENT' });
    await page.evaluate((token) => sessionStorage.setItem('authToken', token), auth.token);
    expect((await invoke('getImageReviews', [id, image.imageId])).result.reviews).toEqual([]);
    expect((await invoke('gradeImage', [id, image.imageId, { verdict: 'invalid' }])).http).toBe(400);
    for (const verdict of ['keep', 'redo']) {
      const result = await invoke('gradeImage', [id, image.imageId, { verdict, note: 'A & B' }]);
      expect(result.result.review).toMatchObject({ verdict, note: 'A & B', by: 'operator', author: auth.address.toLowerCase() });
    }
    const bytes = await fs.readFile(process.env.COMFYUI_REVIEW_LOG_PATH, 'utf8');
    const rows = bytes.trim().split('\n').map((row) => JSON.parse(row));
    expect(rows.map((row) => row.verdict)).toEqual(['keep', 'redo']);
    const reviews = (await invoke('getImageReviews', [id, image.imageId])).result;
    expect(reviews.reviews.map((row) => row.verdict)).toEqual(['redo', 'keep']);
    expect(reviews.asked).toBeNull();
    await page.evaluate((token) => sessionStorage.setItem('authToken', token), stranger.token);
    expect((await invoke('gradeImage', [id, image.imageId, { verdict: 'discard' }])).http).toBe(403);
    expect((await invoke('getImageReviews', [id, image.imageId])).http).toBe(403);
    expect(await fs.readFile(process.env.COMFYUI_REVIEW_LOG_PATH, 'utf8')).toBe(bytes);
    await page.evaluate(() => sessionStorage.setItem('authToken', 'expired-proof'));
    for (const [index, [name, args]] of calls.entries()) {
      expect((await invoke(name, args)).http).toBe(401);
      expect(await page.evaluate(() => window.expired)).toBe(index + 1);
    }
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
