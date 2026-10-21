// @ts-check
//
// Impure test module: drives the REAL Electron app end-to-end (Rule 1 marker,
// file level). No mocks anywhere — real main process, real preload, real IPC.
import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import electronPath from 'electron';

/**
 * I-02a gnosis — the auth-token one-shot relay, proven on the real app:
 *
 *   desk 1 holds a session token → neuma.desk.open() → main parks the
 *   sanitized payload for the window it creates → the new desk's preload
 *   claims it synchronously and seeds sessionStorage → the token is present
 *   from the new desk's very first script. One-shot: nothing is delivered
 *   twice, and a boot never leaks to a window it wasn't minted for.
 *
 * Also collects I-01's declared debt on the real BrowserWindow lifecycle:
 * slots ride into renderers (desk 1 → 1, desk 2 → 2) and a closed desk's
 * slot is reclaimed by the next window.
 *
 * NOT proven here (needs a real authenticated witness + companion, I-03):
 * the no-gateway-flash UX — initialPhase() also requires an active
 * companion, so this spec proves token DELIVERY timing, not the full
 * relink-first-paint. Declared, per RULE 0.
 *
 * Requires a built frontend (npm run build). LM Studio is NOT needed — no
 * consciousness stream runs. Isolated: temp user-data dir, temp workspace
 * root, and a kernel-assigned port.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');

const launchApp = (userDataDir, wsRoot) => electron.launch({
  executablePath: electronPath,
  args: [REPO, `--user-data-dir=${userDataDir}`],
  cwd: REPO,
  timeout: 60 * 1000,
  env: { ...process.env, NEUMA_PIPELINE_MODE: 'operator', NEUMA_PORT: '0', WORKSPACES_ROOT: wsRoot },
});

test.describe('desk relay (real Electron)', () => {
  test.setTimeout(180 * 1000);

  test('token rides the one-shot relay; slots claim, ride, and reclaim', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-e2e-relay-ud-'));
    const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-e2e-relay-ws-'));
    const app = await launchApp(userData, wsRoot);
    try {
      const desk1 = await app.firstWindow();
      await desk1.waitForURL((url) => Number(url.port) > 0, { waitUntil: 'domcontentloaded', timeout: 30 * 1000 });

      // I-01 on the real lifecycle: the first desk knows it is desk 1.
      expect(await desk1.evaluate(() => window.neuma?.deskSlot)).toBe(1);

      // Desk 1 holds a session token (synthetic — the relay is opaque to
      // token content by design; the backend validates tokens, not the relay).
      const token = `e2e-relay-proof-${Date.now()}`;
      await desk1.evaluate((t) => sessionStorage.setItem('authToken', t), token);

      // Spawn a sibling desk through the real bridge.
      const [desk2] = await Promise.all([
        app.waitForEvent('window'),
        desk1.evaluate(() => window.neuma.desk.open()),
      ]);
      await desk2.waitForURL((url) => Number(url.port) > 0, { waitUntil: 'domcontentloaded', timeout: 30 * 1000 });

      // The relay delivered: the token was seeded by the preload, so it is
      // already in sessionStorage when the page's own scripts read it.
      expect(await desk2.evaluate(() => sessionStorage.getItem('authToken'))).toBe(token);
      expect(await desk2.evaluate(() => window.neuma?.deskSlot)).toBe(2);

      // No cross-window leakage: a desk spawned WITHOUT a token in its
      // opener gets nothing — no stale boot, no sibling's boot.
      await desk2.evaluate(() => sessionStorage.removeItem('authToken'));
      const [desk3] = await Promise.all([
        app.waitForEvent('window'),
        desk2.evaluate(() => window.neuma.desk.open()),
      ]);
      await desk3.waitForURL((url) => Number(url.port) > 0, { waitUntil: 'domcontentloaded', timeout: 30 * 1000 });
      expect(await desk3.evaluate(() => sessionStorage.getItem('authToken'))).toBeNull();
      expect(await desk3.evaluate(() => window.neuma?.deskSlot)).toBe(3);

      // I-01 restart semantics on real windows: close desk 2 → the next
      // desk opened claims the freed slot 2, not slot 4. Closed from main
      // via the page's own BrowserWindow handle (the page overwrites the
      // window title, and window.close() from a page script can be refused
      // for windows the script didn't open).
      const bw2 = await app.browserWindow(desk2);
      await bw2.evaluate((w) => w.close());
      await expect.poll(
        () => app.windows().length,
        { timeout: 10_000 },
      ).toBe(2);
      const [desk2again] = await Promise.all([
        app.waitForEvent('window'),
        desk1.evaluate(() => window.neuma.desk.open()),
      ]);
      await desk2again.waitForURL((url) => Number(url.port) > 0, { waitUntil: 'domcontentloaded', timeout: 30 * 1000 });
      expect(await desk2again.evaluate(() => window.neuma?.deskSlot)).toBe(2);
      // ...and it received desk 1's token again through its own fresh boot.
      expect(await desk2again.evaluate(() => sessionStorage.getItem('authToken'))).toBe(token);
    } finally {
      await app.close();
      fs.rmSync(userData, { recursive: true, force: true });
      fs.rmSync(wsRoot, { recursive: true, force: true });
    }
  });

  test('menu entry points: New Window carries the session, Separate Sign-In does not', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-e2e-menu-ud-'));
    const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-e2e-menu-ws-'));
    const app = await launchApp(userData, wsRoot);
    try {
      const desk1 = await app.firstWindow();
      await desk1.waitForURL((url) => Number(url.port) > 0, { waitUntil: 'domcontentloaded', timeout: 30 * 1000 });
      const token = `e2e-menu-proof-${Date.now()}`;
      // A bound window: wallet + token + this window's companion binding
      // (the wallet-scoped sessionStorage key companion-data writes).
      await desk1.evaluate((t) => {
        localStorage.setItem('walletAddress', '0xAbCd');
        sessionStorage.setItem('authToken', t);
        sessionStorage.setItem('0xabcd:neuma-window-companion', JSON.stringify({ name: 'Fenna', neumaId: 'FBF167B8F932' }));
      }, token);

      // The REAL menu item (id from the hotkey registry) — same code path
      // the accelerator fires. Main asks desk 1's preload for the handoff.
      const [desk2] = await Promise.all([
        app.waitForEvent('window'),
        app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('desk.new').click()),
      ]);
      await desk2.waitForURL((url) => Number(url.port) > 0, { waitUntil: 'domcontentloaded', timeout: 30 * 1000 });
      expect(await desk2.evaluate(() => sessionStorage.getItem('authToken'))).toBe(token);
      // The opener's companion arrived as this window's one-shot seed (F-01):
      // resolveBoundCompanion consumes it and fixes the window's own binding.
      expect(await desk2.evaluate(() => JSON.parse(sessionStorage.getItem('neuma-companion-seed'))))
        .toEqual({ name: 'Fenna', neumaId: 'FBF167B8F932' });

      // Separate Sign-In: no handoff — the new desk opens at the gateway.
      const [desk3] = await Promise.all([
        app.waitForEvent('window'),
        app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('desk.new-fresh').click()),
      ]);
      await desk3.waitForURL((url) => Number(url.port) > 0, { waitUntil: 'domcontentloaded', timeout: 30 * 1000 });
      expect(await desk3.evaluate(() => sessionStorage.getItem('authToken'))).toBeNull();
    } finally {
      await app.close();
      fs.rmSync(userData, { recursive: true, force: true });
      fs.rmSync(wsRoot, { recursive: true, force: true });
    }
  });

});
