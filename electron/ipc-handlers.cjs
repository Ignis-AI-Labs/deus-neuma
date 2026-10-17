// IPC handlers — every renderer-facing registration the shell wires at boot.
//
// Split out of main.cjs (SIZE-020). Registered from main's whenReady BEFORE
// the backend spawn and the first desk, in exactly the order they always
// were. Window state is never owned here — it comes in through the
// desk-windows factory surface.

const { app, BrowserWindow, Menu, Notification, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const residency = require('./residency.cjs');
const { registerWalletIpc } = require('./wallet/wallet-ipc.cjs');
const { browserTargetFor } = require('./open-in-browser.cjs');
const { sanitizeBootPayload } = require('./desk-boot.cjs');
const { logPaths } = require('./backend-log.cjs');
const { APP_HOTKEYS, buildAppMenuTemplate } = require('./hotkeys.cjs');
const { cleanNotifyText, isSafeAppId } = require('./notify-text.cjs');
const { dragIcon } = require('./drag-icon.cjs');
const { primaryBounds } = require('./primary-placement.cjs');

// impure — register every handler on ipcMain. `deskWindows` is the
// createDeskWindows() surface (desk-windows.cjs).
const registerIpcHandlers = ({ deskWindows }) => {
  const {
    createWindow,
    openDeskFromFocused,
    fallbackWindow,
    raiseDesk,
    anyDeskOnScreen,
    claimBoot,
    settleHandoff,
    markMenuReady,
    applyMenuAction,
  } = deskWindows;

  // ── OS NOTIFICATIONS ──────────────────────────────────────────────────────
  //
  // A being finishes while the operator is in another application. The desk's own
  // tray cannot help there — nothing about it is on screen — so the event has to
  // leave the app.
  //
  // THREE THINGS THIS MUST GET RIGHT, each of which is a real bug if it does not:
  //
  // 1. FIRE ONCE, not once per desk. Every open desk renderer receives the same
  //    wallet-scoped frame, so N desks would ask N times for one event. Main is
  //    the only place that can see all of them, so the dedupe lives here.
  //
  // 2. HIDDEN COUNTS AS UNFOCUSED. `win.on('close')` HIDES the desk to the tray
  //    rather than destroying it (see desk-windows.cjs createWindow), so […] is the common state, not a rare one. A check that only asked
  //    `isFocused()` would be right by accident; one that forgot `isVisible()`
  //    would go silent exactly when the operator most needs telling.
  //
  // 3. NOTHING PRIVILEGED FROM THE RENDERER. Title and body are re-validated
  //    here, not trusted: capped, control characters stripped, and no icon or URL
  //    accepted from the caller at all. The renderer is the least trusted input
  //    on this boundary.
  //
  // The BODY is metadata only, by contract with the record shape upstream — never
  // a being's words. An OS notification centre persists and, on some systems,
  // syncs to another device; whatever is put here leaves NEUMA's reach for good.
  // The deciding logic lives in ./notify-text.cjs so it can be proven without an
  // Electron runtime; what stays here is the part that touches real windows.

  // Residency controls — the frontend reads/toggles whether the being wakes
  // with the computer (Constitution Art. IV.6).
  // THE OS NOTIFICATION LEG. One-way `on`, never `handle`: the renderer gets
  // no reply channel, because there is nothing it needs to learn back and a
  // reply is one more thing to get wrong on a privilege boundary.
  //
  // Switchable at boot, and deliberately from the ambient environment. The
  // license flag is pinned in backend-spawn.cjs precisely so a packaged app
  // cannot be talked out of a gate it must enforce; this is the opposite kind
  // of thing — a capability the operator must be able to turn OFF without a
  // rebuild, if they ever find being names in their system's notification log.
  const osNotifyEnabled = String(process.env.NEUMA_DESK_OS_NOTIFY ?? '1') !== '0';
  const notifiedIds = new Set();

  ipcMain.on('notifications:notify', (_event, payload) => {
    try {
      if (!osNotifyEnabled) return;
      // A capability probe, NOT a preference: it answers […],
      // never […]. Both gates are needed.
      if (!Notification.isSupported()) return;

      const id = typeof payload?.id === 'string' ? payload.id : null;
      // Fire once per event across every desk. Without this an operator with
      // three desks open gets three popups for one turn finishing.
      if (id) {
        if (notifiedIds.has(id)) return;
        notifiedIds.add(id);
        // The set is a dedupe window, not a log — bound it so a long-lived
        // app does not grow one entry per notification forever.
        if (notifiedIds.size > 500) {
          for (const old of [...notifiedIds].slice(0, 250)) notifiedIds.delete(old);
        }
      }

      // Belt and braces: the renderer already suppresses while the desk is on
      // screen, but main can see every window and the renderer can only see
      // itself. A popup over a desk the operator is looking at is noise.
      if (anyDeskOnScreen()) return;

      const notification = new Notification({
        title: cleanNotifyText(payload?.title, 'Deus Neuma'),
        body: cleanNotifyText(payload?.body, 'Something finished.'),
        silent: false,
        // No icon from the caller, ever — that would be a renderer-controlled
        // file read on the privileged side.
      });
      notification.on('click', () => {
        const win = raiseDesk();
        // Ask the desk to open the app the card pointed at. A small enum of
        // app ids, never a URL or a path.
        const appId = isSafeAppId(payload?.appId) ? payload.appId : null;
        if (win && appId) win.webContents.send('notifications:activate', { appId });
      });
      notification.show();
    } catch (error) {
      // A notification is the least important thing happening. It must never
      // be the reason the main process falls over.
      console.warn('[neuma] OS notification failed:', error.message);
    }
  });

  ipcMain.handle('residency:get', () => residency.isResident());
  ipcMain.handle('residency:set', (_event, enabled) => residency.setResident(enabled));

  // The hotkey registry, read-only, for the Settings legend — the same
  // table the application menu is built from, so the legend can never
  // claim a binding the menu doesn't hold. (The sandboxed preload may only
  // require 'electron', hence IPC rather than a require of hotkeys.cjs.)
  ipcMain.handle('hotkeys:list', () => APP_HOTKEYS);

  // Open a URL in the user's real browser (used by the wallet bridge to reach
  // their Rabby/MetaMask). http(s) only — never file:// or custom schemes,
  // even though the renderer is our own app.
  ipcMain.handle('app:openExternal', (_event, url) => {
    try {
      const u = new URL(String(url));
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        shell.openExternal(u.toString());
        return { ok: true };
      }
    } catch { /* invalid url — fall through */ }
    return { ok: false };
  });

  // Open a LOCAL HTML file in the user's default browser (the FILES tree's
  // OPEN IN BROWSER). The pure gate (absolute, .html/.htm only) runs first,
  // then the one IO check — the file must actually exist as a file — and
  // only then does the file:// URL leave the shell. Nothing else schemes
  // its way out of the app.
  ipcMain.handle('app:openInBrowser', (_event, rawPath) => {
    const target = browserTargetFor(rawPath);
    if (!target) return { ok: false };
    try {
      if (!fs.statSync(rawPath).isFile()) return { ok: false };
    } catch { return { ok: false }; }
    shell.openExternal(target);
    return { ok: true };
  });

  // Reveal a path in the OS file manager. String + existence checked; the
  // path itself never leaves the shell as a URL, so no scheme can ride it.
  ipcMain.handle('app:showInFolder', (_event, rawPath) => {
    if (typeof rawPath !== 'string' || rawPath.length === 0) return { ok: false };
    try { fs.statSync(rawPath); } catch { return { ok: false }; }
    shell.showItemInFolder(rawPath);
    return { ok: true };
  });

  // THE IMAGE FORGE workbench (FR-37) — ComfyUI's own UI in a dedicated,
  // UNPRIVILEGED child window. ComfyUI is a high-privilege tool; this
  // window's privileges are the blast radius if its UI is ever compromised,
  // so it gets none (RULE 8): sandboxed, isolated, no node, no preload, and
  // its OWN session partition — the desk's session (auth token included)
  // never crosses. Loopback http only; navigation locked to that origin;
  // never an iframe from the desk (ComfyUI's Host/Origin middleware fights
  // embedding, and the desk origin never touches the engine API).
  let workbenchWin = null;
  ipcMain.handle('workbench:open', (_event, rawUrl) => {
    let u;
    try { u = new URL(String(rawUrl)); } catch { return { opened: false, reason: 'malformed workbench url' }; }
    const loopback = u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '::1';
    if (u.protocol !== 'http:' || !loopback) {
      return { opened: false, reason: 'workbench url must be loopback http' };
    }
    if (workbenchWin && !workbenchWin.isDestroyed()) {
      // Focus only — never reload: a mid-composition workbench must not
      // lose the operator's graph to a second click.
      workbenchWin.focus();
      return { opened: true };
    }
    workbenchWin = new BrowserWindow({
      ...primaryBounds({ width: 1440, height: 900 }),
      backgroundColor: '#000000',
      title: 'COMFYUI — WORKBENCH',
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        partition: 'persist:comfyui-workbench',
      },
    });
    workbenchWin.on('closed', () => { workbenchWin = null; });
    workbenchWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    workbenchWin.webContents.on('will-navigate', (event, target) => {
      try {
        if (new URL(target).origin !== u.origin) event.preventDefault();
      } catch { event.preventDefault(); }
    });
    workbenchWin.loadURL(u.toString());
    return { opened: true };
  });

  // In-page context menu — the renderer announces it can draw the styled
  // menu, and answers a shown menu with the chosen action.
  ipcMain.on('contextmenu:ready', (event) => markMenuReady(event.sender));
  ipcMain.on('contextmenu:action', (event, action) => applyMenuAction(event.sender, action));

  // A desk spawns a sibling desk. The opener hands over its auth token so
  // the new desk wakes authenticated (one-shot relay — see desk-boot.cjs);
  // a missing or malformed payload still opens the desk, at the gateway.
  // Fire-and-forget BY CONTRACT: the reply says the spawn was scheduled,
  // not that the window loaded — a later load failure surfaces in the
  // native error dialog, the only honest place main can report it.
  ipcMain.handle('desk:open', (_event, rawBoot) => {
    createWindow(sanitizeBootPayload(rawBoot)).catch((err) => {
      dialog.showErrorBox('Deus Neuma', `Could not open a new desk.\n\n${err.message}`);
    });
    return { scheduled: true };
  });

  // The new desk's preload claims its boot SYNCHRONOUSLY, before the page's
  // first script runs — the token is in sessionStorage by first paint, so
  // the gateway never flashes. Delivery is one-shot: the entry dies here.
  // Any window without a parked boot (slot 1, reloads, strangers) gets null.
  ipcMain.on('desk:claim-boot', (event) => {
    event.returnValue = claimBoot(event.sender.id);
  });

  // The focused desk's preload answers a handoff request (main-initiated
  // New Window). Untrusted input: the id must match a pending request —
  // unknown or late replies are dropped; the payload is sanitized at use.
  ipcMain.on('desk:handoff-reply', (_event, requestId, payload) => {
    settleHandoff(requestId, payload);
  });

  // The application menu IS the hotkey registry made visible — every
  // binding in hotkeys.cjs renders as a menu item with its accelerator.
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildAppMenuTemplate({
    isMac: process.platform === 'darwin',
    actions: {
      'desk.new': () => openDeskFromFocused().catch((err) => {
        dialog.showErrorBox('Deus Neuma', `Could not open a new desk.\n\n${err.message}`);
      }),
      'desk.new-fresh': () => createWindow(null).catch((err) => {
        dialog.showErrorBox('Deus Neuma', `Could not open a new desk.\n\n${err.message}`);
      }),
    },
    // Packaged only — that is where the log lane exists, and where the
    // operator has no terminal to read instead.
    onShowLogs: app.isPackaged ? () => {
      const { current } = logPaths(app.getPath('home'));
      // Reveal rather than open: the folder holds this run AND the previous
      // one, and the previous run is usually the one that failed.
      shell.showItemInFolder(current);
    } : null,
  })));

  // Native folder picker — lets the witness browse to a workspace home in the
  // pre-flight HOME & ALLOCATION step instead of typing the absolute path.
  // Returns the chosen path, or null if cancelled. The renderer can only
  // request the dialog; it gains no other filesystem access. The sheet
  // attaches to the desk that ASKED, never a sibling window.
  ipcMain.handle('dialog:openDirectory', async (event) => {
    const asking = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(asking || undefined, {
      title: 'Choose the workspace home for your neuma',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled || !result.filePaths.length ? null : result.filePaths[0];
  });

  // THE DRAG-OUT (Design note, 2026-07-28: […]): an Explorer row dragged toward the OS becomes a REAL
  // OS-level drag of the actual file — dropping it in Dolphin, on the
  // desktop, or into another app copies it there. The renderer names the
  // path; main only checks it is an absolute existing FILE (never a
  // directory — a whole folder tree is not a drag-out) before starting it.
  // Containment against the Explorer's open roots lives where every other
  // file act lives: the backend routes that built the tree the row came
  // from. The icon is generated in-process (drag-icon.cjs) — the repo
  // carries no PNG.
  ipcMain.on('files:start-drag', (event, rawPath) => {
    const filePath = String(rawPath || '');
    if (!path.isAbsolute(filePath)) return;
    let st;
    try { st = fs.statSync(filePath); } catch { return; }
    if (!st.isFile()) return;
    event.sender.startDrag({ file: filePath, icon: dragIcon() });
  });

  // impure — one-time adoption: the 2026-07 package rename (kenorie → neuma)
  // moved Electron's default userData dir in dev builds, stranding the sealed
  // wallet under the legacy path. Adopt it before the wallet IPC opens the
  // store; never overwrite a wallet that already lives at the new path.
  //
  // ONLY when userData sits at its DEFAULT location. `appData` is NOT moved by
  // `--user-data-dir`, so a deliberately isolated instance would otherwise copy
  // the operator's real sealed vault into its private profile — every test rig
  // and every second profile silently inheriting the operator's wallet, then
  // failing to unlock it with its own password. Isolation the wallet layer
  // ignores is not isolation.
  const defaultUserData = path.join(app.getPath('appData'), app.getName());
  const isolatedProfile = path.resolve(app.getPath('userData')) !== path.resolve(defaultUserData);
  const legacyWallet = path.join(app.getPath('appData'), 'kenorie', 'wallet');
  const walletHome = path.join(app.getPath('userData'), 'wallet');
  if (!isolatedProfile
    && legacyWallet !== walletHome && fs.existsSync(legacyWallet) && !fs.existsSync(walletHome)) {
    fs.cpSync(legacyWallet, walletHome, { recursive: true });
  }

  // Witness wallet — main-process key custody. Registered before any window
  // exists. Confirm dialogs attach to the desk whose renderer asked (the
  // sender rides call context inside wallet-ipc); this only supplies the
  // fallback when no asking sender is resolvable.
  registerWalletIpc({
    getWindow: fallbackWindow,
    userDataPath: app.getPath('userData'),
  });

  // Test seam (strictly env-gated, main-process only, never renderer-reachable):
  // the wallet-confirm security e2e drives createConfirmWindow directly to prove
  // its boundary (forged-sender rejection, no injected-markup approval, etc.).
  // Off in every real run — no preload or IPC exposes this.
  if (process.env.NEUMA_CONFIRM_E2E === '1') {
    global.__neumaConfirmE2E = {
      createConfirmWindow: require('./wallet/confirm-window.cjs').createConfirmWindow,
      buildSignConfirmView: require('./wallet/confirm-view.cjs').buildSignConfirmView,
    };
  }
};

module.exports = { registerIpcHandlers };
