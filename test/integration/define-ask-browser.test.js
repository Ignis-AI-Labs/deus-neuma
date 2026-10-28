// DEFINE's ASK IN CHAT, in real Chromium with the production composer: the
// live selection gives the sentence and the chat window it was read in
// (define-context.js), and the question DefineCard dispatches lands in THAT
// window's draft — appended, focused, never sent. No mock anywhere: the
// event dispatched is the card's own contract (`neuma:ask` on the composer).
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { expect, test } from 'vitest';

test('a word read in one chat is asked about in that chat — drafted, never sent', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-define-ask-'));
  let vite; let server; let browser;
  try {
    vite = await createServer({ configFile: false,
      root: fileURLToPath(new URL('../..', import.meta.url)), cacheDir: path.join(root, 'cache'),
      appType: 'custom', esbuild: { jsx: 'automatic' },
      optimizeDeps: { entries: ['test/fixtures/define-ask.jsx'] },
      server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null },
    });
    server = http.createServer((req, res) => {
      if (req.url === '/') {
        res.setHeader('Content-Type', 'text/html');
        res.end('<!doctype html><div id="root"></div><script type="module" src="/test/fixtures/define-ask.jsx"></script>');
      } else vite.middlewares(req, res);
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
    const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const field = (id) => page.locator(`[data-window-id="${id}"] textarea.relink-input-field`);
    await field('w2').waitFor();
    await field('w1').fill('my own half-typed words');

    // select "pedantic" in the second window's prose, as a right-click would find it,
    // then do exactly what the menu and the card do (passed as source: vitest
    // rewrites a dynamic import() inside a function)
    const asked = await page.evaluate(`(async () => {
      const { defineContextNow } = await import('/frontend/components/DesktopContextMenu/define-context.js');
      const { askTextFor } = await import('/frontend/components/DesktopContextMenu/define-view.js');
      const p = document.querySelector('[data-window-id="w2"] .prose');
      const node = p.firstChild; const at = node.data.indexOf('pedantic');
      const range = document.createRange(); range.setStart(node, at); range.setEnd(node, at + 8);
      getSelection().removeAllRanges(); getSelection().addRange(range);
      const { sentence, composer } = defineContextNow();
      const text = askTextFor('pedantic', sentence);
      composer.dispatchEvent(new CustomEvent('neuma:ask', { detail: { text } }));
      return { sentence, window: composer.closest('[data-window-id]').dataset.windowId, text };
    })()`);
    expect(asked.sentence).toBe("And that's not a pedantic point — it's the whole thing!");
    expect(asked.window).toBe('w2');
    await expect.poll(() => field('w2').inputValue()).toBe(asked.text);
    expect(await field('w1').inputValue()).toBe('my own half-typed words');
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[data-window-id]')?.dataset.windowId)).toBe('w2');

    // asked again into a box that already holds words: a line of its own, nothing lost
    await page.evaluate(`document.querySelector('[data-window-id="w1"] textarea.relink-input-field')
      .dispatchEvent(new CustomEvent('neuma:ask', { detail: { text: 'What does “else” mean?' } }))`);
    await expect.poll(() => field('w1').inputValue()).toBe('my own half-typed words\nWhat does “else” mean?');
    // drafted, never sent
    expect(await page.locator('.sent').allTextContents()).toEqual(['', '']);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await vite?.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 60000);
