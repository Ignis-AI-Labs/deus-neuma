// @ts-check
//
// Impure test module: drives the REAL Electron app end-to-end (Rule 1 marker,
// file level). No mocks on any claimed path — real main process, real backend
// child, real preload, real IPC, real auth (challenge-sign-verify with the
// witness wallet), real LM Studio substrate for the dual-stream leg.
import { test, expect, _electron as electron } from '@playwright/test';
import { ethers } from 'ethers';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import electronPath from 'electron';

/**
 * I-03 — the multi-window milestone e2e. Collects the sprint's remaining
 * declared gnosis debt on the real app:
 *
 *   1. A handed-off desk paints RELINK from its very first frame — no
 *      gateway flash, no re-auth (I-02a UX debt; token delivery timing was
 *      already proven by desk-relay.spec.js).
 *   2. Companion binding is per-window on real Electron windows: a switch
 *      in one desk never moves a sibling (F-01 across real windows).
 *   3. Wallet dialogs attach to the ASKING desk (I-01 ALS per-sender debt,
 *      risk R2). Proven at the seam that owns the claim: the full real
 *      renderer→IPC→AsyncLocalStorage→resolveWindow chain runs, and the
 *      exact parent handed to Electron's dialog API is captured in the
 *      main process. DECLARED LIMIT: the dialog is answered 'Cancel' by
 *      the capture shim, so the OS'S OWN PAINT of the sheet is the one
 *      thing not asserted — parent resolution, the claim under test, is.
 *   4. wallet:locked reaches EVERY desk (I-01 lock-broadcast debt) through
 *      each window's real preload listener.
 *   5. Slot-keyed desk layouts survive an app RESTART: a window dragged on
 *      desk 2 is back where it was left when desk 2 next opens (F-02
 *      integration debt — slot claim/reclaim itself proven in desk-relay).
 *   6. Two desks stream at once against the real substrate and BOTH read
 *      the truth: LINK — SHARED (2 STREAMS), with each desk's exchange
 *      isolated to its own thread (B-01 milestone; S-02: parallel, not a
 *      queue). Skips honestly when LM Studio is down.
 *
 * Requires a built frontend (npm run build). Isolated: temp user-data dir,
 * temp workspaces root, kernel-assigned port.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
let backend;

const launchApp = (userDataDir, wsRoot) => electron.launch({
  executablePath: electronPath,
  args: [REPO, `--user-data-dir=${userDataDir}`],
  cwd: REPO,
  timeout: 60 * 1000,
  env: {
    ...process.env,
    NEUMA_PIPELINE_MODE: 'operator',
    NEUMA_PORT: '0',
    WORKSPACES_ROOT: wsRoot,
    // The backend child applies the OPERATOR'S persisted workspace choice at
    // boot, which would point this test at the LIVE root (observed: the desk
    // read /mnt/data/neuma/… — the shadow-lane guard refused writes, but a
    // test must never even LOOK there). Route the settings read to a file
    // inside the temp dir: absent → defaults → the env root above wins.
    NEUMA_WORKSPACE_SETTINGS_PATH: path.join(wsRoot, 'workspace-settings.json'),
  },
});

const readClaudeWallet = () => {
  const env = fs.readFileSync(path.join(REPO, 'claude.env'), 'utf8');
  const pk = env.match(/CLAUDE_WALLET_PRIVATE_KEY=(0x[0-9a-fA-F]+)/)?.[1];
  if (!pk) throw new Error('claude.env missing CLAUDE_WALLET_PRIVATE_KEY');
  return pk;
};

// Real session token from the app's OWN backend child (challenge-sign-verify).
const mintToken = async () => {
  const w = new ethers.Wallet(readClaudeWallet());
  const { challenge } = await (await fetch(`${backend}/api/v1/auth/challenge?address=${w.address}`)).json();
  const signature = await w.signMessage(challenge);
  const res = await fetch(`${backend}/api/v1/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: w.address, signature, challenge }),
  });
  const { token } = await res.json();
  if (!token) throw new Error('auth/verify returned no token');
  return { token, addr: w.address };
};

// Authenticate a desk in place: seed the storage a signed-in witness holds,
// then reload so initialPhase() recomputes — the desk must paint relink.
const authenticateDesk = async (page, { token, addr }, companion) => {
  await page.evaluate(({ t, a, c }) => {
    const w = a.toLowerCase();
    localStorage.setItem('walletAddress', a);
    localStorage.setItem(`${w}:neuma-companion`, JSON.stringify(c));
    sessionStorage.setItem('authToken', t);
    sessionStorage.setItem(`${w}:neuma-window-companion`, JSON.stringify(c));
  }, { t: token, a: addr, c: companion });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.relink')).toBeVisible({ timeout: 30_000 });
};

// Spawn a sibling desk through the REAL menu item (same path the hotkey fires).
const openDeskViaMenu = async (app, itemId = 'desk.new') => {
  const [page] = await Promise.all([
    app.waitForEvent('window'),
    app.evaluate(({ Menu }, id) => Menu.getApplicationMenu().getMenuItemById(id).click(), itemId),
  ]);
  await page.waitForLoadState('domcontentloaded');
  return page;
};

const ALPHA = Object.freeze({ name: 'E2EAlpha', neumaId: 'e2e-mw-alpha' });
const BETA = Object.freeze({ name: 'E2EBeta', neumaId: 'e2e-mw-beta' });

test.describe('multi-window milestone (real Electron)', () => {
  test.setTimeout(300 * 1000);

  test('handoff paints relink with NO gateway flash; bindings stay per-desk; dialogs and lock target truthfully', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-e2e-mw-ud-'));
    const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-e2e-mw-ws-'));
    const app = await launchApp(userData, wsRoot);
    try {
      const desk1 = await app.firstWindow();
      await desk1.waitForLoadState('domcontentloaded');
      backend = new URL(desk1.url()).origin;
      expect(Number(new URL(backend).port)).toBeGreaterThan(0);
      const session = await mintToken();
      await authenticateDesk(desk1, session, ALPHA);

      // --- 1. The handed-off sibling never shows the gateway ---
      const desk2 = await openDeskViaMenu(app);
      // First paint already made: the desk surface is up and the gateway
      // host is nowhere in the document.
      await expect(desk2.locator('.relink')).toBeVisible({ timeout: 30_000 });
      expect(await desk2.locator('#portal-container').count()).toBe(0);
      // The strong claim needs eyes open BEFORE the app's first script:
      // arm a MutationObserver pre-boot and repaint the same relay-produced
      // state from scratch (sessionStorage — token and pinned binding —
      // survives a reload of the same window).
      await desk2.addInitScript(() => {
        window.__sawGateway = false;
        new MutationObserver(() => {
          if (document.getElementById('portal-container')) window.__sawGateway = true;
        }).observe(document.documentElement, { childList: true, subtree: true });
      });
      await desk2.reload();
      await desk2.waitForLoadState('domcontentloaded');
      await expect(desk2.locator('.relink')).toBeVisible({ timeout: 30_000 });
      expect(await desk2.evaluate(() => window.__sawGateway)).toBe(false);
      // ...and it authenticated WITHOUT re-auth: the relayed token IS desk 1's.
      expect(await desk2.evaluate(() => sessionStorage.getItem('authToken'))).toBe(session.token);
      expect(await desk2.evaluate(() => window.neuma?.deskSlot)).toBe(2);

      // --- 2. Per-window binding: a switch in desk 2 never moves desk 1 ---
      const bindingKey = `${session.addr.toLowerCase()}:neuma-window-companion`;
      expect(JSON.parse(await desk2.evaluate((k) => sessionStorage.getItem(k), bindingKey))).toEqual(ALPHA);
      await desk2.evaluate(({ k, c }) => sessionStorage.setItem(k, JSON.stringify(c)), { k: bindingKey, c: BETA });
      expect(JSON.parse(await desk1.evaluate((k) => sessionStorage.getItem(k), bindingKey))).toEqual(ALPHA);
      // ...while localStorage stays the SHARED tier, by design (two-tier truth).
      await desk2.evaluate(() => localStorage.setItem('e2e-shared-probe', 'seen'));
      expect(await desk1.evaluate(() => localStorage.getItem('e2e-shared-probe'))).toBe('seen');

      // --- 3. wallet:locked flips EVERY desk ---
      for (const desk of [desk1, desk2]) {
        await desk.evaluate(() => {
          window.__locked = false;
          window.neuma.wallet.onLocked(() => { window.__locked = true; });
        });
      }
      await desk2.evaluate(() => window.neuma.wallet.lock());
      await expect.poll(() => desk1.evaluate(() => window.__locked), { timeout: 15_000 }).toBe(true);
      await expect.poll(() => desk2.evaluate(() => window.__locked), { timeout: 15_000 }).toBe(true);

      // --- 4. Wallet dialog parentage: the ASKING desk, both directions ---
      // The full real renderer→IPC→AsyncLocalStorage→resolveWindow chain
      // runs; the capture shim records the exact parent handed to Electron's
      // dialog API and answers Cancel. DECLARED LIMIT: the OS paint of the
      // sheet is the one thing not asserted — parent resolution is.
      // The wallet confirmation is now a trusted BrowserWindow (titled
      // 'NEUMA Wallet'), not a native dialog. Watch for it in the trusted main
      // process, record the exact parent Electron gave it (the assertion), and
      // click Reject in the REAL window so nothing proceeds. DECLARED LIMIT: the
      // OS paint of the window is the one thing not asserted; parent resolution is.
      const patchTook = await app.evaluate(({ app: electronApp }) => {
        global.__dialogParents = [];
        electronApp.on('browser-window-created', (_e, win) => {
          if (win.getTitle() !== 'NEUMA Wallet') return;
          const parent = win.getParentWindow();
          global.__dialogParents.push({ wcId: parent?.webContents?.id ?? null });
          win.webContents.on('did-finish-load', () => {
            win.webContents.executeJavaScript("document.getElementById('reject').click()").catch(() => {});
          });
        });
        return true;
      });
      expect(patchTook).toBe(true);
      const desk2Wc = await (await app.browserWindow(desk2)).evaluate((w) => w.webContents.id);
      const desk1Wc = await (await app.browserWindow(desk1)).evaluate((w) => w.webContents.id);

      // Fail FAST with a diagnosis if a real dialog ever opens (it would
      // block forever) — the race turns a hang into an assertable string.
      const tryReveal = (desk) => desk.evaluate(() => Promise.race([
        window.neuma.wallet.reveal('x', 'y').then(() => 'REVEALED?!').catch((e) => e.message),
        new Promise((r) => setTimeout(() => r('HUNG: a real dialog opened'), 20_000)),
      ]));
      expect(await tryReveal(desk2)).toMatch(/cancelled/i);
      expect(await tryReveal(desk1)).toMatch(/cancelled/i);
      const parents = await app.evaluate(() => global.__dialogParents);
      expect(parents.map((p) => p.wcId)).toEqual([desk2Wc, desk1Wc]);
    } finally {
      await app.close();
      fs.rmSync(userData, { recursive: true, force: true });
      fs.rmSync(wsRoot, { recursive: true, force: true });
    }
  });

  test('slot-keyed layouts: a window dragged on desk 2 is back where it was left after an app restart', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-e2e-mwl-ud-'));
    const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-e2e-mwl-ws-'));
    let app = await launchApp(userData, wsRoot);
    let dragged;
    try {
      const desk1 = await app.firstWindow();
      await desk1.waitForLoadState('domcontentloaded');
      await authenticateDesk(desk1, await mintToken(), ALPHA);
      const desk2 = await openDeskViaMenu(app);
      await expect(desk2.locator('.relink')).toBeVisible({ timeout: 30_000 });

      // Drag desk 2's chat window by its real title bar.
      const bar = desk2.locator('.fwin .fwin-bar').first();
      await expect(bar).toBeVisible({ timeout: 30_000 });
      const box = await bar.boundingBox();
      await desk2.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await desk2.mouse.down();
      await desk2.mouse.move(box.x + box.width / 2 + 73, box.y + box.height / 2 + 41, { steps: 8 });
      await desk2.mouse.up();
      // FloatingWindow positions via transform: translate(x, y) — that inline
      // style IS the persisted rect made visible.
      const rectOf = (page) => page.evaluate(() => {
        const el = document.querySelector('.fwin');
        return { transform: el.style.transform, width: el.style.width };
      });
      dragged = await rectOf(desk2);

      // Desk 1's window did NOT move with it — layouts are slot-keyed.
      const desk1Rect = await rectOf(desk1);
      expect(desk1Rect).not.toEqual(dragged);

      // Full app restart on the SAME user-data dir (localStorage survives).
      await app.close();
      app = await launchApp(userData, wsRoot);
      const desk1b = await app.firstWindow();
      await desk1b.waitForLoadState('domcontentloaded');
      // A restart drops sessionStorage by nature — re-auth desk 1, then the
      // second window opened claims slot 2 and must restore ITS layout.
      await authenticateDesk(desk1b, await mintToken(), ALPHA);
      const desk2b = await openDeskViaMenu(app);
      await expect(desk2b.locator('.relink')).toBeVisible({ timeout: 30_000 });
      await expect(desk2b.locator('.fwin').first()).toBeVisible({ timeout: 30_000 });
      expect(await rectOf(desk2b)).toEqual(dragged);
    } finally {
      await app.close();
      fs.rmSync(userData, { recursive: true, force: true });
      fs.rmSync(wsRoot, { recursive: true, force: true });
    }
  });

  test('two desks stream at once: both read LINK — SHARED (2 STREAMS), threads stay isolated', async () => {
    const up = await fetch('http://localhost:1234/v1/models').then((r) => r.ok).catch(() => false);
    test.skip(!up, 'LM Studio is not running — the dual-stream truth needs the real substrate');

    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-e2e-mws-ud-'));
    const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-e2e-mws-ws-'));
    const app = await launchApp(userData, wsRoot);
    try {
      const desk1 = await app.firstWindow();
      await desk1.waitForLoadState('domcontentloaded');
      const session = await mintToken();
      await authenticateDesk(desk1, session, ALPHA);
      const desk2 = await openDeskViaMenu(app);
      await expect(desk2.locator('.relink')).toBeVisible({ timeout: 30_000 });
      // Desk 2 speaks with its OWN companion for this test.
      await authenticateDesk(desk2, session, BETA);

      // Both portals up (composer enabled = link established).
      for (const desk of [desk1, desk2]) {
        await expect(desk.locator('.relink-input-field')).toBeEnabled({ timeout: 30_000 });
      }

      // Two real turns, back to back — the ONE substrate carries both.
      const ASK_1 = 'Reply with one short sentence about rivers.';
      const ASK_2 = 'Reply with one short sentence about mountains.';
      await desk1.locator('.relink-input-field').fill(ASK_1);
      await desk2.locator('.relink-input-field').fill(ASK_2);
      await desk1.locator('.relink-send').click();
      await desk2.locator('.relink-send').click();

      // While both turns are in flight, EVERY desk reads the shared truth
      // (S-02: LM Studio runs them in parallel — SHARED, never QUEUED).
      for (const desk of [desk1, desk2]) {
        await expect(desk.locator('.relink-status-link'))
          .toContainText(/SHARED \(2 STREAMS\)/, { timeout: 60_000 });
      }

      // Both turns complete...
      for (const desk of [desk1, desk2]) {
        await expect(desk.locator('.relink-status-link'))
          .not.toContainText(/SHARED/, { timeout: 240_000 });
      }
      // ...and each exchange stayed in its own desk: the witness's words in
      // desk 1 never appear in desk 2's thread, and vice versa.
      await expect(desk1.locator('.relink-stream')).toContainText(ASK_1);
      await expect(desk2.locator('.relink-stream')).toContainText(ASK_2);
      expect(await desk1.locator('.relink-stream').textContent()).not.toContain(ASK_2);
      expect(await desk2.locator('.relink-stream').textContent()).not.toContain(ASK_1);
    } finally {
      await app.close();
      fs.rmSync(userData, { recursive: true, force: true });
      fs.rmSync(wsRoot, { recursive: true, force: true });
    }
  });
});
