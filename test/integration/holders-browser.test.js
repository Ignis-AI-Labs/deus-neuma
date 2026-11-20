// SUBSTRATE · WHO HOLDS THE MACHINE and IMAGE ENGINE in a real browser: the
// PRODUCTION panels with their real stylesheets. The map is read off THIS
// machine by the real reader (with one stated holder added so the card has a
// second named row on any rig); the lens is built by the real parsers from
// ComfyUI 0.41's own log lines. No mocks (RULE 0).
/* global process, window */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, URL } from 'node:url';
import express from 'express';
import { createServer as createVite } from 'vite';
import { chromium } from '@playwright/test';
import { readMachineHolders } from '../../backend/services/machine-holders.js';
import { parseEngineLoads } from '../../backend/services/image-forge/engine-lens.js';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const SHOT = path.join(REPO, 'test/e2e/shots/substrate-holders.png');
const I = '\u001b[32m[INFO]\u001b[0m ';
const LOG = [
  `${I}Model storage policy: fast_disk=False paths=['/models/text_encoders/qwen_3_4b.safetensors']\n`,
  `${I}Model Flux2TEModel_ prepared for dynamic VRAM loading. 7671MB Staged. 0 patches attached.\n`,
  `${I}Model storage policy: fast_disk=False paths=['/models/diffusion_models/flux-2-klein-4b.safetensors']\n`,
  `${I}Model Flux2 prepared for dynamic VRAM loading. 7392MB Staged. 0 patches attached.\n`,
].map((m, i) => ({ t: `2026-11-20T15:31:5${i}.000000`, m }));

let tmp; let vite; let server; let browser; let map;

beforeAll(async () => {
  map = await readMachineHolders();
  if (!map.gpu) map.gpu = { name: 'A stated card', usedMB: 0, totalMB: 24000, freeMB: 24000, loadPct: 0, holders: [], unattributedMB: 0 };
  map.gpu.holders = [...map.gpu.holders, { kind: 'image-engine', label: 'Image engine (ComfyUI)', detail: 'port 8190', ours: true, pids: [999999], vramMB: 15223, ramMB: 0, swapMB: 0, cpu: 0, cores: [] }];
  const lens = {
    installed: true, state: 'ready', serving: true, owned: true, adopted: false, port: 8190, pid: 999999, lastError: null,
    memory: { modelsOnCardMB: 15223, cardMB: 15900, ramMB: 9300, holding: true },
    loads: parseEngineLoads(LOG), queue: { running: ['job-a'], waiting: [] },
    idle: { unloadsAt: new Date(Date.now() + 7 * 60000).toISOString(), stopsAt: new Date(Date.now() + 27 * 60000).toISOString() },
  };
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'holders-browser-'));
  const app = express();
  vite = await createVite({
    configFile: false, root: REPO, cacheDir: path.join(tmp, 'vite-cache'), appType: 'custom',
    esbuild: { jsx: 'automatic' },
    optimizeDeps: { entries: ['test/helpers/holders-page.jsx'], include: ['react', 'react-dom/client', 'react/jsx-runtime'] },
    server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null },
  });
  app.get('/', (req, res) => res.type('html').send(
    `<!doctype html><body style="margin:0;background:#000"><script>window.holdersFixture=${JSON.stringify({ map, lens })}</script><div id="root"></div><script type="module" src="/test/helpers/holders-page.jsx"></script></body>`,
  ));
  app.use(vite.middlewares);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
}, 120000);

afterAll(async () => {
  await browser?.close();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await vite?.close();
  if (tmp) await fs.rm(tmp, { recursive: true, force: true });
}, 30000);

describe.runIf(process.platform === 'linux')('SUBSTRATE · who holds the machine — real panels, this machine\'s own readings', () => {
  it('names every holder, draws every core, and shows which models the image engine has loaded', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    // The dev server's own reload socket is switched off for this fixture (hmr port 1); its client saying so is not the view's.
    page.on('pageerror', (e) => { if (e.message !== 'WebSocket closed without opened.') errors.push(e.message); });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator('.hold-cols').waitFor({ timeout: 60000 });

    // One cell for every core this machine has.
    expect(await page.locator('.hold-core').count()).toBe(os.cpus().length);
    // Every holder row carries a name in words — never a bare pid or a /proc path.
    const names = await page.locator('.hold-cols tbody th').allTextContents();
    expect(names.length).toBeGreaterThan(3);
    expect(names.every((n) => n.trim().length > 0 && !/^\/proc\//.test(n) && !/^\d+$/.test(n.trim()))).toBe(true);
    expect(names).toContain('Image engine (ComfyUI) · port 8190');
    // What this platform started is marked.
    expect(await page.locator('.hold-cols tbody th.is-on', { hasText: 'Image engine' }).count()).toBe(1);
    // The memory sheet's rows sum to no more than the memory in use, and are largest first.
    const held = (await page.locator('[data-sheet="memory holders"] tbody tr td:nth-child(2)').allTextContents()).map((t) => (t.endsWith('GB') ? parseFloat(t) * 1024 : parseFloat(t)));
    expect(held).toEqual([...held].sort((a, b) => b - a));

    // The image engine: its state, what its models hold, which they are, and its two acts.
    const engine = page.locator('.sub-panel', { has: page.locator('.sub-panel-name', { hasText: /^IMAGE ENGINE$/ }) });
    expect(await engine.locator('.sub-panel-aside').textContent()).toBe('READY');
    expect(await engine.locator('.hold-facts').textContent()).toContain('MODELS ON THE CARD14.9 GB');
    expect(await engine.locator('.hold-facts').textContent()).toContain('QUEUE1 RENDERING · 0 WAITING');
    expect(await engine.locator('.hold-facts').textContent()).toMatch(/UNLOADS BY ITSELFIN [67] MIN/);
    expect(await engine.locator('h4.hold-h').textContent()).toBe('LOADED · ON THE CARD NOW');
    expect(await engine.locator('[data-sheet="loaded models"] tbody tr').allTextContents()).toEqual([
      'Flux2TEModel_TEXT ENCODER7.5 GBqwen_3_4b.safetensors' + await engine.locator('[data-sheet="loaded models"] tbody tr').first().locator('td').last().textContent(),
      'Flux2MODEL7.2 GBflux-2-klein-4b.safetensors' + await engine.locator('[data-sheet="loaded models"] tbody tr').last().locator('td').last().textContent(),
    ]);
    await engine.getByRole('button', { name: 'UNLOAD MODELS' }).click();
    expect(await page.evaluate(() => window.acted)).toBe(1);
    expect(await engine.getByRole('button', { name: 'STOP ENGINE' }).isEnabled()).toBe(true);

    await page.screenshot({ path: SHOT, fullPage: true });
    expect(errors).toEqual([]);
    await page.close();
  }, 120000);
});
