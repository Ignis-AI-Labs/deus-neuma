import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { build } from 'vite';
import { chromium, expect } from '@playwright/test';
import { test, expect as vexpect } from 'vitest';

// The follow control has its own lane under the transcript: it never covers
// a word, an editor, or the editor's SAVE row — following at the tail or
// released mid-read. And an editor opened on the last message keeps its acts
// in view as it grows. Real StreamPanel, real CSS, real browser layout; no
// portal, no model.
test('the follow control never overlaps the transcript, and the editor keeps SAVE in view', async () => {
  let server; let browser;
  try {
    const entryId = 'virtual:stream-follow-lane.jsx';
    const file = name => JSON.stringify(path.resolve(`frontend/${name}`));
    const source = `import React from 'react'; import {createRoot} from 'react-dom/client';
      import {StreamPanel} from ${file('app/RelinkShell/StreamPanel.jsx')};
      import ${file('styles/tokens.css')};
      import ${file('app/RelinkShell/RelinkShell.css')};
      const said = (i) => 'A line of the conversation, long enough to wrap across the column once or twice ' + i + '.';
      const messages = Array.from({ length: 24 }, (_, i) => ({
        id: 'm' + i, role: i % 2 ? 'neuma' : 'user', streaming: false, isHistory: false, at: null,
        turnId: 't' + i, segments: [{ kind: 'speech', text: said(i) }], meta: null,
      }));
      createRoot(document.getElementById('root')).render(
        <div style={{ height: 420, width: 560, display: 'flex', flexDirection: 'column' }}>
          <StreamPanel messages={messages} thread={0} thinking={false} connected onRevise={() => {}} />
        </div>);`;
    const bundle = await build({ configFile: false, logLevel: 'error', esbuild: { jsx: 'automatic', loader: 'jsx' },
      plugins: [{ name: 'stream-follow-lane', resolveId: id => id === entryId ? id : null,
        load: id => id === entryId ? source : null }], build: { write: false, rollupOptions: { input: entryId } } });
    const app = express();
    for (const asset of bundle.output) app.get(`/${asset.fileName}`, (_req, res) =>
      res.type(path.extname(asset.fileName)).send(asset.type === 'chunk' ? asset.code : asset.source));
    const entry = bundle.output.find(asset => asset.type === 'chunk' && asset.isEntry).fileName;
    const styles = bundle.output.filter(asset => asset.fileName.endsWith('.css')).map(asset => `<link rel="stylesheet" href="/${asset.fileName}">`).join('');
    app.get('/', (_req, res) => res.type('html').send(`${styles}<body style="margin:0"><div id="root"></div><script type="module" src="/${entry}"></script></body>`));
    server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ args: ['--disable-gpu'] }); const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);

    const stream = page.locator('.relink-stream');
    const follow = page.locator('.stream-follow');
    await expect(follow).toHaveText('FOLLOWING ▼');
    const box = async (loc) => loc.boundingBox();
    const below = async () => {
      const s = await box(stream); const f = await box(follow);
      vexpect(f.y).toBeGreaterThanOrEqual(s.y + s.height - 0.5);
    };
    await below();

    // EDIT the last of the witness's words, then grow the draft past the edge.
    const last = page.locator('.relink-msg--user').last();
    await last.hover();
    await last.locator('.relink-edit').click();
    const field = page.locator('.relink-inline-edit-field');
    await field.press('End');
    await field.pressSequentially('\nmore\nlines\nso the box\ngrows');
    const save = page.locator('.relink-inline-save');
    const s = await box(stream); const v = await box(save);
    vexpect(v.y).toBeGreaterThanOrEqual(s.y);
    vexpect(v.y + v.height).toBeLessThanOrEqual(s.y + s.height);
    await below();

    // Released mid-read, the control still stands in its lane.
    await stream.evaluate((el) => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); });
    await expect(follow).toHaveText('▼ LIVE');
    await below();
    await follow.click();
    await expect(follow).toHaveText('FOLLOWING ▼');
    vexpect(await stream.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(2);
    vexpect(errors).toEqual([]);
  } finally {
    await browser?.close(); server?.closeAllConnections();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
  }
}, 30_000);
