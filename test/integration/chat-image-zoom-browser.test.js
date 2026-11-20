/* global sessionStorage, getComputedStyle */
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { Buffer } from 'node:buffer';
import express from 'express';
import { build } from 'vite';
import { chromium, expect } from '@playwright/test';
import { test, expect as vexpect } from 'vitest';

// A RENDER IN THE CHAT OPENS FULL SIZE (AuthImage.jsx `zoom`, ToolChip.jsx MadeImages) — Design note, 2026-11-20, a render
// in Metidar's chat: […] The real tool chip in a real browser; the render is served behind a Bearer check as
// the forge's image route is: a press hangs the SAME bytes in the Lightbox, the wheel zooms, Escape closes it.

// A real 64x96 PNG, built here (one solid colour), so the page has true image bytes to decode.
const png = (() => {
  const w = 64; const h = 96;
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x5a)])));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
})();

test('a render in the chat is a door: one press shows it full size, the wheel zooms, Escape closes; without a login nothing loads', async () => {
  let server; let browser;
  try {
    const entryId = 'virtual:chat-image-zoom.jsx';
    const file = (name) => JSON.stringify(path.resolve(`frontend/${name}`));
    const source = `import React from 'react'; import {createRoot} from 'react-dom/client';
      import {ToolChip} from ${file('app/RelinkShell/ToolChip.jsx')};
      import ${file('styles/tokens.css')};
      import ${file('app/RelinkShell/RelinkShell.css')};
      const segment = { kind: 'tool', phase: 'resolved', status: 'ok', label: 'image/generate', summary: 'made 1 image — 2.2 MB · 1024×1344',
        images: [{ imageId: 'img-1', laneId: 'metidar', mime: 'image/png', url: '/forge/image/img-1', path: '/mnt/data/neuma/metidar/art/sofi0-hero.png' }] };
      createRoot(document.getElementById('root')).render(<div style={{ width: 760 }}><ToolChip segment={segment} /></div>);`;
    const bundle = await build({ configFile: false, logLevel: 'error', esbuild: { jsx: 'automatic', loader: 'jsx' },
      plugins: [{ name: 'chat-image-zoom', resolveId: (id) => (id === entryId ? id : null), load: (id) => (id === entryId ? source : null) }],
      build: { write: false, rollupOptions: { input: entryId } } });
    const app = express();
    let served = 0;
    app.get('/forge/image/img-1', (req, res) => {
      if (req.headers.authorization !== 'Bearer test-session-token' || req.query.laneId !== 'metidar') { res.status(401).end(); return; }
      served += 1;
      res.type('png').send(png);
    });
    for (const asset of bundle.output) app.get(`/${asset.fileName}`, (_req, res) => res.type(path.extname(asset.fileName)).send(asset.type === 'chunk' ? asset.code : asset.source));
    const entry = bundle.output.find((asset) => asset.type === 'chunk' && asset.isEntry).fileName;
    const styles = bundle.output.filter((asset) => asset.fileName.endsWith('.css')).map((asset) => `<link rel="stylesheet" href="/${asset.fileName}">`).join('');
    app.get('/', (_req, res) => res.type('html').send(`${styles}<body style="margin:0"><div id="root"></div><script type="module" src="/${entry}"></script></body>`));
    server = http.createServer(app); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ args: ['--disable-gpu'] });
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => sessionStorage.setItem('authToken', 'test-session-token'));
    await page.goto(`http://127.0.0.1:${server.address().port}`);

    const door = page.getByRole('button', { name: 'view generated image full size' });
    await expect(door).toBeVisible();
    await expect(door.locator('img')).toHaveJSProperty('complete', true);
    const shown = await door.locator('img').getAttribute('src');
    vexpect(shown).toMatch(/^blob:/);
    await door.click();
    const room = page.locator('.lightbox');
    await expect(room).toBeVisible();
    // The same bytes, no second fetch; the file's path is the caption.
    vexpect(await room.locator('img').getAttribute('src')).toBe(shown);
    vexpect(served).toBe(1);
    await expect(room).toContainText('/mnt/data/neuma/metidar/art/sofi0-hero.png');
    // The wheel zooms in place.
    const before = await room.locator('img').evaluate((el) => getComputedStyle(el).transform);
    await room.locator('img').hover();
    await page.mouse.wheel(0, -400);
    await expect.poll(() => room.locator('img').evaluate((el) => getComputedStyle(el).transform)).not.toBe(before);
    await page.keyboard.press('Escape');
    await expect(room).toHaveCount(0);
    await expect(door).toBeFocused();
    vexpect(errors).toEqual([]);

    // Without a login the route gives nothing, and the chat shows that instead of a door.
    const bare = await browser.newPage();
    await bare.goto(`http://127.0.0.1:${server.address().port}`);
    await expect(bare.locator('.authimg-missing')).toHaveCount(1);
    await expect(bare.getByRole('button', { name: /full size/ })).toHaveCount(0);
  } finally {
    await browser?.close(); server?.closeAllConnections();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
  }
}, 120_000);
