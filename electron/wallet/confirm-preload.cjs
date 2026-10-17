// Dedicated preload for the trusted wallet-confirmation window ONLY.
//
// This is NOT the app preload. It is loaded solely by the confirm BrowserWindow,
// which renders a packaged-local file (never the app origin), so the app
// renderer can neither reach this window's contents nor script the button. The
// surface is two calls: pull the read-only view model, and report the single
// boolean the human chose. No key material, no wallet capability, ever crosses
// here — main verifies the resolve came from THIS window's own contents before
// trusting it (see confirm-view.isTrustedResolve).

const { contextBridge, ipcRenderer } = require('electron');

const VIEW = 'wallet-confirm:view';
const RESOLVE = 'wallet-confirm:resolve';

contextBridge.exposeInMainWorld('neumaConfirm', {
  // Pull the display model main parked for this confirmation.
  view: () => ipcRenderer.invoke(VIEW),
  // Report the human's choice. Coerced to a strict boolean so the page can
  // never smuggle a truthy non-true value past the main-side check.
  resolve: (approved) => ipcRenderer.send(RESOLVE, approved === true),
});
