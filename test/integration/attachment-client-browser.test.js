/* global window, sessionStorage, document */
// Real Chromium, signed auth and temporary attachment storage.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, URL } from 'node:url';
import express from 'express';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { expect, test } from 'vitest';
import { attachmentStore } from '../../backend/services/attachment-store.js';
import { fullAuth } from '../helpers/audit-auth.js';

test('attachment client preserves real payloads, receipts and refusals', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'attachments-browser-'));
  let browser; let server; let vite;
  try {
    const auth = await fullAuth();
    const stranger = await fullAuth();
    const app = express();
    app.use('/api/v1/attachments', (await import('../../backend/routes/attachment-routes.js')).default);
    vite = await createServer({ configFile: false, root: fileURLToPath(new URL('../..', import.meta.url)),
      cacheDir: path.join(root, 'vite'), appType: 'custom',
      server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true } });
    app.get('/', (_req, res) => res.type('html').send('<script type="module">import * as client from "/frontend/services/attachments-client.js"; window.client=client; window.expired=0; window.addEventListener("neuma:auth_expired",()=>window.expired++);</script>'));
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

    expect((await invoke('uploadAttachments')).error).toBe('Not authenticated.');
    await page.evaluate((token) => sessionStorage.setItem('authToken', token), auth.token);
    expect(await invoke('uploadAttachments')).toMatchObject({ http: 400, error: 'no attachments given' });
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 1; canvas.height = 1;
      return canvas.toDataURL('image/png');
    });
    const doc = { name: 'folder/notes.md', text: '# Notes\n<angle> & "quoted"' };
    const ids = (await invoke('uploadAttachments', [{ images: [png], files: [doc] }])).result;
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(attachmentStore.pendingCount(auth.address)).toBe(2);
    expect(attachmentStore.take(ids[0], stranger.address)).toBeNull();
    expect(attachmentStore.take(ids[0], auth.address)).toBe(png);
    expect(attachmentStore.take(ids[1], auth.address)).toEqual({ kind: 'text', name: 'notes.md', text: doc.text });
    expect(attachmentStore.take(ids[0], auth.address)).toBeNull();
    expect(attachmentStore.pendingCount(auth.address)).toBe(0);
    expect((await invoke('uploadAttachments', [{ images: [png], files: [{ name: 'empty', text: '' }] }])).http).toBe(400);
    expect(attachmentStore.pendingCount(auth.address)).toBe(0);
    const held = [];
    try {
      for (let i = 0; i < 3; i++) {
        held.push(...(await invoke('uploadAttachments', [{ images: [png, png, png, png] }])).result);
      }
      expect(attachmentStore.pendingCount(auth.address)).toBe(12);
      expect((await invoke('uploadAttachments', [{ files: [doc] }])).http).toBe(429);
      expect(attachmentStore.pendingCount(auth.address)).toBe(12);
    } finally {
      for (const id of held) attachmentStore.take(id, auth.address);
    }
    for (const receipt of [{}, { ids: ['only-one'] }, { ids: ['same', 'same'] }]) {
      expect((await invoke('attachmentIds', [receipt, 2])).error).toContain('incomplete attachment receipt');
    }
    await page.evaluate(() => sessionStorage.setItem('authToken', 'expired-proof'));
    expect((await invoke('uploadAttachments', [{ files: [doc] }])).http).toBe(401);
    expect(await page.evaluate(() => window.expired)).toBe(1);
    expect(attachmentStore.pendingCount(auth.address)).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await vite?.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30_000);
