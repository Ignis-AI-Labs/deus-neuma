// Real main for the update-switch proof: the app's own auto-update init (the real electron-updater,
// the real timers), run from a binary whose name makes Electron call itself packaged. Prints what
// it did; the test's loopback feed records what it asked.
const { app, shell, Notification } = require('electron');
const autoUpdate = require('../../electron/auto-update.cjs');

app.setPath('userData', process.env.UPDATE_SWITCH_PROFILE);
app.whenReady().then(async () => {
  const started = autoUpdate.init({ app, shell, Notification, refreshTray: () => {}, env: process.env });
  console.log(`FORM ${started.form}`);
  if (process.env.UPDATE_SWITCH_ASK === '1') console.log(`ASKED ${JSON.stringify(await autoUpdate.checkNow())}`);
  setTimeout(() => app.exit(0), 8000); // past the first scheduled tick (5 s)
});
