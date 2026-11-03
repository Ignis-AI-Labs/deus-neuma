/* global process, setTimeout */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, URL } from 'node:url';
import { _electron as electron } from '@playwright/test';
import electronPath from 'electron';
import { expect, test } from 'vitest';

test('the integrated terminal browser is a real sandboxed Electron guest on the requested URL', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-browser-'));
  const server = http.createServer((_req, res) => res.end('<title>Dev server</title>'));
  let desktop;
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const target = `http://127.0.0.1:${server.address().port}/run`;
    desktop = await electron.launch({
      executablePath: electronPath,
      args: [fileURLToPath(new URL('../fixtures/dev-browser-main.cjs', import.meta.url))],
      env: { ...process.env, DEV_BROWSER_TEST_PROFILE: root, DEV_BROWSER_TEST_URL: target },
    });
    let loaded;
    const deadline = Date.now() + 30_000;
    while (!loaded && Date.now() < deadline) {
      loaded = await desktop.evaluate(() => globalThis.loaded);
      if (!loaded) await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(loaded.url).toBe(target);
    expect(loaded.preferences).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    });
    expect(loaded.storagePath).toContain('neuma-dev-browser');
    expect(loaded.storagePath).not.toBe(root);
    expect(await desktop.evaluate(() => globalThis.opened)).toEqual({ opened: true });
    expect(await desktop.evaluate(() => globalThis.refused)).toEqual({ opened: false, reason: 'browser url must be http(s)' });
    expect(await desktop.evaluate(() => globalThis.loaded.url)).toBe(target);
  } finally {
    await desktop?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
}, 60_000);
