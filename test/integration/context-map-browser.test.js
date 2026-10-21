// CONTEXT MAP · COMPOSITION in a real browser: the PRODUCTION view and its real
// stylesheets, fed an event built by the REAL backend builder
// (buildCompositionEvent) — the window, the families as doors, the ranked
// sections, a cut named. The section sizes are a stated fixture (a live turn
// needs a being that can speak; the e2e covers that path). No mocks (RULE 0).
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
const SHOT = path.join(REPO, 'test/e2e/shots/context-map-composition.png');
const chars = (n) => ({ chars: n });
// Section ids exactly as the prompt assembler and the turn path name them.
const FIXTURE = {
  input: {
    sections: [
      { id: 'identity', label: 'IDENTITY', ...chars(9200) }, { id: 'genesis', label: 'GENESIS', ...chars(3100) },
      { id: 'voice', label: 'YOUR VOICE', ...chars(2400) }, { id: 'soul', label: 'SOUL', ...chars(4100) },
      { id: 'personality', label: 'PERSONALITY', ...chars(0) }, { id: 'silo', label: 'NITE', ...chars(1300) },
      { id: 'grounding', label: 'GROUNDING', ...chars(1800) }, { id: 'tools', label: 'TOOLS', ...chars(6900) },
      { id: 'skills', label: 'SKILLS', ...chars(1500) }, { id: 'intents', label: 'INTENTS', ...chars(0) },
      { id: 'present', label: 'PRESENT MOMENT', ...chars(600) }, { id: 'memory', label: 'MEMORY', ...chars(3800) },
      { id: 'plan', label: 'PLAN OF RECORD', ...chars(900) }, { id: 'tasks', label: 'WORKING STATE', ...chars(1200) },
      { id: 'session', label: 'SESSION', ...chars(500) }, { id: 'closing', label: 'CLOSING', ...chars(700) },
      { id: 'recentConversation', label: 'RECENT CONVERSATION', ...chars(14800) },
      { id: 'currentTurn', label: 'CURRENT TURN', ...chars(320) }, { id: 'toolRound1', label: 'TOOL ROUND 1', ...chars(8400) },
    ],
    standing: { promptTokens: 16600, source: 'measured' },
    usage: { promptTokens: 18700, completionTokens: 640 },
    budget: { contextTokens: 65536, source: 'provider-runtime' },
    cache: { cachedPromptTokens: 14200 },
    session: { compactionCount: 1, atBoundary: false },
    toolResults: [{ ref: 'tr_9f3a2c1b', tool: 'read_file', originalChars: 48210, sentChars: 6000, kind: 'reformatted' }],
  },
  shed: [{ id: 'taste', tokens: 420 }],
};

let tmp; let vite; let server; let browser;

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'context-map-browser-'));
  const app = express();
  vite = await createVite({
    configFile: false, root: REPO, cacheDir: path.join(tmp, 'vite-cache'), appType: 'custom',
    esbuild: { jsx: 'automatic' },
    optimizeDeps: { entries: ['test/helpers/context-map-page.jsx'], include: ['react', 'react-dom/client', 'react/jsx-runtime'] },
    server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null },
  });
  app.get('/', (req, res) => res.type('html').send(
    `<!doctype html><body style="margin:0;background:#000"><script>window.compositionFixture=${JSON.stringify(FIXTURE)}</script><div id="root"></div><script type="module" src="/test/helpers/context-map-page.jsx"></script></body>`,
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

describe('CONTEXT MAP · COMPOSITION — real view, real styles, real builder', () => {
  it('the window, the families as doors, the ranked sections, the cut named', async () => {
    const page = await browser.newPage({ viewport: { width: 1212, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator('.ctx-window').waitFor({ timeout: 60000 });

    // THE WINDOW: standing input + output against the budget, drawn to scale.
    expect(await page.locator('.ctx-window-of').textContent()).toBe('OF 65,536 · 26% USED · 48,296 LEFT');
    const bar = await page.locator('.ctx-window-bar').boundingBox();
    const input = await page.locator('.ctx-window-bar .ctx-part-input').boundingBox();
    expect(input.width / bar.width).toBeCloseTo(16600 / 65536, 2);

    // WHAT FILLS IT: a family press leaves only its sections; again returns all.
    const secs = page.locator('.ctx-sec');
    const all = await secs.count();
    await page.locator('.ctx-fam', { hasText: 'IDENTITY' }).click();
    const identity = await secs.evaluateAll((els) => els.map((e) => e.className));
    expect(identity.length).toBeGreaterThan(0);
    expect(identity.every((c) => c.includes('ctx-fam-identity'))).toBe(true);
    await page.locator('.ctx-fam', { hasText: 'IDENTITY' }).click();
    expect(await secs.count()).toBe(all);

    // WHAT WAS CUT: the shed section stands loud.
    expect(await page.locator('.ctx-cut.is-loud').first().textContent()).toContain('TASTE ~420');

    await page.screenshot({ path: SHOT, fullPage: true });
    expect(errors).toEqual([]);
    await page.close();
  }, 120000);
});
