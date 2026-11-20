import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { build } from 'vite';
import { chromium, expect } from '@playwright/test';
import { test, expect as vexpect } from 'vitest';

// THE EDIT HAS THE COMPOSER'S VOICE (InlineEdit.jsx; Design note, 2026-11-19: […]). Real StreamPanel, real browser, real key events with the auto-repeat a held key sends, Chromium's fake
// microphone (no person, no model): a tap of Space in the edit types one space; a HOLD types none and listens.
test('in an earlier message being edited, a tap of Space is a space, and a held Space listens instead of flooding the box', async () => {
  let server; let browser;
  try {
    const entryId = 'virtual:inline-edit-voice.jsx';
    const file = (name) => JSON.stringify(path.resolve(`frontend/${name}`));
    const source = `import React from 'react'; import {createRoot} from 'react-dom/client';
      import {StreamPanel} from ${file('app/RelinkShell/StreamPanel.jsx')};
      import ${file('styles/tokens.css')};
      import ${file('app/RelinkShell/RelinkShell.css')};
      const messages = [
        { id: 'u1', role: 'user', streaming: false, isHistory: false, at: null, turnId: 't1', segments: [{ kind: 'speech', text: 'All the emails in the umbrae campaign' }], meta: null },
        { id: 'n1', role: 'neuma', streaming: false, isHistory: false, at: null, turnId: 't1', segments: [{ kind: 'speech', text: 'On it.' }], meta: null },
      ];
      createRoot(document.getElementById('root')).render(
        <div style={{ height: 420, width: 560, display: 'flex', flexDirection: 'column' }}>
          <StreamPanel messages={messages} thread={0} thinking={false} connected onRevise={() => {}} />
        </div>);`;
    const bundle = await build({ configFile: false, logLevel: 'error', esbuild: { jsx: 'automatic', loader: 'jsx' },
      plugins: [{ name: 'inline-edit-voice', resolveId: (id) => (id === entryId ? id : null), load: (id) => (id === entryId ? source : null) }],
      build: { write: false, rollupOptions: { input: entryId } } });
    const app = express();
    for (const asset of bundle.output) app.get(`/${asset.fileName}`, (_req, res) => res.type(path.extname(asset.fileName)).send(asset.type === 'chunk' ? asset.code : asset.source));
    const entry = bundle.output.find((asset) => asset.type === 'chunk' && asset.isEntry).fileName;
    const styles = bundle.output.filter((asset) => asset.fileName.endsWith('.css')).map((asset) => `<link rel="stylesheet" href="/${asset.fileName}">`).join('');
    app.get('/', (_req, res) => res.type('html').send(`${styles}<body style="margin:0"><div id="root"></div><script type="module" src="/${entry}"></script></body>`));
    server = http.createServer(app); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ args: ['--disable-gpu', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);

    const mine = page.locator('.relink-msg--user').first();
    await mine.hover();
    await mine.locator('.relink-edit').click();
    const field = page.locator('.relink-inline-edit-field');
    await field.press('End');
    // A TAP is a space.
    await page.keyboard.press('Space');
    vexpect(await field.inputValue()).toBe('All the emails in the umbrae campaign ');
    // A HOLD — the key down, auto-repeating as a held key does — types nothing more and listens.
    await page.keyboard.down('Space');
    for (let i = 0; i < 12; i += 1) { await page.waitForTimeout(40); await page.keyboard.down('Space'); }
    await expect(page.locator('.relink-inline-mic')).toHaveText('LISTENING — RELEASE TO TRANSCRIBE');
    vexpect(await field.inputValue()).toBe('All the emails in the umbrae campaign ');
    await page.keyboard.up('Space');
    await expect(page.locator('.relink-inline-mic[data-mic="recording"]')).toHaveCount(0);
    vexpect(await field.inputValue()).not.toMatch(/ {2,}$/);
    vexpect(errors).toEqual([]);
  } finally {
    await browser?.close(); server?.closeAllConnections();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
  }
}, 60_000);
