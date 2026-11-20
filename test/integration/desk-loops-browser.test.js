/* global window, setTimeout */
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { build } from 'vite';
import { chromium } from '@playwright/test';
import { test, expect } from 'vitest';

// ONE LOOP AT A TIME, NONE LEFT BEHIND (sound-engine.js startLoop/stopLoop, desk-loops.js) — Design note, 2026-11-20, two chats
// at work at once: […] The real engine and the real sprite in a real browser; the page counts the audio sources that
// are playing (AudioBufferSourceNode start/stop, observed, not replaced). A loop stopped while its sound was still
// loading used to start anyway, and a second start meanwhile played a second copy nobody could stop. Then two chats
// flip their loops as one's words come in bursts while the other thinks: one loop plays, and it does not flip-flop.
test('a loop stopped while it loads never plays; asked twice it plays once; two chats at work hear one loop, no flip-flop', async () => {
  let server; let browser;
  try {
    const entryId = 'virtual:desk-loops.js';
    const file = (name) => JSON.stringify(path.resolve(`frontend/${name}`));
    const source = `
      // Observe every source the engine plays: started, and not yet stopped (or ended).
      const live = new Set();
      const start = AudioBufferSourceNode.prototype.start;
      const stop = AudioBufferSourceNode.prototype.stop;
      AudioBufferSourceNode.prototype.start = function (...a) { live.add(this); this.addEventListener('ended', () => live.delete(this)); return start.apply(this, a); };
      AudioBufferSourceNode.prototype.stop = function (...a) { const r = stop.apply(this, a); this.addEventListener('ended', () => live.delete(this)); return r; };
      window.liveSources = () => live.size;
      window.started = 0;
      const engine = await import(${file('services/sound-engine.js')});
      const loops = await import(${file('app/RelinkShell/desk-loops.js')});
      window.engine = engine; window.loops = loops; window.ready = true;`;
    const bundle = await build({ configFile: false, logLevel: 'error',
      plugins: [{ name: 'desk-loops', resolveId: (id) => (id === entryId ? id : null), load: (id) => (id === entryId ? source : null) }],
      build: { write: false, target: 'esnext', rollupOptions: { input: entryId } } });
    const app = express();
    for (const asset of bundle.output) app.get(`/${asset.fileName}`, (_req, res) => res.type(path.extname(asset.fileName)).send(asset.type === 'chunk' ? asset.code : asset.source));
    const entry = bundle.output.find((asset) => asset.type === 'chunk' && asset.isEntry).fileName;
    app.get('/', (_req, res) => res.type('html').send(`<body><script type="module" src="/${entry}"></script></body>`));
    server = http.createServer(app); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ args: ['--disable-gpu', '--autoplay-policy=no-user-gesture-required'] });
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.ready === true);
    const settle = (ms = 400) => page.waitForTimeout(ms);
    const live = () => page.evaluate(() => window.liveSources());

    // The engine: stopped while it loads → never plays; asked twice → one copy, and it stops.
    await page.evaluate(() => { window.engine.startLoop('neumaThinking'); window.engine.stopLoop('neumaThinking'); });
    await settle();
    expect(await live()).toBe(0);
    await page.evaluate(() => { window.engine.startLoop('neumaThinking'); window.engine.startLoop('neumaThinking'); });
    await settle();
    expect(await live()).toBe(1);
    await page.evaluate(() => window.engine.stopLoop('neumaThinking'));
    await settle();
    expect(await live()).toBe(0);

    // The desk: chat B thinks the whole time while chat A's words come in bursts with gaps between.
    await page.evaluate(() => window.loops.wantLoop('neumaThinking', true));
    await settle();
    expect(await page.evaluate(() => window.loops.playingLoop())).toBe('neumaThinking');
    const swaps = await page.evaluate(async () => {
      const seen = [];
      const note = () => { const now = window.loops.playingLoop(); if (seen.at(-1) !== now) seen.push(now); };
      for (let burst = 0; burst < 8; burst += 1) {
        window.loops.wantLoop('neumaReplying', true); note();
        await new Promise((r) => setTimeout(r, 120)); note();
        window.loops.wantLoop('neumaReplying', false); note();
        await new Promise((r) => setTimeout(r, 200)); note(); // a gap between bursts
      }
      return seen;
    });
    // Words took the desk once, and held it through every gap: no flip-flop back to thinking.
    expect(swaps).toEqual(['neumaReplying']);
    await settle(1200); // the words are done: after the hold, thinking comes back, once
    expect(await page.evaluate(() => window.loops.playingLoop())).toBe('neumaThinking');
    expect(await live()).toBe(1); // one loop sounding, never two
    await page.evaluate(() => window.loops.wantLoop('neumaThinking', false));
    await settle(800);
    expect(await page.evaluate(() => window.loops.playingLoop())).toBe(null);
    expect(await live()).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close(); server?.closeAllConnections();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
  }
}, 120_000);
