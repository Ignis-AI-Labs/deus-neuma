// TWO OPERATOR STATES — the harness and the full platform keep separate desks
// (Design note, 2026-10-14: […]). Signed in as the
// harness, the desk came up as the full desk: Cael bound, the full desk's
// tabs and HOUSE window restored — both modes read one set of keys.
//
// Proven in a real Chromium with real localStorage/sessionStorage, through the
// real modules (served by vite): the companion stores, the desk layout and
// tab stores, the wallet-scoped shelf, and the language preference
// (test/fixtures/operator-states.js).
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { expect, test } from 'vitest';

test('the harness and the full platform each keep their own companion and desk; the harness reads no house; the language stays the operator\'s', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-operator-states-'));
  let vite; let server; let browser;
  try {
    const repo = fileURLToPath(new URL('../..', import.meta.url));
    vite = await createServer({ configFile: false, root: repo, cacheDir: path.join(root, 'cache'), appType: 'custom',
      server: { middlewareMode: true, hmr: false, watch: null } });
    const app = express();
    app.get('/', (_q, res) => res.type('html').send('<!doctype html><body><script type="module" src="/test/fixtures/operator-states.js"></script>'));
    app.use(vite.middlewares);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);

    await page.waitForFunction(() => typeof window.__operatorStates === 'function');
    const result = await page.evaluate(() => window.__operatorStates());

    expect(result.fullBefore).toMatchObject({ active: 'cael-1', window: 'cael-1', windows: [{ id: 'house' }, { id: 'chat' }], language: 'ja' });
    // the full platform's keys are the keys it always had — no harness segment in them
    expect(result.fullKeys.filter((k) => k.includes('harness:'))).toEqual([]);

    expect(result.harnessFresh.active).toBeNull();
    expect(result.harnessFresh.window).toBeNull();
    expect(result.harnessFresh.windows).not.toEqual(result.fullBefore.windows);
    expect(result.harnessFresh.shelf).not.toEqual(result.fullBefore.shelf);
    expect(result.harnessFresh.language).toBe('ja'); // the operator's in either state
    // strictly a harness: no beings, no witnesses, on any surface that lists them
    expect(result.fullBefore.roster).toEqual(['cael-1', 'rugevil-1']);
    expect(result.fullBefore.witnesses).toEqual(['witness-basunor']);
    expect(result.harnessFresh.roster).toEqual([]);
    expect(result.harnessFresh.witnesses).toEqual([]);

    expect(result.harnessOwn).toMatchObject({ active: 'harness-0a1b2c3d', window: 'harness-0a1b2c3d', windows: [{ id: 'terminal' }] });
    expect(result.harnessRecovery).toEqual({ companion: 'harness-0a1b2c3d', requested: [], after: result.harnessOwn });
    expect(result.fullAfter).toEqual(result.fullBefore);
    expect(result.harnessAgain).toEqual(result.harnessOwn);
  } finally {
    await browser?.close();
    await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
    await vite?.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120_000);
