// spellcheck-main.cjs — spelling marks with no dictionary fetched from anywhere.
//
// Chromium's spellchecker downloads a language's Hunspell dictionary from Google the first time a
// page needs it, unless the file already sits in <userData>/Dictionaries. The app ships the English
// dictionaries (electron/dictionaries/, Electron's own pack for this Electron version) and copies
// them there BEFORE the app is ready. Proven against Electron 44 on fresh profiles: placed before
// ready, the dictionary initializes with no download event; placed after ready, Chromium has already
// begun the download.
//
// Every session's download address is pinned to the bundled folder, which Chromium cannot fetch
// from: a language with no bundled dictionary fails on this machine and goes unchecked, and nothing
// is ever asked of Google. macOS uses its own spellchecker and needs none of this.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const BUNDLED_DIR = path.join(__dirname, 'dictionaries');
const FLOOR_LANGUAGE = 'en-US';

/** pure — 'en-US-10-1.bdic' → 'en-US' */
const languageOf = (file) => file.replace(/-\d+-\d+\.bdic$/, '');

/**
 * pure — the languages to check: those the session asked for that the app ships, else English.
 * @param {string[]} asked - the session's own languages (from the OS locale)
 * @param {string[]} shipped - languages with a bundled dictionary
 * @returns {string[]}
 */
const languagesFor = (asked, shipped) => {
  const kept = asked.filter((lang) => shipped.includes(lang));
  return kept.length > 0 ? kept : [FLOOR_LANGUAGE];
};

/**
 * Copy the bundled dictionaries into the profile where Chromium looks. Call after userData is final
 * and before the app is ready. A file already there at the same size is left alone.
 * impure — reads the bundle, writes the profile.
 * @returns {string[]} the languages now available offline
 */
const placeDictionaries = ({ app, bundledDir = BUNDLED_DIR, log = console }) => {
  const target = path.join(app.getPath('userData'), 'Dictionaries');
  let files = [];
  try {
    // A build without the bundle starts with spellcheck off, never with a failed launch.
    files = fs.readdirSync(bundledDir).filter((file) => file.endsWith('.bdic'));
    fs.mkdirSync(target, { recursive: true });
    for (const file of files) {
      const from = path.join(bundledDir, file);
      const to = path.join(target, file);
      if (!fs.existsSync(to) || fs.statSync(to).size !== fs.statSync(from).size) fs.copyFileSync(from, to);
    }
  } catch (error) {
    log.warn(`[neuma] the spellcheck dictionaries could not be placed: ${error.message}`);
    return [];
  }
  return files.map(languageOf);
};

/**
 * Point every session, now and later, at the shipped languages and the bundled folder.
 * impure — sessions.
 */
const registerSpellcheck = ({ app, session, shipped, bundledDir = BUNDLED_DIR, log = console }) => {
  const downloadUrl = `${pathToFileURL(bundledDir).href}/`;
  const adopt = (each) => {
    try {
      each.setSpellCheckerDictionaryDownloadURL(downloadUrl);
      each.setSpellCheckerLanguages(shipped.length > 0 ? languagesFor(each.getSpellCheckerLanguages(), shipped) : []);
    } catch (error) {
      log.warn(`[neuma] spellcheck could not be set on a session: ${error.message}`);
    }
  };
  adopt(session.defaultSession);
  app.on('session-created', adopt);
};

module.exports = { placeDictionaries, registerSpellcheck, languagesFor };
