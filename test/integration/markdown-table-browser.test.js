/* global URL, document, getComputedStyle */
// Real Chromium drawing the real <Markdown> with the desk's real CSS inside
// the stream's real message frame, at a wide (980px) and a narrow (560px)
// stream. No backend: the renderer is pure, the layout is the browser's.
//
// The owner's 2026-10-24 table (PLATFORM | CONNECTED | I CAN READ | PER-POST
// VIEWS/ENGAGEMENT) drew "PLAT/FORM", "TikT/ok", "You/Tub/e": the message
// body's word-break let every cell's narrowest width shrink to one letter, so
// the short columns were crushed while the long one took the room.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const FIXTURE = 'test/fixtures/markdown-table.jsx';
let root; let vite; let server; let browser; let page;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-md-table-'));
  vite = await createServer({ configFile: false,
    root: fileURLToPath(new URL('../..', import.meta.url)), cacheDir: path.join(root, 'cache'),
    appType: 'custom', esbuild: { jsx: 'automatic' }, logLevel: 'error',
    optimizeDeps: { entries: [FIXTURE], include: ['react', 'react-dom/client', 'react/jsx-runtime'] },
    server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null },
  });
  const app = express();
  app.get('/', (_req, res) => res.type('html').send(`<!doctype html><body style="margin:0;background:#000"><div id="root"></div><script type="module" src="/${FIXTURE}"></script>`));
  app.use(vite.middlewares);
  server = http.createServer(app);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
  page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => document.querySelectorAll('.relink-md table').length === 6);
  await page.evaluate(() => document.fonts.ready);
  expect(errors).toEqual([]);
}, 60000);

afterAll(async () => {
  await browser?.close();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await vite?.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

// Every whitespace-separated word in a table's cells, with how many lines it
// was drawn across — a word split mid-word is drawn on two or more.
const wordLines = (width, tableIndex) => page.evaluate(([w, t]) => {
  const table = document.querySelectorAll(`[data-frame="${w}"] .relink-md table`)[t];
  const rows = [];
  for (const cell of table.querySelectorAll('th, td')) {
    const walker = document.createTreeWalker(cell, 4);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (const match of node.data.matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const tops = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
        rows.push({ word: match[0], lines: tops.size, header: cell.tagName === 'TH' });
      }
    }
  }
  return rows;
}, [width, tableIndex]);

// Every short cell (a name, a mark, a number) and how many lines it took.
const shortCells = (width, tableIndex) => page.evaluate(([w, t]) => {
  const table = document.querySelectorAll(`[data-frame="${w}"] .relink-md table`)[t];
  return [...table.querySelectorAll('.relink-md-short')].map((cell) => {
    const range = document.createRange();
    range.selectNodeContents(cell);
    const tops = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
    return { text: cell.textContent, lines: tops.size };
  });
}, [width, tableIndex]);

// The table's frame against the message it stands in.
const frameBox = (width, tableIndex) => page.evaluate(([w, t]) => {
  const body = document.querySelector(`[data-frame="${w}"] .relink-msg-body`);
  const table = document.querySelectorAll(`[data-frame="${w}"] .relink-md table`)[t];
  const frame = table.parentElement;
  const b = body.getBoundingClientRect();
  const f = frame.getBoundingClientRect();
  return {
    bodyLeft: b.left, bodyRight: b.right, frameLeft: f.left, frameRight: f.right,
    frameClass: frame.className, overflowX: getComputedStyle(frame).overflowX,
    scrollWidth: frame.scrollWidth, clientWidth: frame.clientWidth,
    pageScrollWidth: document.documentElement.scrollWidth,
    cellAligns: [...table.querySelectorAll('tbody tr:first-child td')].map((td) => getComputedStyle(td).textAlign),
  };
}, [width, tableIndex]);

describe.each([980, 560])('a stream message %ipx wide', (width) => {
  it('draws every word of the platform table whole — no word split across lines', async () => {
    const words = await wordLines(width, 0);
    expect(words.map((w) => w.word)).toEqual(expect.arrayContaining(['Platform', 'Connected', 'TikTok', 'YouTube', 'LinkedIn', '(crew']));
    expect(words.filter((w) => w.lines !== 1)).toEqual([]);
  });

  it('keeps every short cell — header or body — on one line', async () => {
    const cells = await shortCells(width, 0);
    expect(cells.map((c) => c.text)).toEqual(expect.arrayContaining(['Platform', 'I can read', 'TikTok', '❌ (crew / gate)', 'Nothing yet']));
    expect(cells.filter((c) => c.lines !== 1)).toEqual([]);
  });

  it('keeps the table inside its message; a wider table scrolls in its own frame', async () => {
    for (const index of [0, 1, 2]) {
      const box = await frameBox(width, index);
      expect(box.frameClass).toBe('relink-md-table');
      expect(box.overflowX).toBe('auto');
      expect(box.frameLeft).toBeGreaterThanOrEqual(box.bodyLeft - 0.5);
      expect(box.frameRight).toBeLessThanOrEqual(box.bodyRight + 0.5);
      expect(box.pageScrollWidth).toBeLessThanOrEqual(1280);
    }
  });

  it('honors the markdown alignment: numbers stand right', async () => {
    const box = await frameBox(width, 1);
    expect(box.cellAligns).toEqual(['left', 'right', 'right']);
  });

  it('lets a very long unbroken link break rather than overflow', async () => {
    const box = await frameBox(width, 2);
    expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth + 1);
    const words = await wordLines(width, 2);
    expect(words.find((w) => w.word === 'Report').lines).toBe(1);
  });
});

it('a table too wide for a narrow message scrolls rather than crushing its words', async () => {
  // Squeeze the narrow frame until the platform table's whole words cannot fit
  // side by side: the frame must scroll, and still no word is split.
  await page.evaluate(() => { document.querySelector('[data-frame="560"]').style.width = '260px'; });
  const box = await frameBox(560, 0);
  expect(box.scrollWidth).toBeGreaterThan(box.clientWidth);
  expect(box.frameRight).toBeLessThanOrEqual(box.bodyRight + 0.5);
  expect((await wordLines(560, 0)).filter((w) => w.lines !== 1)).toEqual([]);
});
