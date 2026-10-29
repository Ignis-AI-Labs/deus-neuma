// The real permission floor in a real Electron: two pages, the desk's origin
// and a stranger's, each asking for the microphone, the camera and location.
// The test reads what each page was given (test/integration/electron-permission-guard.test.js).
const { app, BrowserWindow, session } = require('electron');
const { guardAppSessions } = require('../../electron/permission-guard.cjs');

app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.setPath('userData', process.env.PERMISSION_TEST_PROFILE);

app.whenReady().then(async () => {
  guardAppSessions(session, () => process.env.PERMISSION_TEST_DESK);
  for (const url of [process.env.PERMISSION_TEST_DESK, process.env.PERMISSION_TEST_STRANGER]) {
    const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    await win.loadURL(url);
  }
});
