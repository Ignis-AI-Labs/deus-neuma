/** Actual PDF worker, browser File input, signed upload and production store. */
import fs from 'node:fs/promises';
import { Buffer } from 'node:buffer';
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
import { pdfBytes } from '../helpers/pdf-attachment-fixture.js';
import { docxSaying } from '../helpers/docx-fixture.js';

test('real PDFs extract in page order and upload as owned chat documents', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-attachment-'));
  let browser; let server; let vite;
  const ids = [];
  const auth = await fullAuth();
  try {
    const stranger = await fullAuth();
    const app = express();
    app.use('/api/v1/attachments', (await import('../../backend/routes/attachment-routes.js')).default);
    vite = await createServer({ configFile: false, root: fileURLToPath(new URL('../..', import.meta.url)),
      cacheDir: path.join(root, 'vite'), appType: 'custom',
      server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { include: ['pdfjs-dist'] } });
    app.get('/', (_req, res) => res.type('html').send(`<input type="file" id="file"><script type="module">
      import * as attachments from '/frontend/app/RelinkShell/attachments.js';
      import { prepareAttachmentSend } from '/frontend/app/RelinkShell/attachment-send.js';
      import { uploadAttachments } from '/frontend/services/attachments-client.js';
      window.pdfAttachment = { ...attachments, prepareAttachmentSend, uploadAttachments };
    </script>`));
    app.use(vite.middlewares);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
    const page = await browser.newPage();
    await page.addInitScript((token) => globalThis.sessionStorage.setItem('authToken', token), auth.token);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => Boolean(globalThis.pdfAttachment));
    const read = async (buffer, name = 'report.pdf', mimeType = 'application/pdf', upload = false) => {
      await page.locator('#file').setInputFiles({ name, mimeType, buffer });
      return page.evaluate(async (upload) => {
        const client = globalThis.pdfAttachment;
        const file = globalThis.document.getElementById('file').files[0];
        const { accepted, refusal } = client.admitFiles([], [file]);
        if (refusal) return { error: refusal };
        try {
          const entry = { kind: accepted[0].kind, name: file.name, text: null };
          const pending = client.prepareAttachmentSend([entry]);
          entry.text = await client.fileToText(file);
          const payload = client.prepareAttachmentSend([entry]);
          return { pending, payload, ids: upload ? await client.uploadAttachments(payload) : [] };
        } catch (error) { return { error: error.message }; }
      }, upload);
    };
    const result = await read(pdfBytes(['Consulting plan for September.', 'Next step: talk to past clients.']), 'plan.PDF', 'application/octet-stream', true);
    expect(result.error).toBeUndefined();
    expect(result.pending.ok).toBe(false);
    expect(result.payload.images).toEqual([]);
    expect(result.payload.files).toEqual([{ name: 'plan.PDF', text: '[Page 1]\nConsulting plan for September.\n\n[Page 2]\nNext step: talk to past clients.' }]);
    expect(result.ids).toHaveLength(1);
    ids.push(...result.ids);
    expect(attachmentStore.take(ids[0], stranger.address)).toBeNull();
    expect(attachmentStore.take(ids[0], auth.address)).toEqual({ kind: 'text', ...result.payload.files[0] });
    expect((await read(await fs.readFile(new URL('../fixtures/password-protected.pdf', import.meta.url)))).error).toMatch(/password-protected/);
    expect((await read(pdfBytes(['']))).error).toMatch(/no selectable text/);
    expect((await read(Buffer.from('%PDF-1.4\nnot a document'))).error).toMatch(/could not be read/);
    expect((await read(pdfBytes(Array.from({ length: 1001 }, () => 'page')))).error).toMatch(/1000 pages/);
    expect((await read(pdfBytes(Array.from({ length: 200 }, () => 'text '.repeat(900))))).error).toMatch(/400k-character/);
    expect((await read(Buffer.alloc(20 * 1024 * 1024 + 1))).error).toMatch(/20MB/);
    expect((await read(Buffer.from('ordinary text'), 'notes.txt', 'text/plain')).payload.files[0].text).toBe('ordinary text');
    // A Word document reads in the browser's own DecompressionStream (core/documents/docx-text.js).
    const word = await read(docxSaying(['Attached brief', ['Second ', 'line']]), 'brief.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(word.error).toBeUndefined();
    expect(word.payload.files).toEqual([{ name: 'brief.docx', text: 'Attached brief\nSecond line' }]);
    expect(attachmentStore.pendingCount(auth.address)).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    for (const id of ids) attachmentStore.take(id, auth.address);
    await browser?.close();
    await vite?.close();
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30000);
