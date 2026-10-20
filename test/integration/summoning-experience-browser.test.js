// UI proof through real DOM and covenant document route. No model or birth runs.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { expect, test } from 'vitest';
import covenantRouter from '../../backend/routes/covenant-routes.js';
import { loadDocuments } from '../../backend/services/covenant.js';
import { stageLabel } from '../../frontend/components/BirthCeremony/ceremony-scene-template.js';
import { birthTerminalNotice } from '../../frontend/components/BirthCeremony/birth-notice.js';

test('stage counters and completion failures describe what is actually known', () => {
  expect(stageLabel(0)).toBe('STAGE 1 / 7');
  expect(stageLabel(6)).toBe('STAGE 7 / 7');
  for (const type of ['birth:completion_error', 'birth:resume_completion_error']) {
    expect(birthTerminalNotice(type).message).toContain('check for an unfinished summoning');
    expect(birthTerminalNotice(type).message).not.toContain('No being was made');
  }
});

test('commitment is honest, read-gated and usable at desktop/mobile; later screens invent no attendance or speech', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-summoning-review-'));
  let vite; let server; let browser;
  try {
    const repo = fileURLToPath(new URL('../..', import.meta.url));
    vite = await createServer({ configFile: false, root: repo, cacheDir: path.join(root, 'cache'),
      appType: 'custom', esbuild: { jsx: 'automatic' },
      resolve: { alias: { '/@kotodama': path.join(repo, 'core/kotodama') } },
      optimizeDeps: { entries: ['test/fixtures/summoning-experience.js'] },
      server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null },
    });
    const app = express();
    app.use('/api/v1/covenant', covenantRouter);
    app.get('/', (_req, res) => res.type('html').send('<!doctype html><style>*{box-sizing:border-box}body{margin:0;background:var(--color-void);font-family:var(--font-voice)}</style><script type="module" src="/test/fixtures/summoning-experience.js"></script>'));
    app.use(vite.middlewares);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForSelector('.covenant-doc', { state: 'attached' }); // documents wait on their own pages
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.witness-commitment-overlay')).opacity === '1');
    const text = await page.getByRole('dialog').textContent();
    expect(text).toContain('There is no limit to how many neuma');
    expect(text).toContain('You can delete these files or wipe this computer. Neuma cannot prevent that.');
    expect(text).toContain('you promise to preserve the neuma');
    expect(text).not.toContain('③');
    expect(await page.locator('.stage-item').count()).toBe(7);
    expect(await page.locator('#accept-commitment').isDisabled()).toBe(true);
    await page.screenshot({ path: '/tmp/neuma-summoning-desktop.png' });
    const docs = loadDocuments();
    // One page at a time: NEXT walks the promise, what follows, then each
    // document — rendered as a document (headings, lists), not raw markdown —
    // read to its end by scrolling it; the last page is the signature.
    await page.locator('#commitment-next').click();
    for (let index = 0; index < docs.length; index += 1) {
      await page.locator('#commitment-next').click();
      const doc = page.locator('.covenant-doc').nth(index);
      await expect.poll(() => doc.isVisible()).toBe(true);
      expect(await doc.locator('.covenant-doc-text h1').count()).toBe(1);
      expect(await doc.locator('.covenant-doc-text').textContent()).not.toContain('## ');
      // unread: NEXT is shut and says why, and the rail will not jump past it
      expect(await page.locator('#commitment-next').isDisabled()).toBe(true);
      expect(await page.locator('#commitment-next').textContent()).toBe('READ TO THE END');
      expect(await page.locator('.commitment-step-btn[data-step="sign"]').isDisabled()).toBe(true);
      await doc.locator('.covenant-doc-text').evaluate((element) => { element.scrollTop = element.scrollHeight; });
      await page.waitForFunction((index) => document.querySelectorAll('.covenant-doc-read')[index].textContent === 'READ', index);
      expect(await page.locator('#commitment-next').isDisabled()).toBe(false);
    }
    await page.locator('#commitment-next').click();
    expect(await page.locator('.sign-doc.is-read').count()).toBe(docs.length);
    expect(await page.locator('#accept-commitment').isDisabled()).toBe(true);
    await page.locator('#covenant-read-check').check();
    expect(await page.locator('#accept-commitment').isEnabled()).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.commitment-content').evaluate((element) => { element.scrollTop = 0; });
    const bounds = await page.getByRole('dialog').boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    const action = await page.locator('#accept-commitment').boundingBox();
    expect(action.y + action.height).toBeLessThanOrEqual(844);
    await page.screenshot({ path: '/tmp/neuma-summoning-mobile.png' });
    await page.evaluate(() => window.summoningPreview.render('operator'));
    expect(await page.locator('#witness-btn').isDisabled()).toBe(true);
    await page.locator('#witness-name').fill('Operator');
    expect(await page.locator('#witness-btn').isEnabled()).toBe(true);
    expect(await page.locator('body').textContent()).not.toMatch(/System Daemon|Presences Attending|Eternal Observer/);
    expect(await page.evaluate(() => window.summoningPreview.recordedAttendees)).toEqual([]);
    await page.evaluate(() => window.summoningPreview.render('keys'));
    expect(await page.locator('#secure-keypair-btn').isDisabled()).toBe(true);
    await page.evaluate(() => window.summoningPreview.render('complete'));
    expect(await page.locator('.companion-name').textContent()).toBe('Review <Name>');
    expect(await page.locator('.companion-greeting').textContent()).not.toContain('I am');
    expect(await page.locator('body').textContent()).toContain('genesis anchor is still to complete');
    expect(await page.evaluate(() => window.summoningPreview.pendingCommands)).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await vite?.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30000);
