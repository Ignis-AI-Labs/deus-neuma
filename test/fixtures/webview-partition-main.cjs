// impure — an isolated Electron embedder whose renderer declares <webview>
// guests the way a compromised desk renderer could: one with no partition
// (the desk's own default session) and one with a partition of its choosing.
// Main applies the SAME clamp desk-windows.cjs applies at will-attach-webview
// and records which session each guest actually got.
const { app, BrowserWindow, session } = require('electron');
const fs = require('fs');
const path = require('path');
const { clampWebviewPreferences } = require('../../electron/webview-guard.cjs');

app.disableHardwareAcceleration();
app.setPath('userData', process.env.WEBVIEW_TEST_PROFILE);

globalThis.attached = [];

app.whenReady().then(() => {
  const guestUrl = process.env.WEBVIEW_TEST_GUEST_URL;
  const page = path.join(process.env.WEBVIEW_TEST_PROFILE, 'embedder.html');
  fs.writeFileSync(page, `<!doctype html><html><body>
<webview id="bare" src="${guestUrl}bare"></webview>
<webview id="desk" src="${guestUrl}desk" partition="persist:desk-own"></webview>
</body></html>`);
  const window = new BrowserWindow({ show: false, width: 800, height: 600,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, webviewTag: true } });
  window.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    if (!clampWebviewPreferences(webPreferences, params).allow) event.preventDefault();
  });
  window.webContents.on('did-attach-webview', (_event, guest) => {
    guest.once('did-finish-load', () => {
      globalThis.attached.push({
        url: guest.getURL(),
        storagePath: guest.session.storagePath,
        isComfy: guest.session === session.fromPartition('persist:comfyui-workbench'),
        isDefault: guest.session === session.defaultSession,
      });
    });
  });
  globalThis.sessions = {
    comfy: session.fromPartition('persist:comfyui-workbench').storagePath,
    desk: session.defaultSession.storagePath,
  };
  window.loadFile(page);
});
