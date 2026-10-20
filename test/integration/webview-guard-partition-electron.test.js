/**
 * AN EMBEDDED GUEST NEVER JOINS THE DESK'S SESSION (security recheck
 * 2026-10-20, Electron READ). The renderer declares the <webview> tag, so it
 * declares the partition too: a guest with none, or with a partition of its
 * own choosing, attached into the desk's default session (its storage, and
 * Electron's grant-all fallback for any partition no guard covers). The clamp
 * now forces every guest onto the ComfyUI engine's partition.
 *
 * REAL Electron (offscreen, no GPU), the REAL clamp at will-attach-webview, a
 * REAL loopback guest server on :0. No mock (AGENTS.md RULE 0).
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, URL } from 'node:url';
import { _electron as electron } from '@playwright/test';
import electronPath from 'electron';
import { expect, test } from 'vitest';

test('every guest the renderer declares attaches on the ComfyUI partition, never the desk session', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webview-partition-'));
  const server = http.createServer((req, res) => res.end(`<p>guest ${req.url}</p>`));
  let desktop;
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    desktop = await electron.launch({ executablePath: electronPath,
      args: [fileURLToPath(new URL('../fixtures/webview-partition-main.cjs', import.meta.url))],
      env: { ...process.env, WEBVIEW_TEST_PROFILE: root,
        WEBVIEW_TEST_GUEST_URL: `http://127.0.0.1:${server.address().port}/` } });
    const deadline = Date.now() + 30_000;
    let attached = [];
    while (attached.length < 2 && Date.now() < deadline) {
      attached = await desktop.evaluate(() => globalThis.attached);
      if (attached.length < 2) await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const sessions = await desktop.evaluate(() => globalThis.sessions);
    expect(attached.map((guest) => new URL(guest.url).pathname).sort()).toEqual(['/bare', '/desk']);
    for (const guest of attached) {
      expect(guest.isDefault, guest.url).toBe(false);
      expect(guest.isComfy, guest.url).toBe(true);
      expect(guest.storagePath, guest.url).toBe(sessions.comfy);
      expect(guest.storagePath, guest.url).not.toBe(sessions.desk);
    }
  } finally {
    await desktop?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
}, 60_000);
