// NEUMA preload — a deliberately minimal, locked-down bridge.
//
// The renderer talks to the local backend over HTTP/WS exactly like any web
// client, so nothing privileged is exposed here. We surface only a tiny marker
// the frontend can use to know it's running inside the native shell.

const { contextBridge, ipcRenderer } = require('electron');

// Which desk this window IS — parsed from the argv main passed via
// additionalArguments. INLINED, not required from desk-slots.cjs: the
// renderer sandbox (Electron default, kept ON) lets a preload require only
// 'electron', and a throwing require here takes the WHOLE window.neuma
// bridge down with it — wallet included (caught live by desk-relay.spec.js).
// Keep in sync with SLOT_ARG_PREFIX/parseDeskSlot in desk-slots.cjs, where
// the canonical logic lives and is unit-tested.
const parseDeskSlot = (argv) => {
  const arg = argv.find((a) => typeof a === 'string' && a.startsWith('--neuma-desk-slot='));
  if (!arg) return null;
  const n = Number(arg.slice('--neuma-desk-slot='.length));
  return Number.isInteger(n) && n >= 1 ? n : null;
};

// One-shot boot claim — SYNCHRONOUS on purpose: preload runs before the
// page's first script, so the auth token is already in sessionStorage when
// app-state's initialPhase() reads it. The desk wakes authenticated; the
// gateway never flashes; the auth rate budget is never spent twice. Windows
// with no parked boot (the first desk, reloads) get null and change nothing.
// The window-local companion binding key. Kept in sync with
// companion-data.js (scopedKey + WINDOW_COMPANION_KEY / COMPANION_SEED_KEY)
// — inlined because the sandboxed preload may only require 'electron', and
// the desk-relay e2e is the drift sentinel.
const windowCompanionKey = () => {
  let wallet = null;
  try { wallet = (window.localStorage.getItem('walletAddress') || '').toLowerCase() || null; } catch { /* pre-auth */ }
  return wallet ? `${wallet}:neuma-window-companion` : 'neuma-window-companion';
};

// This window's bound companion, as the opener-side seed for a spawned desk.
const readWindowCompanion = () => {
  try {
    const raw = window.sessionStorage.getItem(windowCompanionKey());
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};

// The preload runs TWICE per window: once for the initial about:blank
// document, once for the real navigation (proven by desk-relay.spec.js —
// the blank run claimed the one-shot boot and seeded a throwaway origin's
// storage, and the real run got nothing). Claim ONLY on the app's real
// origin: the one-shot is spent exactly where the token must land.
const onAppOrigin = window.location.protocol === 'http:'
  && window.location.hostname === '127.0.0.1';
if (onAppOrigin) {
  try {
    const boot = ipcRenderer.sendSync('desk:claim-boot');
    if (boot && typeof boot.authToken === 'string') {
      window.sessionStorage.setItem('authToken', boot.authToken);
      // The opener's companion parks under the NEUTRAL seed key —
      // companion-data's resolveBoundCompanion consumes it exactly once
      // and stamps it as this window's own (wallet-scoped) binding.
      if (boot.companion) {
        window.sessionStorage.setItem('neuma-companion-seed', JSON.stringify(boot.companion));
      }
    }
  } catch {
    // A genuine IPC/storage failure (an ABSENT handler returns undefined,
    // it does not throw) — degrade to gateway auth rather than a dead desk.
  }
}

// Main-initiated New Window (menu, hotkey, second launch): main asks THIS
// desk for a session handoff. Answered here in the preload — page code never
// participates — and only from the app's real origin; anywhere else the
// reply carries nothing and the new desk opens at the gateway.
ipcRenderer.on('desk:request-handoff', (_event, requestId) => {
  let authToken = null;
  let companion = null;
  if (onAppOrigin) {
    try { authToken = window.sessionStorage.getItem('authToken'); } catch { /* reply empty */ }
    companion = readWindowCompanion();
  }
  ipcRenderer.send('desk:handoff-reply', requestId, { authToken, companion });
});

// The bridge exists only on the app's own origin (audit 2026-10-28 M-07): a
// frame anywhere else — a page the desk was somehow sent to — gets no wallet,
// no folders, no openExternal.
if (onAppOrigin) contextBridge.exposeInMainWorld('neuma', {
  desktop: true,
  platform: process.platform,
  // Which desk this window IS (1, 2, …) — a stable layout key claimed at
  // window creation (main passes it via additionalArguments; not a secret).
  // Plain browser tabs and pre-slot windows read null and fall back to
  // desk-1 semantics.
  deskSlot: parseDeskSlot(process.argv),
  desk: {
    // Spawn a sibling desk that wakes already-authenticated. The token is
    // read HERE (bridge side) and rides the one-shot in-memory relay in
    // main — it never crosses argv, disk, or the exposed API surface.
    // Fire-and-forget: resolves { scheduled: true } once main accepted the
    // spawn; load failures surface in main's native error dialog.
    open: () => ipcRenderer.invoke('desk:open', {
      authToken: window.sessionStorage.getItem('authToken'),
      companion: readWindowCompanion(),
    }),
  },
  // Open a URL in the user's real browser (used by the wallet bridge to reach
  // their Rabby/MetaMask). Main validates the scheme; the key never crosses here.
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  // A fresh install's owner claim for the first sign-in (null once owned);
  // main answers the desk's own top frame only.
  ownerClaim: () => ipcRenderer.invoke('app:ownerClaim'),
  // Open a LOCAL HTML file in the default browser (the FILES tree's OPEN IN
  // BROWSER). Main gates: absolute .html/.htm path that exists as a file.
  openInBrowser: (filePath) => ipcRenderer.invoke('app:openInBrowser', filePath),
  showInFolder: (filePath) => ipcRenderer.invoke('app:showInFolder', filePath),
  // THE DRAG-OUT: an Explorer row dragged toward the OS starts a REAL
  // OS-level drag of the file itself (Dolphin, the desktop, another app).
  // Main re-validates: absolute path, existing file, never a directory.
  startFileDrag: (filePath) => ipcRenderer.send('files:start-drag', filePath),
  // THE IMAGE FORGE workbench — ComfyUI's own UI as a dedicated sandboxed
  // child window (own session partition; main validates loopback-http).
  // Render-only: no bridge reaches INTO that window, ever.
  workbench: {
    open: (url) => ipcRenderer.invoke('workbench:open', url),
  },
  browser: {
    open: (url) => ipcRenderer.invoke('browser:open', url),
  },
  // Native folder picker for the pre-flight workspace-home step. Resolves to the
  // chosen absolute path, or null if the witness cancels.
  chooseDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  residency: {
    get: () => ipcRenderer.invoke('residency:get'),
    set: (enabled) => ipcRenderer.invoke('residency:set', enabled),
  },
  // The desk's announcement lane, when the operator is looking somewhere else.
  // `notify` is one-way and carries METADATA ONLY — main re-validates every
  // field and accepts no icon path and no URL. `onActivate` fires when the
  // operator clicks the OS notification and returns its own unsubscribe, so a
  // React effect can detach cleanly (a listener that outlives its component
  // shows the same card twice).
  //
  // Nothing here may throw at construction: a throwing initializer in this file
  // takes the WHOLE window.neuma bridge down with it, wallet included.
  notifications: {
    notify: (payload) => ipcRenderer.send('notifications:notify', payload),
    onActivate: (cb) => {
      const handler = (_event, payload) => cb(payload);
      ipcRenderer.on('notifications:activate', handler);
      return () => ipcRenderer.removeListener('notifications:activate', handler);
    },
  },
  // The desk's update bar and WHAT'S NEW (electron/update-bar.cjs). `state` reads what to show,
  // `onChange` hears every change and returns its own unsubscribe, `act` sends the one choice
  // made ('restart' | 'download' | 'later' | 'seen' | 'check'); main re-checks every act against the
  // offer, except 'check' — the person's own Check now, asked even while the update check is off.
  update: {
    state: () => ipcRenderer.invoke('update:state'),
    act: (action) => ipcRenderer.invoke('update:act', action),
    onChange: (cb) => {
      const handler = (_event, view) => cb(view);
      ipcRenderer.on('update:changed', handler);
      return () => ipcRenderer.removeListener('update:changed', handler);
    },
  },
  // CONNECTIONS (electron/connections-main.cjs): the panel tells main a switch changed, so the
  // spellcheck switch lands on every session at once.
  connections: {
    changed: () => ipcRenderer.invoke('connections:changed'),
  },
  // THE KEY LOCK (electron/key-lock/key-lock-main.cjs): whether the keychain holds
  // Neuma's key, and the Recovery Kit — shown on request, confirmed saved, or replaced.
  keyLock: {
    status: () => ipcRenderer.invoke('keyLock:status'),
    revealKit: () => ipcRenderer.invoke('keyLock:revealKit'),
    confirmKit: () => ipcRenderer.invoke('keyLock:confirmKit'),
    newKit: () => ipcRenderer.invoke('keyLock:newKit'),
  },
  // App-level hotkeys (electron/hotkeys.cjs), for the Settings legend. Data
  // only — rebinding stays main's business.
  hotkeys: () => ipcRenderer.invoke('hotkeys:list'),
  // Right-click menu, drawn in-page so it keeps the platform's look (native
  // OS menus can't be styled). Main sends the declarative item template;
  // the renderer answers with the single action the witness chose.
  contextMenu: {
    ready: () => ipcRenderer.send('contextmenu:ready'),
    onShow: (cb) => {
      const handler = (_event, payload) => cb(payload);
      ipcRenderer.on('contextmenu:show', handler);
      return () => ipcRenderer.removeListener('contextmenu:show', handler);
    },
    act: (action) => ipcRenderer.send('contextmenu:action', action),
    // DEFINE's card asks main for the word's meaning (offline dictionary)
    define: (word) => ipcRenderer.invoke('dictionary:define', word),
  },
  // Witness wallet — the renderer calls these; the key never crosses this
  // bridge. `request` is the EIP-1193 surface; the rest is wallet management.
  wallet: {
    status: () => ipcRenderer.invoke('wallet:status'),
    list: () => ipcRenderer.invoke('wallet:list'),
    assessPassword: (pw) => ipcRenderer.invoke('wallet:assessPassword', pw),
    create: (password) => ipcRenderer.invoke('wallet:create', password),
    importMnemonic: (phrase, password) => ipcRenderer.invoke('wallet:importMnemonic', phrase, password),
    importPrivateKey: (pk, password) => ipcRenderer.invoke('wallet:importPrivateKey', pk, password),
    select: (id) => ipcRenderer.invoke('wallet:select', id),
    unlock: (id, password, remember) => ipcRenderer.invoke('wallet:unlock', id, password, remember),
    tryRemembered: () => ipcRenderer.invoke('wallet:tryRemembered'),
    canKeepMadeKey: () => ipcRenderer.invoke('wallet:canKeepMadeKey'),
    createForMe: () => ipcRenderer.invoke('wallet:createForMe'),
    revealMade: (id) => ipcRenderer.invoke('wallet:revealMade', id),
    lock: () => ipcRenderer.invoke('wallet:lock'),
    reveal: (id, password) => ipcRenderer.invoke('wallet:reveal', id, password),
    remove: (id, password) => ipcRenderer.invoke('wallet:remove', id, password),
    request: (payload) => ipcRenderer.invoke('wallet:request', payload),
    // Custom RPC endpoint. The secret URL stays in main; these only carry a
    // masked status ({custom, label}) and set/clear results — never the raw URL.
    rpc: {
      status: () => ipcRenderer.invoke('wallet:rpc:status'),
      set: (url) => ipcRenderer.invoke('wallet:rpc:set', url),
      clear: () => ipcRenderer.invoke('wallet:rpc:clear'),
    },
    // Network selection (Base mainnet / Base Sepolia). Not a secret — status
    // carries the full selected-network object; set is gated in main by the
    // trusted confirm window.
    network: {
      status: () => ipcRenderer.invoke('wallet:network:status'),
      set: (key) => ipcRenderer.invoke('wallet:network:set', key),
    },
    // Ledger hardware wallet — read-only account discovery. Resolves to public
    // { path, address } records; private keys never leave the device.
    ledgerListAccounts: (opts) => ipcRenderer.invoke('wallet:ledger:listAccounts', opts),
    ledgerGetAccount: (derivationPath) => ipcRenderer.invoke('wallet:ledger:getAccount', derivationPath),
    // Sign the login challenge ON the device — resolves to a 0x signature only.
    ledgerSignMessage: (derivationPath, message) => ipcRenderer.invoke('wallet:ledger:signMessage', derivationPath, message),
    onLocked: (cb) => {
      const handler = () => cb();
      ipcRenderer.on('wallet:locked', handler);
      return () => ipcRenderer.removeListener('wallet:locked', handler);
    },
  },
});
