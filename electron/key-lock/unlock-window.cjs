// The unlock window — shown before the backend starts, only when this
// computer's keychain no longer opens Neuma's key (a reset or changed keyring,
// another desktop, a new computer). The Recovery Kit code opens it; nothing
// else does, and nothing is ever minted over the locked key.

const path = require('node:path');
const { BrowserWindow, ipcMain } = require('electron');

/**
 * impure (a window) — ask for the code until it opens the lock or the person quits.
 * @param {(code: string) => object} tryCode - unlocks or throws
 * @returns {Promise<object|null>} the unlocked result, or null on quit
 */
const askRecoveryCode = (tryCode) => new Promise((resolve) => {
  const win = new BrowserWindow({
    width: 560, height: 420, resizable: false, backgroundColor: '#000000',
    title: 'DEUS NEUMA — LOCKED', autoHideMenuBar: true, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'unlock-preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
    },
  });
  let done = false;
  const finish = (result) => {
    if (done) return;
    done = true;
    ipcMain.removeHandler('keyLock:unlock');
    ipcMain.removeAllListeners('keyLock:quit');
    if (!win.isDestroyed()) win.destroy();
    resolve(result);
  };
  ipcMain.handle('keyLock:unlock', async (event, code) => {
    if (event.sender !== win.webContents) return { ok: false, error: 'Not this window.' };
    try {
      const result = tryCode(String(code || ''));
      setImmediate(() => finish(result));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: /does not open/.test(err.message) ? 'That code does not open this key. Check it and try again.' : err.message };
    }
  });
  ipcMain.once('keyLock:quit', () => finish(null));
  win.on('closed', () => finish(null));
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'unlock.html'));
});

module.exports = { askRecoveryCode };
