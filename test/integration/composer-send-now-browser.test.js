// CTRL+ENTER SENDS NOW — Design note, 2026-11-16: […] The production composer (StreamInput) built by vite and driven in real
// Chromium by the keyboard: mid-reply, Enter holds the word for after the current action and
// Ctrl+Enter interjects it now; with no reply running, Ctrl+Enter simply sends. Nothing mocked.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { build } from 'vite';
import { chromium, expect } from '@playwright/test';
import { test } from 'vitest';

test('Ctrl+Enter interjects mid-reply where Enter holds the word, and sends plainly when nothing runs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'composer-send-now-'));
  let server; let browser;
  try {
    const entryId = 'virtual:composer-send-now.jsx';
    const modulePath = (file) => JSON.stringify(path.resolve(file));
    const source = `
      import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
      import {StreamInput} from ${modulePath('frontend/app/RelinkShell/StreamInput.jsx')};
      import { ConsciousnessProvider } from ${modulePath('frontend/app/RelinkShell/consciousness-context.js')};
      import {WindowManager} from ${modulePath('frontend/app/windowing/WindowManager.jsx')};
      import ${modulePath('frontend/styles/tokens.css')};
      const Page = () => {
        const [busy, setBusy] = useState(true); const [log, setLog] = useState([]);
        const said = (how) => (text) => setLog((l) => [...l, how + ': ' + text]);
        return <ConsciousnessProvider value={{}}><WindowManager registry={{}}>
          <button id="idle" onClick={() => setBusy(false)}>idle</button>
          <section id="composer"><StreamInput connected busy={busy} canQueue onSend={said('held')} onSendUrgent={said('now')} onStop={() => {}} /></section>
          <output>{log.join(' | ')}</output>
        </WindowManager></ConsciousnessProvider>; };
      createRoot(document.getElementById('root')).render(<Page />);`;
    const bundle = await build({ configFile: false, root: process.cwd(), logLevel: 'error', cacheDir: path.join(root, 'vite-cache'),
      esbuild: { jsx: 'automatic', loader: 'jsx' },
      plugins: [{ name: 'composer-send-now', resolveId: (id) => (id === entryId ? id : null), load: (id) => (id === entryId ? source : null) }],
      build: { write: false, rollupOptions: { input: entryId } } });
    const app = express();
    for (const file of bundle.output) app.get(`/${file.fileName}`, (_req, res) => res.type(path.extname(file.fileName)).send(file.type === 'chunk' ? file.code : file.source));
    const entry = bundle.output.find((file) => file.type === 'chunk' && file.isEntry).fileName;
    const styles = bundle.output.filter((file) => file.fileName.endsWith('.css')).map((file) => `<link rel="stylesheet" href="/${file.fileName}">`).join('');
    app.get('/', (_req, res) => res.type('html').send(`${styles}<div id="root"></div><script type="module" src="/${entry}"></script>`));
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ args: ['--disable-gpu'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const field = page.locator('#composer textarea');

    // A reply is running: Enter holds the word, Ctrl+Enter interjects it.
    await field.fill('wait your turn');
    await field.press('Enter');
    await field.fill('right now');
    await field.press('Control+Enter');
    await expect(page.locator('output')).toHaveText('held: wait your turn | now: right now');
    await expect(field).toHaveValue('');
    // The interject button names the shortcut.
    await expect(page.getByRole('button', { name: /^Interject now/ })).toHaveAttribute('title', /Ctrl\+Enter/);

    // Nothing running: Ctrl+Enter is an ordinary send, never an interjection.
    await page.locator('#idle').click();
    await field.fill('plain send');
    await field.press('Control+Enter');
    await expect(page.locator('output')).toHaveText('held: wait your turn | now: right now | held: plain send');
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    server?.closeAllConnections();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
}, 60_000);
