// THE TRAY — the corner tab that says NEUMA is running (Design note, 2026-07-28,
// […]), and the once-per-install […]
// notice. OPEN raises a desk; QUIT is the only exit — it is deliberately the
// only way out, because an approved post fires only while this process lives.
//
// Split out of main.cjs (SIZE-020). Module-level live state, same doctrine as
// auto-update.cjs: the main process is a singleton, and the window state the
// tray needs arrives through initTray from the desk-windows factory surface.

const { app, Menu, Tray, dialog, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const autoUpdate = require('./auto-update.cjs');

const ROOT = path.join(__dirname, '..');

// THE TRAY, at module scope so the close handler can reach it (UX-002 #215).
// It is created in whenReady; the window's close handler needs it to say, once,
// where the app went.
let tray = null;

// Injected by main at wiring time — desk-windows.cjs owns the window registry.
let focusLiveDesk = null;
let createWindow = null;

// impure — bind the tray to the window surface. Called once from main.cjs
// before any desk exists.
const initTray = (deps) => {
  focusLiveDesk = deps.focusLiveDesk;
  createWindow = deps.createWindow;
};

// […] — shown ONCE per install, the first time the X hides
// the desk (UX-002 #215).
//
// The always-on design is correct: an approved post scheduled for 03:00 cannot
// fire if closing a window kills the scheduler. What was missing is that
// nothing said so. On Windows a new tray icon defaults into the overflow
// flyout behind the `^` chevron, so the single exit affordance sat where a
// first-run user has no reason to look — and on 2026-07-30 an operator
// reported NEUMA closed, twice, in good faith, while it was serving HTTP and
// holding a live filesystem tool surface. Every app using this pattern
// (Discord, Steam, Slack) shows this notice, precisely because hiding is
// otherwise indistinguishable from quitting.
//
// A marker FILE, not a preference: it must survive restarts, and it must never
// be able to fail the close. Any error here means the notice shows again —
// annoying at worst, and the safe direction to be wrong in.
const trayNoticePath = () => path.join(app.getPath('userData'), 'tray-notice-shown');
const trayNoticeShown = () => { try { return fs.existsSync(trayNoticePath()); } catch { return false; } };
const markTrayNoticeShown = () => {
  try {
    fs.mkdirSync(path.dirname(trayNoticePath()), { recursive: true });
    fs.writeFileSync(trayNoticePath(), new Date().toISOString());
  } catch { /* the notice simply shows again next time */ }
};

// impure — tell the operator where the app went, once. Balloons are Windows
// (and some Linux) only; on macOS the tray icon sits in the always-visible
// menu bar, which is exactly the assumption that failed on Windows.
const announceStillRunning = () => {
  if (trayNoticeShown() || !tray) return;
  markTrayNoticeShown(); // mark FIRST — a failed balloon must not re-arm the notice
  try {
    if (typeof tray.displayBalloon === 'function') {
      tray.displayBalloon({
        title: 'Deus Neuma is still running',
        content: 'Your beings stay awake in the tray so scheduled work still fires. '
          + 'Click the ^ arrow by the clock to find Deus Neuma — right-click it to QUIT.',
      });
    }
  } catch { /* a notice that cannot be shown must never cost the close */ }
};

// The menu is REBUILT to change (Electron menus are immutable); trayItems() is [] until an update waits.
const buildTrayMenu = () => Menu.buildFromTemplate([
  {
    label: 'OPEN DEUS NEUMA',
    click: () => { if (!focusLiveDesk()) createWindow().catch((err) => dialog.showErrorBox('Deus Neuma', `Could not open a desk.\n\n${err.message}`)); },
  },
  { type: 'separator' },
  ...autoUpdate.trayItems(),
  { label: 'QUIT DEUS NEUMA', click: () => { app.isQuitting = true; app.quit(); } },
]);

const rebuildTrayMenu = () => { if (tray) tray.setContextMenu(buildTrayMenu()); };

// impure — create the tray once; the corner tab is present from the first desk onward.
const ensureTray = () => {
  if (tray) return;
  const icon = nativeImage.createFromPath(path.join(ROOT, 'build', 'icon.png')).resize({ width: 22, height: 22 });
  tray = new Tray(icon);
  tray.setToolTip('Deus Neuma — running');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => focusLiveDesk());
};

// impure — the quit path takes the tab down with the app.
const destroyTray = () => {
  if (tray) { tray.destroy(); tray = null; }
};

module.exports = { initTray, announceStillRunning, rebuildTrayMenu, ensureTray, destroyTray };
