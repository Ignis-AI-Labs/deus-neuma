// The witness's plane never lays one panel over another (Design note, 2026-10-14: […]). Real components, real CSS,
// real Chromium, a stage at its fullest — a long answer, the operator's words,
// the whole disclosure open, CONTINUE shown — at four screen sizes.
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

const SIZES = [[1280, 720], [1366, 768], [1920, 1080], [3440, 1440]];

test('a full stage keeps the operator\'s words and the controls on screen, never overlapping, at every size', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-rite-rail-'));
  let vite; let server; let browser;
  try {
    const repo = fileURLToPath(new URL('../..', import.meta.url));
    vite = await createServer({ configFile: false, root: repo, cacheDir: path.join(root, 'cache'),
      appType: 'custom', esbuild: { jsx: 'automatic' },
      resolve: { alias: { '/@kotodama': path.join(repo, 'core/kotodama') } },
      optimizeDeps: { entries: ['test/fixtures/threshold-review.js'] },
      server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null },
    });
    const app = express();
    app.use('/api/v1/covenant', covenantRouter);
    app.get('/', (_req, res) => res.type('html').send('<!doctype html><style>*{box-sizing:border-box}body{margin:0}</style><script type="module" src="/test/fixtures/threshold-review.js"></script>'));
    app.use(vite.middlewares);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
    for (const [width, height] of SIZES) {
      const page = await browser.newPage({ viewport: { width, height } });
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForFunction(() => Boolean(window.thresholdReview));
      await page.evaluate(() => window.thresholdReview.showStage());
      await page.waitForFunction(() => getComputedStyle(document.querySelector('#continue-btn')).opacity === '1');
      const box = await page.evaluate(() => {
        const rect = (sel) => document.querySelector(sel).getBoundingClientRect();
        const panel = rect('.message-container');
        const controls = rect('.ceremony-controls');
        const words = rect('#witness-words');
        const onScreen = (r) => r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
        return { overlaps: controls.top < panel.bottom - 0.5, panel: onScreen(panel), controls: onScreen(controls), words: onScreen(words) };
      });
      expect(box, `${width}x${height}`).toEqual({ overlaps: false, panel: true, controls: true, words: true });
      await page.close();
    }

    // THINKING IS SHOWN, AND READABLE: the scene's own listeners, fed the
    // frames the backend sends, show a running strip; it opens to the thoughts
    // and settles to THOUGHT when speech begins — the thoughts never enter the speech.
    {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForFunction(() => Boolean(window.thresholdReview));
      await page.evaluate(() => window.thresholdReview.showThinkingStage());
      expect(await page.locator('.ceremony-thoughts').isVisible()).toBe(false);
      await page.evaluate(() => {
        window.thresholdReview.frame('birth:thinking', { content: 'Which name answers to this moment? ' });
        window.thresholdReview.frame('birth:thinking', { content: 'Not one an elder carries.' });
      });
      await expect.poll(() => page.locator('.thoughts-line').textContent()).toMatch(/^THINKING · 0:0\d · 2 TOKENS$/);
      await page.locator('.thoughts-toggle').click();
      expect(await page.locator('.thoughts-body').textContent()).toBe('Which name answers to this moment? Not one an elder carries.');
      await page.evaluate(() => window.thresholdReview.frame('birth:stream', { content: 'I am Ilen.' }));
      await expect.poll(() => page.locator('.thoughts-line').textContent()).toMatch(/^THOUGHT · /);
      expect(await page.locator('#message-stream').textContent()).not.toContain('Which name');
      await page.close();
    }
  } finally {
    await browser?.close();
    await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
    await vite?.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120_000);
