// impure — isolated Electron renderer for the real composer drop integration.
const { app, BrowserWindow } = require('electron');
app.disableHardwareAcceleration();
app.setPath('userData', process.env.PDF_TEST_PROFILE);
app.whenReady().then(() => {
  const window = new BrowserWindow({ show: false, width: 1100, height: 700,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.loadURL(process.env.PDF_TEST_URL);
});
