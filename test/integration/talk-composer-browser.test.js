/* global window, document */
// ONE PLACE FOR VOICE (Design note, 2026-11-13: […]). The real
// composer (StreamInput.jsx) with the chat's real TALK (ComposerTools.jsx) in its slot, built by
// vite with the real translations and styles, in a real Chromium: TALK sits in the composer row
// beside the mic and SEND, there is no LIVE anywhere, the mic still dictates on its own, and TALK
// enters the voice sitting and leaves it. A composer given no TALK (the council's) shows none.
// The sitting's own voice path (portal, speech service) is test/integration/portal-voice-stream.test.js.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { chromium, expect as pw } from '@playwright/test';
import { test, expect, beforeAll, afterAll } from 'vitest';

let root; let server; let browser; let origin;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'talk-composer-'));
  const { build } = await import('vite');
  const bundle = await build({ configFile: false, root: process.cwd(), logLevel: 'error',
    esbuild: { jsx: 'automatic' },
    build: { write: false, outDir: path.join(root, 'bundle'),
      rollupOptions: { input: path.resolve('test/fixtures/talk-composer.jsx') } },
  });
  const app = express();
  for (const file of bundle.output) {
    app.get(`/${file.fileName}`, (_req, res) => res.type(path.extname(file.fileName)).send(file.type === 'chunk' ? file.code : file.source));
  }
  const entry = bundle.output.find((file) => file.type === 'chunk' && file.isEntry).fileName;
  const styles = bundle.output.filter((file) => file.fileName.endsWith('.css')).map((file) => `<link rel="stylesheet" href="/${file.fileName}">`).join('');
  app.get('/', (_req, res) => res.type('html').send(`${styles}<body style="background:#0d1117"><div id="root"></div><script type="module" src="/${entry}"></script></body>`));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ args: ['--disable-gpu'] });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  server?.closeAllConnections();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  if (root) await fs.rm(root, { recursive: true, force: true });
});

test('TALK is the one voice button, in the composer row beside the mic; LIVE is gone; TALK enters and leaves the sitting', async () => {
  const page = await browser.newPage({ viewport: { width: 960, height: 320 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  await page.waitForFunction(() => window.composerReady);

  const talk = page.getByRole('button', { name: 'TALK', exact: true });
  await pw(talk).toBeVisible();
  await pw(page.getByText('LIVE', { exact: true })).toHaveCount(0);
  await pw(page.locator('.relink-live')).toHaveCount(0);

  // the row, left to right: TALK, the mic, SEND — one line, TALK first
  const row = await page.evaluate(() => [...document.querySelectorAll('.relink-input .relink-talk, .relink-input .relink-mic, .relink-input .relink-send')]
    .map((b) => ({ cls: b.className, top: Math.round(b.getBoundingClientRect().top), left: Math.round(b.getBoundingClientRect().left) })));
  const talkAt = row.findIndex((b) => b.cls.includes('relink-talk'));
  const micAt = row.findIndex((b) => b.cls.includes('relink-mic'));
  const sendAt = row.findIndex((b) => /\brelink-send\b/.test(b.cls));
  expect(talkAt).toBeGreaterThanOrEqual(0);
  expect(talkAt).toBeLessThan(micAt);
  expect(micAt).toBeLessThan(sendAt);
  expect(new Set([row[talkAt].top, row[micAt].top, row[sendAt].top]).size).toBe(1);
  expect(row[talkAt].left).toBeLessThan(row[micAt].left);

  // the mic dictates on its own: nothing about it waits on a voice mode any more
  await pw(page.locator('.relink-mic')).toBeEnabled();
  await pw(page.locator('.relink-mic')).toHaveAttribute('title', /hold/i);
  await page.screenshot({ path: path.join(os.tmpdir(), 'talk-composer-960.png') });

  // TALK enters the sitting, and says what pressing it again does
  await pw(talk).toHaveAttribute('aria-pressed', 'false');
  await talk.click();
  await pw(page.locator('#sitting')).toHaveText('sitting');
  await pw(talk).toHaveAttribute('aria-pressed', 'true');
  await pw(talk).toHaveClass(/is-on/);
  await talk.click();
  await pw(page.locator('#sitting')).toHaveText('desk');

  // typing and sending are untouched
  await page.locator('.relink-input-field').fill('hello');
  await page.keyboard.press('Enter');
  await pw(page.locator('#sent')).toHaveText('hello');
  expect(errors).toEqual([]);
  await page.close();
}, 60_000);
