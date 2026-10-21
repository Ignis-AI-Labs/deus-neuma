/**
 * The app's permission floor in a REAL Electron (no mock): Electron grants
 * every camera, microphone and location ask by default, so the desk's session
 * denies everything but what the desk uses, from no origin but its own
 * (electron/permission-guard.cjs, security-seat audit 2026-10-19 G11).
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { _electron as electron } from '@playwright/test';
import electronPath from 'electron';
import { expect, test } from 'vitest';

const PROBE_PAGE = `<!doctype html><pre id="out"></pre><script>
const ask = async (constraints) => {
  try { (await navigator.mediaDevices.getUserMedia(constraints)).getTracks().forEach((t) => t.stop()); return 'granted'; }
  catch (e) { return e.name; }
};
const where = () => new Promise((resolve) => navigator.geolocation.getCurrentPosition(
  () => resolve('granted'), (e) => resolve(e.code === 1 ? 'denied' : 'error ' + e.code), { timeout: 4000 }));
(async () => {
  const out = { mic: await ask({ audio: true }), camera: await ask({ video: true }), location: await where() };
  document.getElementById('out').textContent = JSON.stringify(out);
})();
</script>`;

const listen = () => new Promise((resolve) => {
  const server = http.createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end(PROBE_PAGE); });
  server.listen(0, '127.0.0.1', () => resolve(server));
});

test('the desk gets its microphone and nothing else; a stranger origin gets nothing', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'permission-electron-'));
  const desk = await listen();
  const stranger = await listen();
  let app;
  try {
    const deskUrl = `http://127.0.0.1:${desk.address().port}/`;
    const strangerUrl = `http://127.0.0.1:${stranger.address().port}/`;
    app = await electron.launch({
      executablePath: electronPath,
      args: [fileURLToPath(new URL('../fixtures/permission-electron-main.cjs', import.meta.url))],
      env: { ...process.env, PERMISSION_TEST_PROFILE: path.join(root, 'profile'), PERMISSION_TEST_DESK: deskUrl, PERMISSION_TEST_STRANGER: strangerUrl },
    });
    const read = async (url) => {
      const page = app.windows().find((w) => w.url() === url) || await app.waitForEvent('window', { predicate: (w) => w.url() === url });
      await page.waitForFunction(() => document.getElementById('out')?.textContent, null, { timeout: 15000 });
      return JSON.parse(await page.locator('#out').textContent());
    };
    await app.firstWindow();
    await expect.poll(() => app.windows().length, { timeout: 15000 }).toBe(2);
    expect(await read(deskUrl)).toEqual({ mic: 'granted', camera: 'NotAllowedError', location: 'denied' });
    expect(await read(strangerUrl)).toEqual({ mic: 'NotAllowedError', camera: 'NotAllowedError', location: 'denied' });
  } finally {
    await app?.close();
    desk.close();
    stranger.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 60000);
