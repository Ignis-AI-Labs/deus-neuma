// Hotkeys — the ONE declarative table of NEUMA's app-level key bindings.
//
// Every binding is declared here (id, label, accelerator) and consumed by
// whoever needs it: the application menu registers the accelerators today; a
// future settings surface reads and rewrites the same table. Adding a binding
// means adding a row — never wiring a bare accelerator string somewhere deep.
//
// Accelerators use Electron's cross-platform names: CmdOrCtrl renders as
// Ctrl+Alt+N on Linux/Windows and Cmd+Alt+N on macOS.
//
// Pure data + pure builders — ipc-handlers.cjs supplies the actions and calls
// Menu.buildFromTemplate; nothing here touches Electron.

const APP_HOTKEYS = Object.freeze([
  Object.freeze({
    id: 'desk.new',
    label: 'New Window',
    accelerator: 'CmdOrCtrl+Alt+N',
    description: 'Open another desk on your current session — same wallet, same house.',
  }),
  Object.freeze({
    id: 'desk.new-fresh',
    label: 'New Window — Separate Sign-In',
    accelerator: 'CmdOrCtrl+Alt+Shift+N',
    description: 'Open a desk at the gateway — sign in with a different wallet or house.',
  }),
]);

/**
 * Pure — the application menu template. Standard role-based menus survive
 * (edit ops, reload, devtools, window management); NEUMA's own entries are
 * generated from APP_HOTKEYS so the menu can never drift from the registry.
 * @param {{ isMac: boolean, actions: Record<string, () => void> }} deps
 *   actions maps hotkey id -> click handler; a missing action throws LOUDLY
 *   at build time (a bound key that silently does nothing is a lie).
 * @returns {object[]} template for Menu.buildFromTemplate
 */
const buildAppMenuTemplate = ({ isMac, actions, onShowLogs = null }) => {
  const item = (id) => {
    const hk = APP_HOTKEYS.find((h) => h.id === id);
    const click = actions[id];
    if (!hk || typeof click !== 'function') {
      throw new Error(`hotkey '${id}' has no ${hk ? 'action' : 'registry row'}`);
    }
    return { id: hk.id, label: hk.label, accelerator: hk.accelerator, click };
  };

  return [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        item('desk.new'),
        item('desk.new-fresh'),
        { type: 'separator' },
        // QUIT lives HERE too, not only in the tray (UX-002 #215). The window's
        // X hides to the tray by design — but on Windows a new tray icon
        // defaults into the overflow flyout behind the `^` chevron, so for a
        // first-run user the only exit was somewhere they had no reason to
        // look. Twice on 2026-07-30 an operator reported NEUMA closed while it
        // was serving. The menu is a surface people already open.
        // Named rather than `role: 'quit'`: "Quit" beside a window that only
        // hides is ambiguous; this one says which it is.
        isMac ? { role: 'close' } : { label: 'QUIT DEUS NEUMA (stops your beings)', role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    // HELP exists for one reason: so a person reporting a problem can produce
    // the log without being talked through a hidden path over chat. Four
    // versions shipped for one community member before anyone could see what
    // his backend was doing (ruling, 2026-08-03) — the file existed nowhere and,
    // once it did, nothing pointed at it. Only shown when the app actually
    // keeps logs (packaged runs), because a menu item that opens nothing is
    // worse than no menu item.
    ...(onShowLogs ? [{
      label: 'Help',
      submenu: [
        { label: 'Show diagnostic logs…', click: onShowLogs },
      ],
    }] : []),
  ];
};

module.exports = { APP_HOTKEYS, buildAppMenuTemplate };
