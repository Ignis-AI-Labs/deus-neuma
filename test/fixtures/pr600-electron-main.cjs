const http = require('node:http');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { registerWalletIpc } = require('../../electron/wallet/wallet-ipc.cjs');
const { createConfirmWindow, VIEW } = require('../../electron/wallet/confirm-window.cjs');
const { buildSignConfirmView } = require('../../electron/wallet/confirm-view.cjs');
const { createDeskWindows } = require('../../electron/desk-windows.cjs');
const { registerIpcHandlers } = require('../../electron/ipc-handlers.cjs');

app.disableHardwareAcceleration();
app.on('window-all-closed', (event) => event.preventDefault());
app.setPath('userData', process.env.PR600_PROFILE);

const page = (name) => `<!doctype html><title>${name}</title><p>${name}</p>`;

app.whenReady().then(async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(page(req.url));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  globalThis.result = { origin };

  try {
    ipcMain.handle(VIEW, () => null);
    try {
      await createConfirmWindow(null, buildSignConfirmView({ type: 'sign', message: 'duplicate handler' }));
    } catch (error) {
      globalThis.result.earlyError = error.message;
    }
    ipcMain.removeHandler(VIEW);
    const recovered = createConfirmWindow(null, buildSignConfirmView({ type: 'sign', message: 'recovered' }));
    let confirm;
    for (let i = 0; i < 100 && !confirm; i += 1) {
      confirm = BrowserWindow.getAllWindows().find((win) => win.getTitle() === 'NEUMA Wallet' && !win.isDestroyed());
      if (!confirm) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await confirm.webContents.executeJavaScript(`(async () => {
      for (let i = 0; i < 100; i += 1) {
        const button = document.getElementById('reject');
        if (button) { button.click(); return true; }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error('confirm reject button never rendered');
    })()`);
    globalThis.result.recovered = await recovered;
    confirm = null;
    Object.defineProperty(app, 'isPackaged', { value: true, configurable: true });
    try {
      registerWalletIpc({ getWindow: () => null, userDataPath: path.join(process.env.PR600_PROFILE, 'omitted') });
    } catch (error) {
      globalThis.result.omission = error.message;
    }

    const deskWindows = createDeskWindows({ getOrigin: () => origin, announceStillRunning: () => {} });
    registerIpcHandlers({ deskWindows, getOrigin: () => origin });
    globalThis.result.testGlobal = typeof globalThis.__neumaConfirmE2E;

    const makeWindow = () => new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'pr600-wallet-preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const desk = makeWindow();
    await desk.loadURL(`${origin}/desk`);
    globalThis.result.deskStatus = await desk.webContents.executeJavaScript('window.walletProbe.status()');
    desk.destroy();

    const foreign = makeWindow();
    await foreign.loadURL(`http://localhost:${server.address().port}/foreign`);
    globalThis.result.foreignError = await foreign.webContents.executeJavaScript(
      'window.walletProbe.status().catch((error) => error.message)',
    );
    foreign.destroy();

    const packagedDesk = await deskWindows.createWindow();
    packagedDesk.webContents.openDevTools();
    globalThis.result.devTools = packagedDesk.webContents.isDevToolsOpened();
    packagedDesk.destroy();

    const first = createConfirmWindow(null, buildSignConfirmView({ type: 'sign', message: 'first' }));
    for (let i = 0; i < 100 && !confirm; i += 1) {
      confirm = BrowserWindow.getAllWindows().find((win) => win.getTitle() === 'NEUMA Wallet' && !win.isDestroyed());
      if (!confirm) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    try {
      await createConfirmWindow(null, buildSignConfirmView({ type: 'sign', message: 'second' }));
    } catch (error) {
      globalThis.result.concurrent = error.message;
    }
    confirm.destroy();
    globalThis.result.firstClosed = await first;
    globalThis.result.ready = true;
  } catch (error) {
    globalThis.result.fatal = error.stack || error.message;
    globalThis.result.ready = true;
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
