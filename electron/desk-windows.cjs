// Desk windows — the slot registry, the boot/handoff relay, and the one
// window factory every desk comes from.
//
// Split out of main.cjs (SIZE-020). This module is the SINGLE home of the
// window state (desks, pendingBoots, pendingHandoffs, menu-ready senders);
// main.cjs wires the app lifecycle, ipc-handlers.cjs the registrations, and
// both reach that state only through the factory's returned surface.

const { app, BrowserWindow, Menu, shell } = require('electron');
const { primaryBounds } = require('./primary-placement.cjs');
const path = require('node:path');
const { SLOT_ARG_PREFIX, lowestFreeSlot, hiddenDeskSlot } = require('./desk-slots.cjs');
const { BOOT_CLAIM_TTL_MS, sanitizeBootPayload } = require('./desk-boot.cjs');
const { buildContextMenuTemplate, nativeItemsOf } = require('./context-menu.cjs');
const { clampWebviewPreferences } = require('./webview-guard.cjs');
const { noDeskOnScreen } = require('./notify-text.cjs');
const { externalUrlFor, staysOnDesk } = require('./desk-links.cjs');
const { readLookTheme } = require('./wallet/look-theme.cjs');

/** Height of the window-controls band on Windows/Linux (base.css reads it back as env(titlebar-area-height)). */
const TITLE_BAND_PX = 32;

/** Pure — the web preferences every desk window opens with. */
const deskWebPreferences = (slot) => ({
  preload: path.join(__dirname, 'preload.cjs'),
  contextIsolation: true,
  nodeIntegration: false,
  // Explicit, not Electron's defaults: a desk renderer that can be fooled must
  // still hold no Node and keep the same-origin policy (preload.cjs is
  // written for the sandbox).
  sandbox: true,
  webSecurity: true,
  // THE COMFY VIEWPORT: the COMFYUI window embeds the engine's own UI in a
  // <webview>, which is the only way to show it INSIDE the desk. An
  // <iframe> cannot: ComfyUI 403s any request carrying
  // `Sec-Fetch-Site: cross-site` (server.py origin_only_middleware), and a
  // webview navigates its own top-level browsing context instead.
  //
  // This widens no privilege by itself — the guest is declared with its own
  // partition, no preload and no node, so it stays a sandboxed foreign
  // origin exactly as the detached workbench window was. `will-attach-
  // webview` below re-imposes that server-side, because the renderer's
  // attributes are not trustworthy on their own.
  webviewTag: true,
  additionalArguments: [`${SLOT_ARG_PREFIX}${slot}`],
});

// impure — the factory binds the registry to two seams the lifecycle owns:
// `getOrigin` (backend-spawn.cjs — where a desk loads from) and
// `announceStillRunning` (tray.cjs — the once-per-install close notice).
const createDeskWindows = ({ getOrigin, announceStillRunning }) => {
  // Desk-slot registry — every live window holds a stable slot (1, 2, …).
  // The ONE backend child serves them all; only window identity multiplies.
  // A desk's X only hides it, so it keeps its slot; a destroyed window frees
  // its slot and the next window claims the lowest free one, reclaiming the
  // layout persisted under that slot.
  const desks = new Map(); // slot -> BrowserWindow

  // One-shot boot payloads (the opener's auth token) waiting for the window
  // they were minted for, keyed by that window's webContents id. In-memory
  // only; an entry dies on delivery, on the claim deadline, or with its
  // window — whichever comes first. Never argv, never disk, never logged.
  const pendingBoots = new Map(); // webContents.id -> { payload, timer }

  const wipeBoot = (wcId) => {
    const entry = pendingBoots.get(wcId);
    if (!entry) return;
    clearTimeout(entry.timer);
    pendingBoots.delete(wcId);
  };

  // The new desk's preload claims its boot SYNCHRONOUSLY, before the page's
  // first script runs. Delivery is one-shot: the entry dies here. Any window
  // without a parked boot (slot 1, reloads, strangers) gets null.
  const claimBoot = (wcId) => {
    const entry = pendingBoots.get(wcId);
    wipeBoot(wcId);
    return entry ? entry.payload : null;
  };

  // impure — main-initiated New Window (menu, hotkey, second launch): main
  // cannot read a renderer's sessionStorage, so it asks the focused desk's
  // PRELOAD for a handoff (IPC send + timer + pendingHandoffs mutation); page
  // code never participates. Replies are matched by request id (a late reply
  // must not spawn a second desk); no reply within the deadline opens the
  // desk at the gateway, which is honest.
  const HANDOFF_TIMEOUT_MS = 1000;
  const pendingHandoffs = new Map(); // requestId -> resolve
  let handoffSeq = 0;

  const requestDeskHandoff = (win) => new Promise((resolve) => {
    if (!win || win.isDestroyed()) { resolve(null); return; }
    handoffSeq += 1;
    const requestId = handoffSeq;
    const timer = setTimeout(() => {
      pendingHandoffs.delete(requestId);
      resolve(null);
    }, HANDOFF_TIMEOUT_MS);
    pendingHandoffs.set(requestId, (payload) => {
      clearTimeout(timer);
      pendingHandoffs.delete(requestId);
      resolve(payload);
    });
    win.webContents.send('desk:request-handoff', requestId);
  });

  // The focused desk's preload answers a handoff request. Untrusted input:
  // the id must match a pending request — unknown or late replies are
  // dropped; the payload is sanitized at use.
  const settleHandoff = (requestId, payload) => {
    const settle = pendingHandoffs.get(requestId);
    if (settle) settle(payload);
  };

  // The window wallet dialogs fall back to when no asking sender is resolvable:
  // the focused desk, else the lowest-slot desk still alive.
  const fallbackWindow = () => {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused) return focused;
    const slots = [...desks.keys()].sort((a, b) => a - b);
    return slots.length ? desks.get(slots[0]) : null;
  };

  // Renderers that mounted the styled in-page context menu (LINE & CYCLE).
  // Until a renderer registers, right-clicks fall back to the native menu —
  // a surface that failed to load must never end up menuless.
  const menuReadySenders = new WeakSet();

  // The only edit roles the renderer may invoke back on its webContents.
  const MENU_ROLES = new Set(['cut', 'copy', 'paste', 'selectAll']);

  const markMenuReady = (wc) => menuReadySenders.add(wc);

  // The renderer answers a shown in-page menu with the chosen action. Input
  // is untrusted: only the known item kinds/roles ever reach webContents.
  const applyMenuAction = (wc, action) => {
    if (!action || typeof action !== 'object') return;
    if (action.kind === 'suggestion' && typeof action.word === 'string') {
      wc.replaceMisspelling(action.word);
    } else if (action.kind === 'add-to-dictionary' && typeof action.word === 'string') {
      wc.session.addWordToSpellCheckerDictionary(action.word);
    } else if (action.kind === 'role' && MENU_ROLES.has(action.role)) {
      wc[action.role]();
    }
  };

  // impure — read every live desk's situation, then ask the pure predicate.
  // `win.on('close')` HIDES the desk to the tray rather than destroying it
  // (see createWindow), so "hidden but alive" is the common state, not a rare
  // one: a check that forgot `isVisible()` would go silent exactly when the
  // operator most needs telling.
  const anyDeskOnScreen = () => !noDeskOnScreen(
    [...desks.values()]
      .filter((win) => !win.isDestroyed())
      .map((win) => ({ visible: win.isVisible(), minimized: win.isMinimized(), focused: win.isFocused() })),
  );

  // impure — bring one desk forward. restore() BEFORE show(): show() alone does
  // not reliably un-minimize, and restore() is a no-op when the window is not
  // minimized, so the pair is always correct and never costs anything.
  const raiseWin = (win) => {
    if (win.isMinimized()) win.restore();
    win.show(); win.focus();
    return win;
  };

  const liveDesks = () => [...desks].filter(([, win]) => !win.isDestroyed());

  // impure — bring the first live desk forward; null when none is up.
  const raiseDesk = () => {
    const [first] = liveDesks();
    return first ? raiseWin(first[1]) : null;
  };

  // impure — bring back a desk its X hid to the tray; null when none is hidden.
  const raiseHiddenDesk = () => {
    const slot = hiddenDeskSlot(liveDesks().map(([at, win]) => [at, { visible: win.isVisible() }]));
    return slot === null ? null : raiseWin(desks.get(slot));
  };

  // The tray's icon click and OPEN: a hidden desk first, else the live one;
  // false when none is up.
  const focusLiveDesk = () => Boolean(raiseHiddenDesk() || raiseDesk());

  // impure — point every live desk at the backend again, after a restart
  // (whose port is the one the new child reported).
  const reloadDesks = () => {
    liveDesks().forEach(([slot, win]) => {
      win.loadURL(getOrigin()).catch((err) => console.warn(`[neuma] desk ${slot} could not reload:`, err.message));
    });
  };

  // impure — open a desk carrying the focused desk's session (or bare when
  // there is nothing to carry). Every main-initiated entry point lands here.
  const openDeskFromFocused = async () => {
    const opener = fallbackWindow();
    const payload = opener ? await requestDeskHandoff(opener) : null;
    return createWindow(sanitizeBootPayload(payload));
  };

  // impure — open one desk. Claims the lowest free slot for its lifetime; the
  // slot rides into the renderer via additionalArguments (not a secret — it is
  // a layout key, never an auth artifact). Reusable: every entry point that
  // spawns a desk goes through here. `boot` (already sanitized) is parked for
  // this window's preload to claim synchronously before first paint.
  const createWindow = async (boot = null) => {
    const slot = lowestFreeSlot(desks.keys());
    const win = new BrowserWindow({
      ...primaryBounds({ width: 1280, height: 832 }),
      minWidth: 960,
      minHeight: 640,
      // the operator's own ground (CYBERDECK when undressed) — no flash on load
      backgroundColor: readLookTheme()?.ground || '#11161D',
      // The armillary on the taskbar — without it a dev desk shows the window
      // manager's generic icon (packaged builds also get it from the installer).
      icon: path.join(__dirname, '..', 'build', 'icon.png'),
      title: slot === 1 ? 'DEUS NEUMA' : `DEUS NEUMA — desk ${slot}`,
      // NO OS CHROME (Design note, 2026-10-05: […]). Windows/Linux: the
      // title bar goes; minimize / maximize / close are drawn in the desk's
      // own void (window-controls overlay) and the page's top band drags the
      // window (base.css .app-drag-band). macOS keeps its native chrome.
      ...(process.platform === 'darwin' ? {} : {
        titleBarStyle: 'hidden',
        titleBarOverlay: { color: '#000000', symbolColor: '#8f9a9a', height: TITLE_BAND_PX },
      }),
      show: false,
      webPreferences: deskWebPreferences(slot),
    });
    // The menu row goes too; its accelerators (New Window, reload, zoom,
    // devtools, quit) stay registered on the hidden menu.
    if (process.platform !== 'darwin') win.setMenuBarVisibility(false);
    desks.set(slot, win);
    if (boot) {
      const wcId = win.webContents.id;
      pendingBoots.set(wcId, {
        payload: boot,
        // A window that never claims (crash, hung load) must not leave a
        // token parked in memory.
        timer: setTimeout(() => wipeBoot(wcId), BOOT_CLAIM_TTL_MS),
      });
    }

    // External links (ollama.com, lmstudio.ai, etc.) open in the real browser —
    // http(s) only, the same gate as app:openExternal (desk-links.cjs says why).
    win.webContents.setWindowOpenHandler(({ url }) => {
      const target = externalUrlFor(url);
      if (target) shell.openExternal(target);
      return { action: 'deny' };
    });

    // The desk's own frame never leaves the desk's origin. Asked at the event,
    // not at creation: the origin is the backend's, and the port is settled
    // only once the backend reports it.
    win.webContents.on('will-navigate', (event, url) => {
      if (!staysOnDesk(url, getOrigin())) event.preventDefault();
    });
    // …and no server redirect carries it off either (audit 2026-10-28 M-07).
    win.webContents.on('will-redirect', (event, url) => {
      if (!staysOnDesk(url, getOrigin())) event.preventDefault();
    });

    // THE COMFY VIEWPORT's guest, clamped in the MAIN process. The renderer sets
    // the <webview> attributes, so the renderer could set them wrong (or be made
    // to) — main is the only side whose word is trustworthy. Every embedded guest
    // is stripped to a bare sandboxed frame on a loopback engine origin, which is
    // the same posture the detached workbench window has always had.
    win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
      const verdict = clampWebviewPreferences(webPreferences, params);
      if (!verdict.allow) event.preventDefault();
    });

    // Right-click menu — spelling corrections + edit ops. Chromium flags the
    // misspelling but Electron offers no menu of its own, so without this the
    // witness could see the error yet never reach the correction. The item
    // shapes come from the pure builder (context-menu.cjs). A native OS menu
    // cannot be styled, so when the renderer has mounted the in-page menu
    // (LINE & CYCLE), the template rides IPC and the renderer draws it;
    // otherwise the native menu opens so no surface is ever menuless.
    win.webContents.on('context-menu', (_event, params) => {
      const items = buildContextMenuTemplate(params);
      if (!items.length) return;
      if (menuReadySenders.has(win.webContents)) {
        win.webContents.send('contextmenu:show', { x: params.x, y: params.y, items });
        return;
      }
      const template = nativeItemsOf(items).map((item) => {
        switch (item.kind) {
          case 'suggestion':
            return { label: item.word, click: () => win.webContents.replaceMisspelling(item.word) };
          case 'add-to-dictionary':
            return {
              label: `Add “${item.word}” to dictionary`,
              click: () => win.webContents.session.addWordToSpellCheckerDictionary(item.word),
            };
          case 'separator':
            return { type: 'separator' };
          default:
            return { role: item.role };
        }
      });
      Menu.buildFromTemplate(template).popup();
    });

    // The first desk fills the primary screen on launch (Design note, 2026-10-14: […]); a further desk opens at its centred size.
    // Maximized, not fullscreen: the system's own panel stays reachable.
    win.once('ready-to-show', () => {
      if (slot === 1) win.maximize();
      win.show();
    });
    const wcId = win.webContents.id;
    // ALWAYS-ON (Design note, 2026-07-28 — the Discord/Steam model): the window's X
    // HIDES the desk to the tray; it never kills the app or the backend —
    // approved posts fire only while the backend lives, so the app exits only
    // through an explicit QUIT (tray menu or the OS's own).
    win.on('close', (event) => {
      if (app.isQuitting) return;
      event.preventDefault();
      win.hide();
      // Say — once — that hiding is not quitting, and where the exit lives.
      announceStillRunning();
    });
    win.on('closed', () => {
      desks.delete(slot); // the slot (and its persisted layout) is claimable again
      wipeBoot(wcId); // a boot that outlived its window is wiped with it
    });
    await win.loadURL(getOrigin());
    return win;
  };

  // THE BOOT'S DESK. A launch that lands while the boot is still bringing the
  // backend up must not open a desk of its own: it would load an origin nobody
  // serves yet, hold slot 1 as a dead window and push the boot's desk to slot 2.
  let booted = false;
  let markBooted = null;
  const firstDeskSettled = new Promise((resolve) => { markBooted = resolve; });

  // impure — the boot opens its first desk here, and only here.
  const bootFirstDesk = async () => {
    try {
      return await createWindow();
    } finally {
      booted = true;
      markBooted();
    }
  };

  // impure — the OS launched the app again. A second launch means another desk
  // (VS Code behaviour), with two exceptions: a launch during the boot waits
  // for the boot's desk and raises it, and a desk the X hid to the tray comes
  // back before a new one is opened.
  const secondLaunch = async () => {
    if (!booted) {
      await firstDeskSettled;
      return raiseDesk();
    }
    return raiseHiddenDesk() || openDeskFromFocused();
  };

  return Object.freeze({
    createWindow,
    bootFirstDesk,
    secondLaunch,
    openDeskFromFocused,
    fallbackWindow,
    raiseDesk,
    focusLiveDesk,
    reloadDesks,
    anyDeskOnScreen,
    claimBoot,
    settleHandoff,
    markMenuReady,
    applyMenuAction,
  });
};

module.exports = { createDeskWindows, deskWebPreferences };
