const { app, BrowserWindow } = require('electron');
const { openDevBrowser } = require('../../electron/dev-browser.cjs');

app.disableHardwareAcceleration();
app.setPath('userData', process.env.DEV_BROWSER_TEST_PROFILE);

app.whenReady().then(async () => {
  globalThis.opened = openDevBrowser(process.env.DEV_BROWSER_TEST_URL);
  const win = BrowserWindow.getAllWindows()[0];
  win.webContents.once('did-finish-load', () => {
    globalThis.loaded = {
      url: win.getURL(),
      preferences: win.webContents.getLastWebPreferences(),
      storagePath: win.webContents.session.storagePath,
    };
    globalThis.refused = openDevBrowser('file:///etc/passwd');
  });
});
