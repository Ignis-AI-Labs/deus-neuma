// Real main for the spellcheck switch proof: the app's own registerConnections on a fresh profile,
// every dictionary download event recorded, and a page whose preload can knock as the panel does.
const path = require('path');
const { app, BrowserWindow, ipcMain, session } = require('electron');
const { registerConnections } = require('../../electron/connections-main.cjs');

app.setPath('userData', process.env.SPELL_TEST_PROFILE);
global.spellEvents = [];
app.whenReady().then(async () => {
  for (const kind of ['begin', 'success', 'failure']) {
    session.defaultSession.on(`spellcheck-dictionary-download-${kind}`, (_e, lang) => global.spellEvents.push(`${kind}:${lang}`));
  }
  registerConnections({ app, ipcMain, session });
  const win = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, 'spellcheck-switch-preload.cjs') } });
  await win.loadURL('data:text/html,<textarea id="t"></textarea>');
});
