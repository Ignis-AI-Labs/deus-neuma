// Integrated browser — a real top-level guest for terminal/dev-server links.
// No desk preload, no Node, no shared desk session. HTTP(S) only; attempts to
// leave that scheme or spawn another window go to the guarded external door.
const { BrowserWindow, shell } = require('electron');
const { externalUrlFor } = require('./desk-links.cjs');

let browserWindow = null;

const openDevBrowser = (rawUrl) => {
  const target = externalUrlFor(rawUrl);
  if (!target) return { opened: false, reason: 'browser url must be http(s)' };
  if (!browserWindow || browserWindow.isDestroyed()) {
    browserWindow = new BrowserWindow({
      width: 1440,
      height: 900,
      backgroundColor: '#000000',
      title: 'NEUMA — BROWSER',
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        partition: 'persist:neuma-dev-browser',
      },
    });
    browserWindow.on('closed', () => { browserWindow = null; });
    browserWindow.webContents.setWindowOpenHandler(({ url }) => {
      const external = externalUrlFor(url);
      if (external) shell.openExternal(external);
      return { action: 'deny' };
    });
    browserWindow.webContents.on('will-navigate', (event, url) => {
      if (!externalUrlFor(url)) event.preventDefault();
    });
  }
  browserWindow.loadURL(target);
  browserWindow.focus();
  return { opened: true };
};

module.exports = { openDevBrowser };
