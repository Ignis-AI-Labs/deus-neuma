// Real-Electron proof of the trusted wallet-confirmation window's SECURITY
// boundary — no mocks (RULE 0). Every scenario drives the actual
// createConfirmWindow in the real main process via a real BrowserWindow, and
// the adversarial ones use a real SECOND webContents to forge the resolve.
//
// These are the properties an sc-echo review flagged as unproven (VERDICT BLOCK)
// for a security-critical, signature-gating surface:
//   1. An injected-markup view field can NEVER run script to forge an approval
//      (the sign request is attacker-controllable; the window renders it).
//   2. A resolve forged from a DIFFERENT webContents is ignored (sender check).
//   3. Close / Reject settles FALSE (default-deny).
//   4. Two concurrent confirmations: the second is rejected (one-at-a-time).
//   5. No ipcMain handler leaks between confirmations.
import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// THE LOOK for the theme legs — a real look store MAIN reads at window
// creation (the renderer is never trusted with it). Isolated to a tmp file
// so the operator's real dress is never touched.
const DRESS = { ground: '#2E2E2D', panel: '#C5303F', ink: '#FFFFFF', trim: '#B31414', head: '#FF9E9E' };
const LOOK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-look-'));
const LOOK_PATH = path.join(LOOK_DIR, 'look.json');
fs.writeFileSync(LOOK_PATH, JSON.stringify({ theme: DRESS, presets: [] }));

let app;
test.beforeAll(async () => {
  app = await electron.launch({
    args: [REPO, `--user-data-dir=${path.join(REPO, 'test-results', `wc-ud-${process.pid}`)}`],
    cwd: REPO,
    timeout: 60_000,
    env: {
      ...process.env,
      NEUMA_PIPELINE_MODE: 'operator',
      NEUMA_PORT: '0',
      NEUMA_CONFIRM_E2E: '1',
      NEUMA_LOOK_SETTINGS_PATH: LOOK_PATH,
    },
  });
  await app.firstWindow();
});
test.afterAll(async () => {
  if (app) await app.close();
  fs.rmSync(LOOK_DIR, { recursive: true, force: true });
});

// Drive one confirmation entirely inside the trusted main process. `scenario`
// is a string naming what the harness does once the window is up; it returns a
// plain object the test asserts on. Kept in main (app.evaluate) because the
// whole point is the main-side security logic, not any renderer.
const run = (scenario, payloadMessage) => app.evaluate(async ({ BrowserWindow, ipcMain }, args) => {
  // app.evaluate has no CommonJS `require`; the main process (ipc-handlers.cjs)
  // exposes the functions on a
  // strictly env-gated global (NEUMA_CONFIRM_E2E=1) for exactly this proof.
  const cw = { createConfirmWindow: global.__neumaConfirmE2E.createConfirmWindow };
  const cv = { buildSignConfirmView: global.__neumaConfirmE2E.buildSignConfirmView };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const findConfirm = () => BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'NEUMA Wallet' && !w.isDestroyed());
  const awaitConfirm = async () => { let w; for (let i = 0; i < 120 && !(w = findConfirm()); i++) await wait(50); return w; };

  const view = cv.buildSignConfirmView({ type: 'signMessage', message: args.payloadMessage });

  if (args.scenario === 'xss') {
    const promise = cw.createConfirmWindow(null, view);
    const win = await awaitConfirm();
    await wait(500); // give any injected onerror/onload every chance to fire
    const bodyText = await win.webContents.executeJavaScript("document.getElementById('body').textContent");
    const bodyHtml = await win.webContents.executeJavaScript("document.getElementById('body').innerHTML");
    const stillOpen = !win.isDestroyed();
    if (!win.isDestroyed()) await win.webContents.executeJavaScript("document.getElementById('reject').click()");
    const resolved = await promise;
    return { resolved, bodyText, bodyHtml, stillOpen };
  }

  if (args.scenario === 'forged-sender') {
    const promise = cw.createConfirmWindow(null, view);
    const win = await awaitConfirm();
    // A real attacker window with ipcRenderer, trying to forge the resolve.
    const attacker = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } });
    await attacker.loadURL('data:text/html,<html><body></body></html>');
    await attacker.webContents.executeJavaScript("require('electron').ipcRenderer.send('wallet-confirm:resolve', true)");
    await wait(300);
    const stillOpenAfterForge = !win.isDestroyed();
    if (!win.isDestroyed()) await win.webContents.executeJavaScript("document.getElementById('reject').click()");
    const resolved = await promise;
    attacker.destroy();
    return { stillOpenAfterForge, resolved };
  }

  if (args.scenario === 'concurrent') {
    const promise = cw.createConfirmWindow(null, view);
    await awaitConfirm();
    let err = null;
    try { await cw.createConfirmWindow(null, view); } catch (e) { err = e.message; }
    // Teardown: settle the first by destroying its window directly (fires the
    // 'closed' -> settle(false) path); never depend on a click landing.
    const win = findConfirm();
    if (win && !win.isDestroyed()) win.destroy();
    await Promise.race([promise.catch(() => {}), wait(3000)]);
    return { err };
  }

  if (args.scenario === 'no-leak') {
    // First run, settled by a close.
    const promise = cw.createConfirmWindow(null, view);
    const win = await awaitConfirm();
    win.destroy();
    const resolved = await promise;
    // If the VIEW handler leaked, re-registering it throws 'second handler'.
    let secondRegisterThrew = false;
    try { ipcMain.handle('wallet-confirm:view', () => null); ipcMain.removeHandler('wallet-confirm:view'); }
    catch { secondRegisterThrew = true; }
    return { resolved, secondRegisterThrew };
  }

  if (args.scenario === 'theme') {
    const promise = cw.createConfirmWindow(null, view);
    const win = await awaitConfirm();
    await wait(300); // the view pull + applyTheme settle
    const read = (js) => win.webContents.executeJavaScript(js);
    const bodyBg = await read('getComputedStyle(document.body).backgroundColor');
    const noticeBg = await read("getComputedStyle(document.querySelector('.notice')).backgroundColor");
    const signalVar = await read("getComputedStyle(document.documentElement).getPropertyValue('--signal').trim()");
    const headingColor = await read("getComputedStyle(document.querySelector('.heading')).color");
    const warnColor = await read(
      "(function(){var el=document.querySelector('.warn .tag');return el?getComputedStyle(el).color:null})()");
    if (!win.isDestroyed()) await win.webContents.executeJavaScript("document.getElementById('reject').click()");
    await promise;
    return { bodyBg, noticeBg, signalVar, headingColor, warnColor };
  }

  return { error: 'unknown scenario' };
}, { scenario, payloadMessage });

test('injected markup in a sign message renders as literal text and cannot forge an approval', async () => {
  const r = await run('xss', '<img src=x onerror="window.neumaConfirm.resolve(true)">HELLO');
  expect(r.stillOpen).toBe(true);            // the onerror never fired to settle it
  expect(r.resolved).toBe(false);            // approval was NOT forged
  expect(r.bodyText).toContain('onerror');   // shown verbatim, as text
  expect(r.bodyHtml).not.toContain('<img');  // escaped — never a live element
});

test('a resolve forged from a different webContents is ignored (sender-identity check)', async () => {
  const r = await run('forged-sender', 'authenticate with Neuma');
  expect(r.stillOpenAfterForge).toBe(true);  // the forged send did not settle it
  expect(r.resolved).toBe(false);            // only the real Reject settled it
});

test('two concurrent confirmations: the second is rejected (one-at-a-time)', async () => {
  const r = await run('concurrent', 'hello');
  expect(r.err).toMatch(/already open/i);
});

test('a confirmation leaves no ipcMain handler behind once it settles', async () => {
  const r = await run('no-leak', 'hello');
  expect(r.resolved).toBe(false);            // closing the window settled false
  expect(r.secondRegisterThrew).toBe(false); // the VIEW handler was cleaned up
});

test('the trusted window wears the operator dress — and the warning register never does', async () => {
  // A readable message: the dress paints ground + panel + trim.
  const calm = await run('theme', 'authenticate with Neuma');
  expect(calm.bodyBg).toBe('rgb(46, 46, 45)');     // ground #2E2E2D
  expect(calm.noticeBg).toBe('rgb(197, 48, 63)');  // panel #C5303F
  expect(calm.signalVar).toBe('#B31414');          // trim
  expect(calm.headingColor).toBe('rgb(255, 158, 158)'); // HEAD #FF9E9E on the heading

  // An OPAQUE payload raises the alert tone: the warning tag must speak in
  // stock ALERT — the dress can never quiet a warning.
  const alert = await run('theme', '0xdeadbeef');
  expect(alert.warnColor).toBe('rgb(255, 85, 51)'); // --alert #FF5533, untouched
});
