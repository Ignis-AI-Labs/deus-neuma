// Hotkey legend — the ONE renderer-side declaration of every key the desk
// answers to, grouped the way a witness thinks about them.
//
// Pure data + pure shapers. The app-level accelerators (New Window etc.) are
// NOT duplicated here — they live in electron/hotkeys.cjs (the app-menu
// registry) and arrive over the preload bridge at render time, so the legend
// can never drift from what the menu actually binds. Renderer shortcuts ARE
// declared here; each entry cites the component that implements it, and
// test/unit/hotkey-legend.test.js holds the shape honest.
//
// Entry shape: { keys: string[], does: string, hint?: string }
//   keys — one chip per physical key ('CTRL','ALT','N'); '↑ / ↓' is one chip.
//   hint — a qualifier the chips can't carry ('hold', 'empty field').

export const RENDERER_HOTKEYS = Object.freeze([
  Object.freeze({
    group: 'WINDOWS',
    entries: Object.freeze([
      Object.freeze({
        keys: Object.freeze(['CTRL', 'SHIFT', 'N']),
        hint: 'CMD on macOS',
        does: 'Open a new stream window.',
        // new-stream-key.js. Desktop only: a browser keeps this chord for its
        // own private window, so a tab's legend must not claim it.
        desktopOnly: true,
      }),
      Object.freeze({
        keys: Object.freeze(['SHIFT', '\\']),
        hint: 'outside any text field',
        does: 'Move to the next open window.',
        // window-cycle.js, WindowManager.jsx
      }),
      Object.freeze({
        keys: Object.freeze(['CTRL', 'SHIFT', '\\']),
        hint: 'outside any text field',
        does: 'Move to the previous open window.',
      }),
      Object.freeze({
        keys: Object.freeze(['CTRL', 'SPACE']),
        does: 'Open the launcher — every app, found by typing.',
        // Dock.jsx (the taskbar) → Launcher.jsx
      }),
      Object.freeze({
        keys: Object.freeze(['ESC']),
        hint: 'five times, quickly, outside any window',
        does: 'Close every open window.',
        // escape-close.js, WindowManager.jsx
      }),
    ]),
  }),
  Object.freeze({
    group: 'VOICE',
    entries: Object.freeze([
      Object.freeze({
        keys: Object.freeze(['SPACE']),
        hint: 'hold, outside any text field',
        does: 'Push-to-talk — capture begins as you hold, ends when you release.',
        // StreamInput.jsx window keydown + dictation.js isPushToTalkPress
      }),
      Object.freeze({
        keys: Object.freeze(['SPACE']),
        hint: 'hold in the message field',
        does: 'Dictation — a held space becomes speech-to-text, appended to your draft.',
        // StreamInput.jsx composer keydown, HOLD_TO_TALK_MS in dictation.js
      }),
    ]),
  }),
  Object.freeze({
    group: 'MESSAGE FIELD',
    entries: Object.freeze([
      Object.freeze({
        keys: Object.freeze(['ENTER']),
        does: 'Send the message.',
      }),
      Object.freeze({
        keys: Object.freeze(['SHIFT', 'ENTER']),
        does: 'New line without sending.',
      }),
      Object.freeze({
        keys: Object.freeze(['↑']),
        hint: 'empty field',
        does: 'Recall your last sent message for revision.',
      }),
    ]),
  }),
  Object.freeze({
    group: 'SKILL PALETTE',
    entries: Object.freeze([
      Object.freeze({
        keys: Object.freeze(['/']),
        hint: 'first character',
        does: 'Open the skill palette.',
      }),
      Object.freeze({
        keys: Object.freeze(['↑ / ↓']),
        does: 'Move through the matched skills.',
      }),
      Object.freeze({
        keys: Object.freeze(['TAB']),
        does: 'Complete the highlighted skill into the field.',
      }),
      Object.freeze({
        keys: Object.freeze(['ENTER']),
        does: 'Complete the highlighted skill — or send, when the name is exact.',
      }),
      Object.freeze({
        keys: Object.freeze(['ESC']),
        does: 'Close the palette and keep typing.',
      }),
    ]),
  }),
  Object.freeze({
    group: 'MENUS & DIALOGS',
    entries: Object.freeze([
      Object.freeze({
        keys: Object.freeze(['↑ / ↓']),
        does: 'Walk the items of an open menu.',
      }),
      Object.freeze({
        keys: Object.freeze(['ENTER']),
        does: 'Choose the highlighted item, or confirm a prompt.',
      }),
      Object.freeze({
        keys: Object.freeze(['ESC']),
        does: 'Dismiss — menus, prompts, and renames all stand down.',
      }),
    ]),
  }),
]);

/**
 * Pure — split an Electron accelerator into display key chips for a platform.
 * 'CmdOrCtrl+Alt+N' → ['CMD','ALT','N'] on darwin, ['CTRL','ALT','N'] elsewhere.
 * Unknown tokens pass through uppercased — the legend shows what is bound,
 * it never censors a key it doesn't recognize.
 */
export const acceleratorKeys = (accelerator, platform) =>
  String(accelerator)
    .split('+')
    .filter(Boolean)
    .map((part) => {
      const p = part.trim();
      if (/^CmdOrCtrl$|^CommandOrControl$/i.test(p)) return platform === 'darwin' ? 'CMD' : 'CTRL';
      if (/^Cmd$|^Command$/i.test(p)) return 'CMD';
      if (/^Ctrl$|^Control$/i.test(p)) return 'CTRL';
      return p.toUpperCase();
    });

/**
 * Pure — shape rows from the app-hotkey registry (electron/hotkeys.cjs, over
 * the bridge) into legend entries. Rows missing an accelerator or description
 * are dropped rather than rendered as half-truths.
 */
export const appHotkeyEntries = (rows, platform) =>
  (Array.isArray(rows) ? rows : [])
    .filter((r) => r && typeof r.accelerator === 'string' && typeof r.description === 'string')
    .map((r) => ({ keys: acceleratorKeys(r.accelerator, platform), does: r.description }));

/**
 * Pure — the full legend. App-level rows (present only inside the desktop
 * shell) lead as a DESK group; a browser tab shows renderer groups alone,
 * because claiming Ctrl+Alt+N in a tab where it does nothing would be a lie.
 */
export const legendGroups = (appRows, platform) => {
  const entries = appHotkeyEntries(appRows, platform);
  if (entries.length) return [{ group: 'DESK', entries }, ...RENDERER_HOTKEYS];
  // A browser tab: renderer keys the browser itself doesn't keep.
  return RENDERER_HOTKEYS
    .map((g) => ({ ...g, entries: g.entries.filter((e) => !e.desktopOnly) }))
    .filter((g) => g.entries.length);
};
