// #584 — a board that opens exactly at the bottom edge of its scroll area keeps
// refreshing once it shows. Real Chromium, the PRODUCTION useVisibleInterval and
// the real IntersectionObserver + ResizeObserver it rides; no double (RULE 0).
// Edge-adjacent, the observer reports "intersecting, zero area" and the poll
// rightly stops; scrolling one step brings pixels in, and the poll must start
// again — with a lone 0 threshold that change crossed no threshold, the
// observer never called back, and the board went stale while on screen.
/* global document, window */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, URL } from 'node:url';
import express from 'express';
import { createServer as createVite } from 'vite';
import { chromium } from '@playwright/test';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
let tmp; let vite; let server; let browser;

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'visible-interval-'));
  const app = express();
  vite = await createVite({
    configFile: false, root: REPO, cacheDir: path.join(tmp, 'vite-cache'), appType: 'custom',
    esbuild: { jsx: 'automatic' },
    optimizeDeps: { entries: ['test/helpers/visible-interval-page.jsx'], include: ['react', 'react-dom/client', 'react/jsx-runtime'] },
    server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null },
  });
  app.get('/', (req, res) => res.type('html').send(
    '<!doctype html><body style="margin:0"><div id="root"></div><script type="module" src="/test/helpers/visible-interval-page.jsx"></script></body>',
  ));
  app.use(vite.middlewares);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
}, 90000);

afterAll(async () => {
  await browser?.close();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await vite?.close();
  if (tmp) await fs.rm(tmp, { recursive: true, force: true });
}, 30000);

const runs = (page) => page.evaluate(() => window.pollRuns);

describe('useVisibleInterval — a board at the clip edge (#584)', () => {
  it('stops while it shows nothing, and starts again the moment it shows pixels', async () => {
    const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForSelector('#board', { timeout: 30000 });

    // The board's top is ON the scroller's bottom edge: in the clip, zero area.
    const edge = await page.evaluate(() => ({
      board: document.getElementById('board').getBoundingClientRect().top,
      clip: document.getElementById('scroller').getBoundingClientRect().bottom,
    }));
    expect(edge.board).toBe(edge.clip);

    // Nothing shows, so the poll stands still (it ran once as it mounted).
    await page.waitForTimeout(600);
    const still = await runs(page);
    await page.waitForTimeout(600);
    expect(await runs(page)).toBe(still);

    // One step of the scroll brings the board's head into view: it runs at
    // once and keeps running on its 100 ms beat.
    await page.evaluate(() => { document.getElementById('scroller').scrollTop = 40; });
    await expect.poll(() => runs(page), { timeout: 3000 }).toBeGreaterThan(still + 3);

    // Scrolled back to the edge, it stops again — the gate still gates.
    await page.evaluate(() => { document.getElementById('scroller').scrollTop = 0; });
    await page.waitForTimeout(400);
    const stopped = await runs(page);
    await page.waitForTimeout(600);
    expect(await runs(page)).toBe(stopped);
    expect(errors).toEqual([]);
    await page.close();
  }, 60000);
});
