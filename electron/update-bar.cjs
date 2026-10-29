// update-bar.cjs — the desk's update bar and WHAT'S NEW panel, main side.
//
// GNOME often shows no tray, so the tray entry and an OS notice alone left most Linux installs
// never seeing a ready update. Every desk now asks main what to show (update:state), is told when
// it changes (update:changed), and sends back the one act the person chose (update:act):
//   restart   install the downloaded update — the same quitAndInstall the tray's entry runs
//   download  a system-package install opens the downloads page (it cannot install itself)
//   later     set this version aside until the next launch or a newer version (memory only)
//   seen      WHAT'S NEW was read: record this version as seen (<userData>/whats-new.json)
// Main is the one owner of what is shown, so every desk agrees and "later" in one is later in all.
// What is shown is computed in update-notes.cjs (pure); nothing here decides wording.

const fs = require('node:fs');
const path = require('node:path');
const { barFor, plainVersion, selectNotes, whatsNewDue } = require('./update-notes.cjs');

const SEEN_FILE = 'whats-new.json';
// The app's own copy of its release notes (electron-builder.yml files: build/release-notes.md).
const BUNDLED_NOTES = path.join('build', 'release-notes.md');
// electron-updater writes this the first time an install asks the feed (AppUpdater
// getOrCreateStagingUserId): its presence means the install ran before the seen record existed.
const ASKED_FEED_MARK = '.updaterId';
const ACTIONS = Object.freeze(['restart', 'download', 'later', 'seen', 'check']);

// impure — a missing or unreadable file reads as null; nothing here may cost a boot
const readText = (file) => {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
};

// impure — the last version whose WHAT'S NEW this install has seen
const readLastSeen = (userData) => {
  try {
    return plainVersion(JSON.parse(readText(path.join(userData, SEEN_FILE)) ?? 'null')?.lastSeenVersion);
  } catch {
    return null;
  }
};

// impure — whole-file write, tmp then rename, so a crash never leaves half a record
const writeLastSeen = (userData, version) => {
  const file = path.join(userData, SEEN_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(tmp, `${JSON.stringify({ lastSeenVersion: version })}\n`);
  fs.renameSync(tmp, file);
};

/**
 * The WHAT'S NEW this launch opens on its own, or null; records the version as seen when there
 * is nothing to open, so a fresh install or a version with no notes never asks again. impure (fs)
 */
const launchWhatsNew = ({ userData, appPath, current, log }) => {
  const lastSeen = readLastSeen(userData);
  const due = whatsNewDue({ current, lastSeen, installedBefore: fs.existsSync(path.join(userData, ASKED_FEED_MARK)) });
  const notes = due ? selectNotes(readText(path.join(appPath, BUNDLED_NOTES)), { after: lastSeen, upTo: current }) : [];
  if (notes.length) return Object.freeze({ version: current, notes });
  if (lastSeen !== current) {
    try { writeLastSeen(userData, current); } catch (error) { log.warn(`[neuma] could not record the seen version: ${error.message}`); }
  }
  return null;
};

/**
 * Register the update bar's IPC and return its publish(), which main calls whenever the offer
 * changes (beside the tray rebuild). impure (ipcMain, windows, fs, shell)
 *
 * @param {{ ipcMain: object, BrowserWindow: object, shell: object, app: object,
 *   autoUpdate: { updateOffer: () => object, restartToUpdate: () => boolean, DOWNLOADS_PAGE: string },
 *   launch?: boolean, log?: object }} deps — launch: open WHAT'S NEW at this launch when due
 * @returns {{ publish: () => void, snapshot: () => object }}
 */
const registerUpdateBar = ({ ipcMain, BrowserWindow, shell, app, autoUpdate, isDesk, launch = app.isPackaged, log = console }) => {
  const current = app.getVersion();
  const userData = app.getPath('userData');
  let dismissed = null;
  // A dev desk never checks the feed and carries no notes of its own: nothing opens there.
  // (`launch` is true for a packaged app; the proof rig runs the same path unpacked.)
  let whatsNew = launch ? launchWhatsNew({ userData, appPath: app.getAppPath(), current, log }) : null;

  const snapshot = () => ({
    current,
    bar: barFor(autoUpdate.updateOffer(), { current, dismissed }),
    whatsNew,
  });

  // impure — every window hears it; a window with no preload ignores the channel
  const publish = () => {
    const view = snapshot();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('update:changed', view);
    }
  };

  // a desk's own top frame only (desk-links.cjs fromDesk; re-audit 2026-10-29, M-07 residual)
  const handle = (channel, fn) => ipcMain.handle(channel, (event, ...args) => {
    if (!isDesk(event)) throw new Error(`${channel} refused: not the desk`);
    return fn(event, ...args);
  });
  handle('update:state', () => snapshot());
  handle('update:act', (_event, action) => {
    if (!ACTIONS.includes(action)) return { ok: false, reason: 'unknown act' };
    // The person's Check now (Settings → Security → Connections): asked even while the update check is off
    if (action === 'check') return autoUpdate.checkNow().then((result) => { publish(); return result; });
    const { bar } = snapshot();
    if (action === 'seen') {
      if (!whatsNew) return { ok: true };
      try { writeLastSeen(userData, current); } catch (error) { log.warn(`[neuma] could not record the seen version: ${error.message}`); }
      whatsNew = null;
    } else if (!bar) {
      return { ok: false, reason: 'no update is on offer' };
    } else if (action === 'later') {
      dismissed = bar.version;
    } else if (action === 'download') {
      if (bar.action !== 'download') return { ok: false, reason: 'this install updates itself' };
      shell.openExternal(autoUpdate.DOWNLOADS_PAGE);
      return { ok: true };
    } else {
      if (bar.action !== 'restart') return { ok: false, reason: 'no downloaded update to install' };
      return { ok: autoUpdate.restartToUpdate() };
    }
    publish();
    return { ok: true };
  });

  return { publish, snapshot };
};

module.exports = { SEEN_FILE, BUNDLED_NOTES, registerUpdateBar, launchWhatsNew };
