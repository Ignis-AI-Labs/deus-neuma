// impure — isolated Electron renderer for the real composer drop integration.
const { app, BrowserWindow } = require('electron');
app.disableHardwareAcceleration();
app.setPath('userData', process.env.PDF_TEST_PROFILE);
app.whenReady().then(() => {
  // Offscreen: on Electron 44 (Chromium 152), unlike 33, a never-shown window
  // on software compositing stops getting frames, and the drop and the Enter
  // key wait on them forever. Offscreen rendering keeps frames coming with no
  // GPU and no window on the operator's screen.
  const window = new BrowserWindow({ show: false, width: 1100, height: 700,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true } });
  window.loadURL(process.env.PDF_TEST_URL);
});
