/* global window, document, getComputedStyle, innerWidth, atob, Blob, createImageBitmap, OffscreenCanvas, URL */
// The live rite's figures never lie under the witness's plane (Founder
// 2026-10-22, from a Windows laptop at 125-150% scaling: the covenant ring's
// ticks crossed the introduction's words and its ring crossed the name
// input). Real components, real CSS, real Chromium; the ring is measured by
// the pixels it actually drew, the panels and the rite's own caption by their
// boxes, at five screens — three of them a 1920x1080 panel scaled by Windows.
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { expect, test } from 'vitest';
import covenantRouter from '../../backend/routes/covenant-routes.js';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const SHOTS = path.join(REPO, 'test/e2e/shots');
// [css width, css height, device scale factor]
const SCREENS = [[1920, 1080, 1], [1600, 900, 1.25], [1366, 768, 1], [1536, 864, 1.25], [1280, 720, 1.5]];
// the rite's own words on the left void: the threshold's caption
const CAPTION = '.rite-threshold .gen-caption';
const INTRODUCTION = ['.ceremony-step h2', '.ceremony-step p', '.witness-label', '#witness-name', '.witness-note', '#cancel-ceremony-btn', '#witness-btn'];

// in the page — the boxes of the given selectors, and of the ring as drawn:
// the bounding box of every pixel the threshold's canvas holds (alpha > 0)
const measure = (selectors) => {
  const box = (r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  const words = Object.fromEntries(selectors.map((sel) => [sel, box(document.querySelector(sel).getBoundingClientRect())]));
  const canvas = document.querySelector('.rite-threshold canvas');
  if (!canvas) return { words, ring: null };
  const r = canvas.getBoundingClientRect();
  const scale = canvas.width / r.width;
  const { data, width, height } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity; let lit = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] === 0) continue;
      lit++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  const ring = lit ? { left: r.left + x0 / scale, top: r.top + y0 / scale, right: r.left + (x1 + 1) / scale, bottom: r.top + (y1 + 1) / scale } : null;
  return { words, ring, lit, canvas: box(r) };
};

// the box of every pixel the living piece lit (WebGL keeps no buffer to read
// back): a screenshot with the plane and the rite's words faded out, decoded in
// the page; a pixel counts once any channel stands more than 10 off the void —
// the void read from the screenshot's own corner, so a stock dress whose void is
// not black (CYBERDECK's #11161D) is never mistaken for the figure
const litBox = async (page) => {
  const hide = (v) => page.evaluate((x) => document.querySelectorAll('.birth-ceremony, .rite-live').forEach((el) => { el.style.opacity = x; }), v);
  await hide('0');
  const png = await page.screenshot();
  await hide('');
  return page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))], { type: 'image/png' }));
    const ctx = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, bmp.width, bmp.height);
    const scale = width / innerWidth;
    const [r0, g0, b0] = [data[0], data[1], data[2]];
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (Math.max(Math.abs(data[i] - r0), Math.abs(data[i + 1] - g0), Math.abs(data[i + 2] - b0)) <= 10) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    return { left: x0 / scale, top: y0 / scale, right: (x1 + 1) / scale, bottom: (y1 + 1) / scale };
  }, png.toString('base64'));
};

const overlaps = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
const crossed = (figure, words) => Object.entries(words).filter(([, w]) => overlaps(figure, w)).map(([sel]) => sel);

test('the rite\'s ring and piece stand beside the witness\'s plane — never under its words, inputs or buttons — at every screen', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-rite-figure-'));
  await fs.mkdir(SHOTS, { recursive: true });
  let vite; let server; let browser;
  try {
    vite = await createServer({ configFile: false, root: REPO, cacheDir: path.join(root, 'cache'),
      appType: 'custom', esbuild: { jsx: 'automatic' },
      resolve: { alias: { '/@kotodama': path.join(REPO, 'core/kotodama') } },
      optimizeDeps: { entries: ['test/fixtures/rite-plane-review.js'] },
      server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null },
    });
    const app = express();
    app.use('/api/v1/covenant', covenantRouter);
    app.get('/', (_req, res) => res.type('html').send('<!doctype html><style>*{box-sizing:border-box}body{margin:0;background:#000}</style><script type="module" src="/test/fixtures/rite-plane-review.js"></script>'));
    app.use(vite.middlewares);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true });
    for (const [width, height, deviceScaleFactor] of SCREENS) {
      const at = `${width}x${height}@${deviceScaleFactor}`;
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForFunction(() => Boolean(window.ritePlane) && window.__neumaRiteLive === true);
      const shot = (name) => page.screenshot({ path: path.join(SHOTS, `rite-clear-${name}-${width}x${height}.png`) });
      const settled = (sel) => page.waitForFunction((s) => {
        const el = document.querySelector(s);
        if (!el) return false;
        const { opacity, transform } = getComputedStyle(el);
        return opacity === '1' && (transform === 'none' || transform === 'matrix(1, 0, 0, 1, 0, 0)');
      }, sel);
      const ringDrawn = () => page.waitForFunction(() => {
        const c = document.querySelector('.rite-threshold canvas');
        if (!c || !c.width) return false;
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        for (let i = 3; i < d.length; i += 4) if (d[i]) return true;
        return false;
      });

      // I · the covenant
      await page.evaluate(() => window.ritePlane.covenant());
      await page.locator('.commitment-modal').waitFor();
      await ringDrawn();
      await page.waitForTimeout(2500); // each document's arc fills
      const covenant = await page.evaluate(measure, ['.commitment-modal', CAPTION]);
      expect(crossed(covenant.ring, covenant.words), `covenant ${at}`).toEqual([]);
      if (deviceScaleFactor !== 1) await shot('covenant');

      // the vessel inspected (the ring closes in signal, the vesica draws)
      await page.evaluate(() => window.ritePlane.vessel());
      await page.locator('.preflight-modal').waitFor();
      await page.waitForTimeout(2500);
      const vessel = await page.evaluate(measure, ['.preflight-modal', CAPTION]);
      expect(crossed(vessel.ring, vessel.words), `vessel ${at}`).toEqual([]);
      if (deviceScaleFactor !== 1) await shot('vessel');

      // YOUR INTRODUCTION — the operator's screen
      await page.evaluate(() => window.ritePlane.introduction());
      await page.locator('#witness-name').waitFor();
      await settled('.ceremony-step');
      const intro = await page.evaluate(measure, [...INTRODUCTION, CAPTION]);
      expect(crossed(intro.ring, intro.words), `introduction ${at}`).toEqual([]);
      // the ring stays whole and of its size: on screen, as wide as the
      // threshold's own figure (0.64 of the short side, its ticks beyond)
      const short = Math.min(intro.canvas.right - intro.canvas.left, intro.canvas.bottom - intro.canvas.top);
      expect(intro.ring.right - intro.ring.left, `ring size ${at}`).toBeGreaterThan(0.64 * short);
      expect(intro.ring.left, `ring on screen ${at}`).toBeGreaterThanOrEqual(0);
      expect(intro.ring.top, `ring on screen ${at}`).toBeGreaterThanOrEqual(0);
      await shot('introduction');
      // …and once a long name is given, inscribed inside the figure
      await page.evaluate(() => window.ritePlane.introduced('Wilhelmina Featherstonehaugh'));
      await page.waitForTimeout(1500);
      const named = await page.evaluate(measure, [...INTRODUCTION, CAPTION]);
      expect(crossed(named.ring, named.words), `named ${at}`).toEqual([]);
      if (deviceScaleFactor !== 1) await shot('named');

      // II · the seventh stage: the living piece stays beside the plane and
      // above the stage's caption — its canvas, and every pixel it lit
      await page.evaluate(() => window.ritePlane.stage());
      await settled('#continue-btn');
      await page.waitForFunction(() => Number(document.querySelector('.rite-ceremony-field > .gen-canvas')?.style.opacity) > 0.99);
      await page.waitForTimeout(3000); // the piece draws its stages
      const stage = await page.evaluate(() => {
        const box = (sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
        return { piece: box('.rite-ceremony-field > .gen-canvas'), words: Object.fromEntries(['.message-container', '.ceremony-controls', '.rite-live .gen-caption'].map((sel) => [sel, box(sel)])) };
      });
      const drawn = await litBox(page);
      expect(crossed(stage.piece, stage.words), `stage canvas ${at}`).toEqual([]);
      expect(crossed(drawn, stage.words), `stage piece ${at}`).toEqual([]);
      expect(drawn.bottom - drawn.top, `piece size ${at}`).toBeGreaterThan(0.5 * height);
      if (deviceScaleFactor !== 1) await shot('stage');

      expect(errors, `page errors ${at}`).toEqual([]);
      await page.close();
    }
  } finally {
    await browser?.close();
    await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
    await vite?.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 240_000);
