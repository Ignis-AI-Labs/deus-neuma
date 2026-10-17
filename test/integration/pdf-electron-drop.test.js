/** Real desktop runtime, production composer, disk-file drop and signed upload. */
import fs from 'node:fs/promises';
import os from 'node:os';
import process from 'node:process';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, URL } from 'node:url';
import express from 'express';
import { createServer } from 'vite';
import { _electron as electron } from '@playwright/test';
import electronPath from 'electron';
import { expect, test } from 'vitest';
import { attachmentStore } from '../../backend/services/attachment-store.js';
import { fullAuth } from '../helpers/audit-auth.js';
import { pdfBytes } from '../helpers/pdf-attachment-fixture.js';

test('dropping a disk PDF into Electron chat extracts and uploads page-ordered text', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-electron-'));
  let desktop; let server; let vite;
  const auth = await fullAuth();
  const ids = [];
  try {
    const app = express();
    app.use('/api/v1/attachments', (await import('../../backend/routes/attachment-routes.js')).default);
    vite = await createServer({ configFile: false, root: fileURLToPath(new URL('../..', import.meta.url)),
      cacheDir: path.join(root, 'vite'), appType: 'custom', esbuild: { jsx: 'automatic' },
      server: { middlewareMode: true, hmr: false, watch: null } });
    app.get('/', (_req, res) => res.type('html').send('<div id="root"></div><script type="module" src="/test/fixtures/pdf-composer.jsx"></script>'));
    app.use(vite.middlewares);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    desktop = await electron.launch({ executablePath: electronPath,
      args: [fileURLToPath(new URL('../fixtures/pdf-electron-main.cjs', import.meta.url))],
      env: { ...process.env, PDF_TEST_PROFILE: path.join(root, 'profile'),
        PDF_TEST_URL: `http://127.0.0.1:${server.address().port}/` } });
    const page = await desktop.firstWindow();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.reload();
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
    await page.locator('.relink-compose').waitFor();
    await page.evaluate((token) => globalThis.sessionStorage.setItem('authToken', token), auth.token);
    const file = path.join(root, 'consulting-plan.pdf');
    await fs.writeFile(file, pdfBytes(['Consulting plan for September.', 'Next step: talk to past clients.']));
    const cdp = await page.context().newCDPSession(page);
    const box = await page.locator('.relink-compose').boundingBox();
    for (const type of ['dragEnter', 'dragOver', 'drop']) {
      await cdp.send('Input.dispatchDragEvent', { type, x: box.x + 20, y: box.y + 20,
        data: { items: [], files: [file], dragOperationsMask: 1 } });
    }
    await page.waitForFunction(() => globalThis.document.querySelector('.relink-attach-chip:not(.is-reading)')
      || globalThis.document.querySelector('.relink-attach-note'));
    expect(await page.locator('.relink-attach-note').allTextContents()).toEqual([]);
    expect(await page.locator('.relink-attach-chip:not(.is-reading)').textContent()).toContain('consulting-plan.pdf');
    await page.locator('textarea').fill('Please read this PDF.');
    await page.locator('textarea').press('Enter');
    await page.waitForFunction(() => globalThis.document.querySelector('#sent').textContent);
    const sent = JSON.parse(await page.locator('#sent').textContent());
    expect(sent.text).toBe('Please read this PDF.');
    ids.push(...sent.attachments.ids);
    expect(ids).toHaveLength(1);
    expect(attachmentStore.take(ids[0], (await fullAuth()).address)).toBeNull();
    expect(attachmentStore.take(ids[0], auth.address)).toEqual({ kind: 'text', name: 'consulting-plan.pdf',
      text: '[Page 1]\nConsulting plan for September.\n\n[Page 2]\nNext step: talk to past clients.' });
    expect(await page.locator('.relink-attach-chip').count()).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    for (const id of ids) attachmentStore.take(id, auth.address);
    await desktop?.close();
    await vite?.close();
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}, 60000);
