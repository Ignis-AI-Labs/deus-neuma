// active-locale.js — the desk's live UI language as a leaf read.
//
// i18next owns the truth; this leaf mirrors it so PURE-adjacent utilities
// (utils/format.js, RelinkShell/context-gauge.js) can follow the language
// switch without importing the engine — pulling i18n/index.js into a
// formatter would drag React, i18next, the DOM writes, and the font CSS
// into every consumer and every node-side test of that consumer.
// index.js writes here on boot and on every language change.

import { DEFAULT_LANGUAGE } from './languages.js';

let active = DEFAULT_LANGUAGE;

/** @returns {string} the active UI language tag ('en' until the engine boots) */
export const currentLocale = () => active;

/**
 * @param {string} code the language the engine just switched to
 */
export const setActiveLocale = (code) => { active = code || DEFAULT_LANGUAGE; };
