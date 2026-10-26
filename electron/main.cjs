// NEUMA — Electron main process.
//
// The downloadable app is a thin native shell around the existing stack: it
// starts the Node backend (which already serves the built frontend + API + WS
// on one port in production) and points a window at it. The neuma's secrets and
// sovereign workspaces live under the OS app-data dir, so a fresh install is
// self-contained — no .env, no manual setup.
//
// This file owns ONLY the app lifecycle — single-instance, boot orchestration,
// quit — and wires the modules that hold the real surfaces (SIZE-020):
//   backend-spawn.cjs  — the backend child: port resolution, launch, health, kill
//   desk-windows.cjs   — desk slots, boot/handoff relay, the one window factory
//   ipc-handlers.cjs   — every renderer-facing IPC registration + the app menu
//   tray.cjs           — the corner tab + the once-per-install "still running" notice
//   update-bar.cjs     — the desk's update bar + WHAT'S NEW (what auto-update.cjs found)
//   connections-main.cjs — the CONNECTIONS switches main applies (spellcheck)
//
// Verify on a desktop: `npm install && npm run build && npm run electron:dev`.

const { app, BrowserWindow, Notification, dialog, ipcMain, safeStorage, shell, session } = require('electron');
const { getOrigin, killBackendTree, startBackend, waitForBackend, resolveStartupPort } = require('./backend-spawn.cjs');
const { createDeskWindows } = require('./desk-windows.cjs');
const { registerIpcHandlers } = require('./ipc-handlers.cjs');
const tray = require('./tray.cjs');
const autoUpdate = require('./auto-update.cjs');
const { registerUpdateBar } = require('./update-bar.cjs');
const { guardAppSessions } = require('./permission-guard.cjs');
const { registerConnections } = require('./connections-main.cjs');
const { openAtRestKeys, registerKeyLockIpc } = require('./key-lock/key-lock-main.cjs');

// Windows: the ID of the Start menu entry the installer makes (electron-builder.yml appId). Windows
// shows an app's notices (the update alert) only under its shortcut's ID, and "open at login" is the
// Run entry by this name, the same one the installer's […] writes.
if (process.platform === 'win32') app.setAppUserModelId('ai.neuma.app');

const deskWindows = createDeskWindows({
  getOrigin,
  announceStillRunning: () => tray.announceStillRunning(),
});
tray.initTray({ focusLiveDesk: deskWindows.focusLiveDesk, createWindow: deskWindows.createWindow });

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // A second launch means "another desk", not […] (VS Code
    // behavior) — carried on the focused desk's session when one is up. A
    // hidden desk, or a boot still under way, is raised instead (secondLaunch).
    deskWindows.secondLaunch().catch((err) => {
      dialog.showErrorBox('Deus Neuma', `Could not open a new desk.\n\n${err.message}`);
    });
  });

  app.whenReady().then(async () => {
    // Every renderer-facing registration lands BEFORE anything spawns — a desk
    // must never load ahead of its handlers, and the wallet store opens before
    // any window exists.
    registerIpcHandlers({ deskWindows });
    const updateBar = registerUpdateBar({ ipcMain, BrowserWindow, shell, app, autoUpdate });
    // Electron grants every camera/mic/screen/location ask by default; the
    // floor is deny, before any page exists (permission-guard.cjs).
    guardAppSessions(session, getOrigin);
    // Spellcheck's dictionary fetch is off until the person turns it on — set before any page exists.
    registerConnections({ app, ipcMain, session });
    registerKeyLockIpc({ ipcMain, safeStorage });

    // The port question is asked BEFORE spawning anything; a held or exhausted
    // lane shows its honest dialog and quits inside the resolver.
    if (!(await resolveStartupPort())) return;
    try {
      // The at-rest keys open BEFORE the backend exists; a person who quits the
      // unlock window gets no backend at all (key-lock-main.cjs).
      if ((await openAtRestKeys({ app, safeStorage })) === null) { app.quit(); return; }
      await startBackend({ onRestarted: deskWindows.reloadDesks });
      await waitForBackend();
      await deskWindows.bootFirstDesk();
      tray.ensureTray(); // the corner tab — present from the first desk onward
      // An offer that changes reaches the tray and every desk's bar together.
      const refreshTray = () => { tray.rebuildTrayMenu(); updateBar.publish(); };
      autoUpdate.init({ app, shell, Notification, refreshTray });
    } catch (err) {
      dialog.showErrorBox('Deus Neuma', `Could not start the local backend.\n\n${err.message}`);
      app.quit();
    }
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) deskWindows.createWindow();
    });
  });

  app.on('window-all-closed', () => {
    // ALWAYS-ON: the last window closing used to kill the app (and with it
    // the backend — and the queue's clock). Now the app lives in the tray
    // until QUIT is chosen deliberately. Nothing here — on purpose.
  });

  app.on('before-quit', () => {
    app.isQuitting = true;
    killBackendTree();
    tray.destroyTray();
  });

  // CTRL-C IN THE TERMINAL still has to take the backend down with us.
  //
  // Making the backend its own process-group leader (#211) means the terminal's
  // SIGINT reaches Electron and NOT the backend — and the default signal action
  // terminates us before `before-quit` can run. That left the backend holding
  // port 47317 after every Ctrl-C, so the next launch failed with EADDRINUSE
  // and read as a port conflict rather than […]
  // (#215, observed live 2026-07-31).
  //
  // Registering a handler replaces the default action, so the exit is ours to
  // perform. A crash or SIGKILL still runs none of this — that case belongs to
  // the backend's own parent-watch, which is why both exist.
  ['SIGINT', 'SIGTERM', 'SIGHUP'].forEach((signal) => {
    process.on(signal, () => {
      app.isQuitting = true;
      killBackendTree();
      app.quit();
    });
  });
}
