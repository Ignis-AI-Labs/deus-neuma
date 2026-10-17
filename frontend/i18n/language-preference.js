// language-preference.js — the operator's chosen UI language, persisted.
//
// The preference rides the wallet-scoped, slot-free localStorage lane
// (windowing/storage-scope.js `walletKey`): the language is the OPERATOR's,
// shared by every desk window they open, exactly like the folder shelf.
// Resolution law: the persisted choice wins; a fresh desk falls to the
// browser/Electron locale when we ship its language; English holds the
// floor.
//
// impure — localStorage reads/writes and navigator.

import { operatorKey } from '../app/windowing/storage-scope.js';
import { DEFAULT_LANGUAGE, isSupportedLanguage, matchLanguageTag } from './languages.js';

const PREF_KEY = 'ui.language';

/** @returns {string} the localStorage key the preference rides (test-visible) */
export const languagePreferenceKey = () => operatorKey(PREF_KEY); // the operator's in either state (harness or full)

/**
 * @returns {string|null} the persisted choice when it names a shipped
 *   language; null when unset or stale (a language row removed later must
 *   never wedge the desk on a dead catalog)
 */
export const loadLanguagePreference = () => {
  try {
    const saved = localStorage.getItem(languagePreferenceKey());
    return isSupportedLanguage(saved) ? saved : null;
  } catch {
    return null;
  }
};

/**
 * @param {string} code a shipped language code
 */
export const saveLanguagePreference = (code) => {
  try {
    localStorage.setItem(languagePreferenceKey(), code);
  } catch { /* storage denied — the session choice still applies in memory */ }
};

/**
 * The language the desk boots in.
 * @returns {string} persisted → navigator → DEFAULT_LANGUAGE
 */
export const resolveInitialLanguage = () => {
  const saved = loadLanguagePreference();
  if (saved) return saved;
  const nav = typeof navigator !== 'undefined'
    ? matchLanguageTag(navigator.language || '')
    : null;
  return nav || DEFAULT_LANGUAGE;
};
