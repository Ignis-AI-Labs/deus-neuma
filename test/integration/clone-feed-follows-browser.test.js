/* global window, Event */
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { build } from 'vite';
import { chromium } from '@playwright/test';
import { test, expect } from 'vitest';

// A LONG CLONE STAYS FOLLOWED (CloneChannels.jsx CloneFeed) — Design note, 2026-11-20: […] A clone's feed keeps its last CLONE_FEED_MAX steps; following
// keyed on the feed's length stood still once a long clone passed it, so the view stopped while the clone kept working.
// Real dock, real browser, the split driven by the real frame reducer past the cap: the newest step stays in view.
test('a clone past its feed\'s cap keeps its newest step in view while it works; scrolled up, it stays where the reader stands', async () => {
  let server; let browser;
  try {
    const entryId = 'virtual:clone-feed-follows.jsx';
    const file = (name) => JSON.stringify(path.resolve(`frontend/${name}`));
    const source = `import React, { useState } from 'react'; import {createRoot} from 'react-dom/client';
      import {CloneDock} from ${file('app/RelinkShell/CloneChannels.jsx')};
      import {applyCloneFrame} from ${file('app/RelinkShell/clone-split.js')};
      import ${file('styles/tokens.css')};
      import ${file('app/RelinkShell/RelinkShell.css')};
      localStorage.setItem('neuma.cloneDockSize', 'open');
      const SPLIT = 'sp-long';
      let split = applyCloneFrame(null, { type: 'clone:split', splitId: SPLIT, background: true, clones: [{ index: 1, title: 'Subject sweep', task: 'Re-stage every email' }] });
      split = applyCloneFrame(split, { type: 'clone:state', splitId: SPLIT, index: 1, state: 'working' });
      const App = () => {
        const [s, set] = useState(split);
        // An act alone (one short line), or — as a working clone does — a paragraph of its words, then an act.
        window.step = (i, words) => set((was) => {
          let next = words ? applyCloneFrame(was, { type: 'clone:text', splitId: SPLIT, index: 1, chunk: 'Read email ' + i + ' in full: its subject still opens with the old line, so it is re-staged with the company first and the reason in title case, and the rest of the email is kept word for word as it was approved. ' }) : was;
          next = applyCloneFrame(next, { type: 'clone:tool', splitId: SPLIT, index: 1, act: { tool: 'intents/sales_draft-email', status: 'executing', summary: 'staging email ' + i } });
          next = applyCloneFrame(next, { type: 'clone:tool', splitId: SPLIT, index: 1, act: { tool: 'intents/sales_draft-email', status: 'ok', summary: 'staged email ' + i } });
          return next;
        });
        const messages = [{ role: 'neuma', segments: [{ kind: 'tool', phase: 'done', label: 'team/shadow_clone', split: s }] }];
        return <div style={{ height: 520, width: 640, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}><CloneDock messages={messages} /></div>;
      };
      createRoot(document.getElementById('root')).render(<App />);`;
    const bundle = await build({ configFile: false, logLevel: 'error', esbuild: { jsx: 'automatic', loader: 'jsx' },
      plugins: [{ name: 'clone-feed-follows', resolveId: (id) => (id === entryId ? id : null), load: (id) => (id === entryId ? source : null) }],
      build: { write: false, rollupOptions: { input: entryId } } });
    const app = express();
    for (const asset of bundle.output) app.get(`/${asset.fileName}`, (_req, res) => res.type(path.extname(asset.fileName)).send(asset.type === 'chunk' ? asset.code : asset.source));
    const entry = bundle.output.find((asset) => asset.type === 'chunk' && asset.isEntry).fileName;
    const styles = bundle.output.filter((asset) => asset.fileName.endsWith('.css')).map((asset) => `<link rel="stylesheet" href="/${asset.fileName}">`).join('');
    app.get('/', (_req, res) => res.type('html').send(`${styles}<body style="margin:0"><div id="root"></div><script type="module" src="/${entry}"></script></body>`));
    server = http.createServer(app); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ args: ['--disable-gpu'] });
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => typeof window.step === 'function');

    const feed = page.locator('[data-clone-feed="1"]');
    const gap = () => feed.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
    // To the cap (160 steps) with short acts, one at a time as a clone's frames come.
    for (let i = 1; i <= 160; i += 1) await page.evaluate((n) => window.step(n, false), i);
    await expect.poll(() => feed.locator('li').count()).toBe(160);
    expect(await gap()).toBeLessThanOrEqual(2);
    // Past it, the clone says a paragraph and acts, step after step: short lines leave the top, tall ones come in.
    for (let i = 161; i <= 200; i += 1) await page.evaluate((n) => window.step(n, true), i);
    expect(await feed.locator('li').count()).toBe(160);
    expect(await feed.locator('li').last().textContent()).toBe('staged email 200');
    expect(await gap()).toBeLessThanOrEqual(2); // the newest step is in view
    // The reader scrolls up to read: the view stands where they stand while the clone keeps working.
    await feed.evaluate((el) => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); });
    for (let i = 201; i <= 205; i += 1) await page.evaluate((n) => window.step(n, true), i);
    expect(await feed.evaluate((el) => el.scrollTop)).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close(); server?.closeAllConnections();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
  }
}, 120_000);
