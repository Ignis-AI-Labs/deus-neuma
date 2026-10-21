import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { expect, test } from 'vitest';
import { EXECUTION_CUES, actionCueLabel } from '../../frontend/services/execution-sounds.js';

test('history command stays readable and every execution sound has audible, distinct decoded samples', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'execution-sound-browser-'));
  let vite; let server; let browser;
  try {
    vite = await createServer({ configFile: false,
      root: fileURLToPath(new URL('../..', import.meta.url)), cacheDir: path.join(root, 'cache'),
      appType: 'custom', esbuild: { jsx: 'automatic' },
      optimizeDeps: { entries: ['test/fixtures/execution-sounds.jsx'] },
      // No HMR socket; the client dials a port the browser refuses — hmr:false still
      // aimed it at :24678, where any other Vite on the box answers and the page reloads.
      server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null },
    });
    server = http.createServer((req, res) => {
      if (req.url === '/') {
        res.setHeader('Content-Type', 'text/html');
        res.end('<!doctype html><div id="root"></div><script type="module" src="/test/fixtures/execution-sounds.jsx"></script>');
      } else vite.middlewares(req, res);
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
    const page = await browser.newPage({ viewport: { width: 640, height: 1000 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const chip = page.locator('#execution .tool-chip-summary');
    await chip.waitFor();
    expect(await chip.textContent()).toContain('BUILD · npm run build');
    expect(await chip.textContent()).toContain('bundle.js — exit 0');
    expect(await chip.evaluate((el) => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight)).toBe(true);
    await page.getByRole('button', { name: 'Show action detail' }).click();
    expect(await page.locator('.tool-chip-detail').textContent()).toBe('stdout: build complete');
    await page.getByRole('button', { name: 'SOUND — OFF', exact: true }).click();
    for (const cue of EXECUTION_CUES) {
      const row = page.locator(`[data-cue="${cue}"]`);
      expect(await row.count()).toBe(1);
      expect(await row.textContent()).toContain(actionCueLabel(cue));
      await row.click();
    }
    // Decode the shipped artifact and actually render each slice via Web Audio.
    // This verifies PCM output without replacing or spying on the audio engine.
    const rendered = await page.evaluate(async (cues) => {
      const index = await (await fetch('/frontend/sounds-baked/sprite.json')).json();
      const bytes = await (await fetch('/frontend/sounds-baked/sprite.opus')).arrayBuffer();
      const decoder = new OfflineAudioContext(1, 1, 48000);
      const buffer = await decoder.decodeAudioData(bytes);
      const rows = [];
      for (const cue of cues) {
        const { start, duration } = index.events[cue];
        if (start + duration > buffer.duration + .001) throw new Error(`${cue} exceeds sprite`);
        const context = new OfflineAudioContext(1, Math.ceil(duration * 48000), 48000);
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        source.start(0, start, duration);
        const samples = (await context.startRendering()).getChannelData(0);
        const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
        const digest = await crypto.subtle.digest('SHA-256', samples.buffer);
        rows.push({ cue, rms, hash: Array.from(new Uint8Array(digest)).join(',') });
      }
      return rows;
    }, EXECUTION_CUES);
    expect(rendered.every(({ rms }) => rms > .0001)).toBe(true);
    expect(new Set(rendered.map(({ hash }) => hash)).size).toBe(EXECUTION_CUES.length);
    await page.screenshot({ path: '/tmp/neuma-execution-soundboard.png', fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await vite?.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 60000);
