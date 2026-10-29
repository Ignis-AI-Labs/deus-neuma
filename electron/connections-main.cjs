// connections-main.cjs — the main process's half of CONNECTIONS (connections.cjs): the spellcheck
// switch on every session, and the knock a desk sends when the person flips a switch.
//
// Chromium fetches a language's spellcheck dictionary from Google the first time a page spells
// anything. Off until the person turns it on (Design note, 2026-10-25, so the switch lands on the default
// session before any window exists, on every session made after it (the ComfyUI guest's partition),
// and again whenever the CONNECTIONS panel says a switch changed.
//
// OFF IS AN EMPTY LANGUAGE LIST. Proven against Electron 44 with fresh profiles: a session with
// setSpellCheckerEnabled(false) STILL downloaded en-US-10-1.bdic; one with no languages asked for
// nothing at all (no download event, no file). Chromium hands every launch its default languages
// again, so each session's defaults are read before they are cleared, and turning it on restores
// them (the dictionary then downloads once). macOS uses its own spellchecker and downloads nothing.

const path = require('path');
const connections = require('./connections.cjs');

/**
 * Wire the spellcheck switch and the panel's knock. Call once the app is ready, before any window.
 * impure — sessions, ipc, the switch file.
 */
const registerConnections = ({ app, ipcMain, session, env = process.env, log = console }) => {
  const dataRoot = connections.dataRootFor({ env, isPackaged: app.isPackaged, home: app.getPath('home'), repoRoot: path.join(__dirname, '..') });
  const spellcheckOn = () => connections.isOn('spellcheck', { env, dataRoot });
  // each session → the languages Chromium gave it, read before the switch clears them
  const sessions = new Map();
  const setOne = (each, on) => {
    try {
      each.setSpellCheckerEnabled(on);
      each.setSpellCheckerLanguages(on ? sessions.get(each) : []);
    } catch (error) {
      log.warn(`[neuma] the spellcheck switch could not be applied: ${error.message}`);
    }
  };
  const adopt = (each) => {
    sessions.set(each, each.getSpellCheckerLanguages());
    setOne(each, spellcheckOn());
  };
  const apply = () => {
    const on = spellcheckOn();
    for (const each of sessions.keys()) setOne(each, on);
    return on;
  };
  adopt(session.defaultSession);
  app.on('session-created', adopt);
  ipcMain.handle('connections:changed', () => ({ ok: true, spellcheck: apply() }));
};

module.exports = { registerConnections };
