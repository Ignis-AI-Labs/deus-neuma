// Real main for the offline spellcheck proof. SPELL_MODE=app runs the app's own spellcheck-main.cjs
// (dictionaries placed before ready, every session pinned); SPELL_MODE=stock is Chromium as it comes,
// the control. SPELL_LANG asks for one language after setup, as an OS locale would. SPELL_BUNDLE
// points the app at another bundle folder (a build without one).
const path = require('path');
const { app, BrowserWindow, session } = require('electron');
const { placeDictionaries, registerSpellcheck } = require('../../electron/spellcheck-main.cjs');

app.setPath('userData', process.env.SPELL_PROFILE);
const bundledDir = process.env.SPELL_BUNDLE || undefined;
const shipped = process.env.SPELL_MODE === 'app' ? placeDictionaries({ app, bundledDir }) : [];
global.spellEvents = [];
global.menu = null;
app.whenReady().then(async () => {
  for (const kind of ['initialized', 'download-begin', 'download-success', 'download-failure']) {
    session.defaultSession.on(`spellcheck-dictionary-${kind}`, (_e, lang) => global.spellEvents.push(`${kind}:${lang}`));
  }
  if (process.env.SPELL_MODE === 'app') registerSpellcheck({ app, session, shipped, bundledDir });
  if (process.env.SPELL_LANG) session.defaultSession.setSpellCheckerLanguages([process.env.SPELL_LANG]);
  const win = new BrowserWindow({ show: false, width: 800, height: 400 });
  win.webContents.on('context-menu', (_e, p) => { global.menu = { word: p.misspelledWord, suggestions: p.dictionarySuggestions }; });
  await win.loadFile(path.join(__dirname, 'offline-spellcheck.html'));
});
