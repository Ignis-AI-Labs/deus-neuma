// Gnosis for the unlock window (electron/key-lock/unlock-window.cjs), driven in
// a real Electron window: a wrong Recovery Kit code is refused on the page, the
// right one (typed in lower case, with spaces) opens the lock.
//   npx electron scripts/key-lock-unlock-proof.cjs
const { app, BrowserWindow } = require('electron');
const crypto = require('node:crypto');
const core = require('../electron/key-lock/key-lock-core.cjs');
const { askRecoveryCode } = require('../electron/key-lock/unlock-window.cjs');

const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) process.exitCode = 1; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const keys = { dnaEncryptionKey: crypto.randomBytes(32).toString('hex'), authSecret: crypto.randomBytes(32).toString('hex') };
  const code = core.newRecoveryCode();
  const wrap = core.sealWithCode(keys, code);
  const asked = askRecoveryCode((typed) => ({ state: 'unlocked', keys: core.openWithCode(wrap, typed) }));
  let win;
  for (let i = 0; i < 50 && !win; i += 1) { await wait(100); win = BrowserWindow.getAllWindows()[0]; }
  check(Boolean(win), 'the unlock window opens');
  await new Promise((r) => (win.webContents.isLoading() ? win.webContents.once('did-finish-load', r) : r()));
  const page = (js) => win.webContents.executeJavaScript(js);
  await page(`document.getElementById('code').value = 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA'; document.getElementById('unlock').click();`);
  await wait(2500);
  check(/does not open/.test(await page(`document.getElementById('error').textContent`)), 'a wrong code is refused on the page, plainly');
  await page(`document.getElementById('code').value = ${JSON.stringify(code.toLowerCase().replace(/-/g, ' '))}; document.getElementById('unlock').click();`);
  const result = await Promise.race([asked, wait(15000).then(() => null)]);
  check(result?.keys?.dnaEncryptionKey === keys.dnaEncryptionKey, 'the right code, typed loosely, opens the lock and the window closes');
  check(BrowserWindow.getAllWindows().length === 0, 'no window is left behind');
  app.quit();
});
