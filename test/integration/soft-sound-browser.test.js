// Real Chromium, real Vite (with the text-scale compile), the real sound
// engine, renderer and text-size store — no mock, no spy, nothing faked.
// Design note, 2026-10-28: the desk speaks SOFT by default, its board is clean, and
// the reading size is one corner away before the desk exists.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { textScaleCss } from '../../scripts/text-scale-css.mjs';
import { SOFT_PACK } from '../../frontend/services/soft-sound/soft-cues.js';
import { cueLabel } from '../../frontend/services/sound-board.js';

const CUES = Object.keys(SOFT_PACK.cues);
let root; let vite; let server; let browser; let url;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-soft-sound-'));
  vite = await createServer({ configFile: false,
    root: fileURLToPath(new URL('../..', import.meta.url)), cacheDir: path.join(root, 'cache'),
    appType: 'custom', esbuild: { jsx: 'automatic' },
    css: { postcss: { plugins: [textScaleCss()] } },
    optimizeDeps: { entries: ['test/fixtures/soft-sound.jsx'] },
    // No HMR socket (see execution-sounds-browser.test.js for why port 1).
    server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null },
  });
  server = http.createServer((req, res) => {
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><div id="root"></div><script type="module" src="/test/fixtures/soft-sound.jsx"></script>');
    } else vite.middlewares(req, res);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  url = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
}, 60000);

afterAll(async () => {
  await browser?.close();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await vite?.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

const openPage = async () => {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  await page.locator('[data-pack="soft"]').waitFor();
  return { page, errors };
};

test('the board speaks SCI-FI by default, as the platform always has; SOFT is a kept choice, grouped and plainly named', async () => {
  const { page, errors } = await openPage();
  // a new install hears the platform's own sounds — nothing chosen, nothing changed
  expect(await page.locator('[data-pack="scifi"]').getAttribute('aria-pressed')).toBe('true');
  expect(await page.evaluate(() => localStorage.getItem('neuma-sound-pack'))).toBeNull();
  expect(await page.locator('[data-cue="confirm"] .settings-cue-len').textContent()).toBe('375ms');

  // SOFT: chosen, kept across a reload, and the board reads its own cues
  await page.locator('[data-pack="soft"]').click();
  expect(await page.evaluate(() => localStorage.getItem('neuma-sound-pack'))).toBe('soft');
  await page.reload();
  await page.locator('[data-pack="soft"][aria-pressed="true"]').waitFor();
  expect(await page.locator('.settings-board-h').allTextContents()).toEqual([
    'YOUR CONTROLS — 5', 'NOTICES — 9', 'A BEING AT WORK — 14', 'MORE ACTS — 6',
  ]);
  for (const cue of CUES) {
    const row = page.locator(`[data-cue="${cue}"]`);
    expect(await row.count(), cue).toBe(1);
    expect(await row.locator('.settings-cue-name').textContent()).toBe(cueLabel(cue));
    await row.click(); // the real engine renders and plays it
  }
  for (const unused of ['klaxon', 'dataTypeOn', 'levelUp']) expect(await page.locator(`[data-cue="${unused}"]`).count()).toBe(0);
  expect(await page.locator('[data-cue="confirm"] .settings-cue-len').textContent()).toBe('410ms');

  // Every soft cue, rendered in THIS browser the way the engine makes its
  // buffer (renderCue → createBuffer → copyToChannel), heard through Web Audio.
  // (passed as source: vitest rewrites a dynamic import() inside a function)
  const heard = await page.evaluate(`(async (cues) => {
    const { renderCue } = await import('/frontend/services/soft-sound/soft-render.js');
    const rows = [];
    for (const cue of cues) {
      const samples = renderCue(cue, 48000);
      const context = new OfflineAudioContext(1, samples.length, 48000);
      const buffer = context.createBuffer(1, samples.length, 48000);
      buffer.copyToChannel(samples, 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.start(0);
      const out = (await context.startRendering()).getChannelData(0);
      const rms = Math.sqrt(out.reduce((sum, x) => sum + x * x, 0) / out.length);
      const digest = await crypto.subtle.digest('SHA-256', out.buffer);
      rows.push({ cue, rms, hash: Array.from(new Uint8Array(digest)).join(',') });
    }
    return rows;
  })(${JSON.stringify(CUES)})`);
  heard.forEach(({ cue, rms }) => expect(rms, cue).toBeGreaterThan(0.005));
  expect(new Set(heard.map(({ hash }) => hash)).size).toBe(CUES.length);

  // back to SCI-FI: chosen, kept, and it LOOKS chosen once its 140 ms fade
  // lands — the chosen voice wears the signal
  await page.locator('[data-pack="scifi"]').click();
  expect(await page.evaluate(() => localStorage.getItem('neuma-sound-pack'))).toBe('scifi');
  expect(await page.locator('[data-pack="scifi"]').getAttribute('aria-pressed')).toBe('true');
  expect(await page.locator('[data-pack="soft"]').getAttribute('aria-pressed')).toBe('false');
  expect(await page.locator('[data-cue="confirm"] .settings-cue-len').textContent()).toBe('375ms');
  const colorOf = (pack) => page.locator(`[data-pack="${pack}"]`).evaluate((el) => getComputedStyle(el).color);
  await expect.poll(() => colorOf('scifi')).toBe('rgb(79, 214, 232)');
  expect(await colorOf('soft')).not.toBe('rgb(79, 214, 232)');
  await page.screenshot({ path: path.join(os.tmpdir(), 'neuma-soft-soundboard.png'), fullPage: true });
  expect(errors).toEqual([]);
  await page.close();
}, 60000);

test('the reading size is one corner away: larger, smaller, reset, kept across a reload', async () => {
  const { page, errors } = await openPage();
  const open = page.getByRole('button', { name: 'Text size', exact: true });
  await open.click();
  const value = page.locator('.tsq-value');
  expect(await value.textContent()).toBe('100%');
  expect(await page.getByRole('button', { name: 'Smaller text' }).isDisabled()).toBe(true);
  const fontOf = () => value.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const base = await fontOf();
  await page.getByRole('button', { name: 'Larger text' }).click();
  await page.getByRole('button', { name: 'Larger text' }).click();
  expect(await value.textContent()).toBe('120%');
  expect(await fontOf()).toBeCloseTo(base * 1.2, 1);
  expect(await page.evaluate(() => localStorage.getItem('neuma-text-size'))).toBe('120');
  await page.screenshot({ path: path.join(os.tmpdir(), 'neuma-text-size-quick.png') });
  // Escape puts it away; a reload keeps the size
  await page.keyboard.press('Escape');
  expect(await page.locator('.tsq-panel').count()).toBe(0);
  await page.reload();
  await page.getByRole('button', { name: 'Text size', exact: true }).click();
  expect(await page.locator('.tsq-value').textContent()).toBe('120%');
  await page.getByRole('button', { name: 'RESET' }).click();
  expect(await page.locator('.tsq-value').textContent()).toBe('100%');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--text-scale').trim())).toBe('1');
  // a press anywhere else puts it away too
  await page.mouse.click(900, 40);
  expect(await page.locator('.tsq-panel').count()).toBe(0);
  expect(errors).toEqual([]);
  await page.close();
}, 60000);
