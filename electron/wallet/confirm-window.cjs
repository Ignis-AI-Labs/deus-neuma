// The trusted confirmation WINDOW — the styled replacement for the native
// dialog that used to gate every signature and every destructive wallet action.
//
// Security model (unchanged from the native dialog it replaces):
//   • Rendered from a packaged-local file with a dedicated, capability-free
//     preload. The app renderer cannot reach this window's contents or script
//     its buttons.
//   • Resolves TRUE only when the human clicks inside THIS window — main checks
//     the resolve arrived from the window's own webContents (isTrustedResolve),
//     so a compromised renderer firing the IPC channel is ignored.
//   • Defaults to REJECT: any other outcome — close, ESC, parent gone, a bad
//     sender — settles false. Approval is never the fallback.
//   • One confirmation at a time, process-wide: a renderer cannot stack windows
//     to fish for a stray click.

const path = require('node:path');
const { BrowserWindow, ipcMain } = require('electron');
const { isTrustedResolve, isArmed } = require('./confirm-view.cjs');
const { readLookTheme } = require('./look-theme.cjs');
const { primaryBounds, parentBounds } = require('../primary-placement.cjs');

const VIEW = 'wallet-confirm:view';
const RESOLVE = 'wallet-confirm:resolve';
const CONFIRM_HTML = path.join(__dirname, 'confirm.html');
const CONFIRM_PRELOAD = path.join(__dirname, 'confirm-preload.cjs');

// Process-wide singleton: only one confirmation may be open, ever. Covers both
// signature confirms and destructive gates so neither can be stacked over the
// other. A concurrent request throws — the same guarantee the native dialog's
// modality gave for free.
let inFlight = false;

/**
 * Open the trusted confirmation and resolve to the human's choice.
 * @param {import('electron').BrowserWindow|null} parentWin — the desk that asked
 * @param {object} viewModel — display-only model from confirm-view builders
 * @returns {Promise<boolean>} true only on a real, trusted click of confirm
 */
const createConfirmWindow = (parentWin, viewModel) => {
  if (inFlight) return Promise.reject(new Error('Another wallet confirmation is already open.'));
  inFlight = true;
  let win = null;
  let onResolve = null;

  try {
    const hasParent = !!(parentWin && !parentWin.isDestroyed());
    // The operator's dress, read by MAIN from the look store — the requesting
    // renderer has no hand in how this window is painted (see look-theme.cjs).
    const theme = readLookTheme();
    const size = { width: 460, height: 560 };
    win = new BrowserWindow({
      ...(hasParent ? parentBounds(parentWin, size) : primaryBounds(size)),
      parent: hasParent ? parentWin : undefined,
      modal: hasParent, // modal needs a parent; without one, float on top instead
      alwaysOnTop: !hasParent,
      show: false,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      backgroundColor: theme?.ground || '#11161D', // the ground (CYBERDECK stock) — no flash before paint
      title: 'NEUMA Wallet',
      webPreferences: {
        preload: CONFIRM_PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // No node, no remote content, no spawning further windows.
        webviewTag: false,
        spellcheck: false,
      },
    });
    win.setMenu(null);
    // A secret on show is kept out of screen captures and recordings where the OS allows it.
    if (viewModel.kind === 'secret') win.setContentProtection(true);
    // Baseline hardening: the boolean this window returns is load-bearing, so it
    // must never leave its local file or spawn a child window — even though the
    // stated threat model (a compromised app renderer) cannot reach here to try.
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    return new Promise((resolve, reject) => {
      try {
        let settled = false;
        let shownAt = null;
        const wc = win.webContents;

        // Answer the page's pull for the display model — but only when the ask
        // truly came from this window's contents. The dress rides alongside as
        // display-only data (main's own read; the page re-validates the shape).
        const onView = (event) => (isTrustedResolve(event, wc) ? { ...viewModel, theme } : null);
        // Accept the human's choice — again, only from this window's own contents.
        onResolve = (event, approved) => {
          if (!isTrustedResolve(event, wc)) return; // forged from elsewhere → ignored
          // An approval that lands before the window has been showing for its arming delay is
          // a click that was already on its way: it approves nothing and the window stays.
          if (approved === true && !isArmed(shownAt, Date.now(), viewModel.armMs)) return;
          settle(approved === true);
        };
        ipcMain.handle(VIEW, onView);
        ipcMain.on(RESOLVE, onResolve);

        function settle(result) {
          if (settled) return;
          settled = true;
          inFlight = false;
          ipcMain.removeHandler(VIEW);
          ipcMain.removeListener(RESOLVE, onResolve);
          if (!win.isDestroyed()) win.destroy();
          resolve(result === true);
        }

        // Any way the window goes away without an explicit approve is a rejection.
        win.on('closed', () => settle(false));
        // A hard ESC even if focus is somewhere odd — belt to the page's own ESC.
        wc.on('before-input-event', (_e, input) => {
          if (input.type === 'keyDown' && input.key === 'Escape') settle(false);
        });
        // If the parent desk dies mid-confirmation, tear down (reject).
        if (hasParent) parentWin.once('closed', () => settle(false));

        win.once('ready-to-show', () => {
          if (win.isDestroyed()) return;
          win.show();
          shownAt = Date.now();
        });
        win.loadFile(CONFIRM_HTML).catch(() => settle(false));
      } catch (error) {
        inFlight = false;
        ipcMain.removeHandler(VIEW);
        if (onResolve) ipcMain.removeListener(RESOLVE, onResolve);
        if (!win.isDestroyed()) win.destroy();
        reject(error);
      }
    });
  } catch (error) {
    inFlight = false;
    ipcMain.removeHandler(VIEW);
    if (onResolve) ipcMain.removeListener(RESOLVE, onResolve);
    if (win && !win.isDestroyed()) win.destroy();
    return Promise.reject(error);
  }
};

module.exports = { createConfirmWindow, VIEW, RESOLVE };
