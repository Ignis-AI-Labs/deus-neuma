// languages.js — the registry of languages the desk speaks.
//
// One row per supported language: the BCP-47 code i18next switches on, the
// ENDONYM (the language's own name for itself — a picker never makes a
// reader decode a foreign word for their own tongue), and the font set the
// script needs. Wave 1 (Design note, 2026-09-24: English + CJK — the priority
// markets, and the scripts that prove the font pipeline. Later waves (th,
// es, pt, de, ru…) are rows here plus catalog files; nothing else changes.
//
// Pure.

export const DEFAULT_LANGUAGE = 'en';

export const SUPPORTED_LANGUAGES = Object.freeze([
  Object.freeze({ code: 'en', endonym: 'English', fonts: 'latin' }),
  Object.freeze({ code: 'zh', endonym: '中文', fonts: 'noto-sc' }),
  Object.freeze({ code: 'ja', endonym: '日本語', fonts: 'noto-jp' }),
  Object.freeze({ code: 'ko', endonym: '한국어', fonts: 'noto-kr' }),
]);

/**
 * @param {unknown} code
 * @returns {boolean} true when the code names a shipped language
 */
export const isSupportedLanguage = (code) =>
  SUPPORTED_LANGUAGES.some((lang) => lang.code === code);

/**
 * Map an arbitrary BCP-47 tag ('zh-CN', 'ja-JP', 'en-US') onto a shipped
 * language — the shipped catalogs are script-level, so the region falls away.
 * @param {unknown} tag
 * @returns {string|null} a supported code, or null when nothing matches
 */
export const matchLanguageTag = (tag) => {
  if (typeof tag !== 'string' || tag === '') return null;
  const base = tag.toLowerCase().split('-')[0];
  return isSupportedLanguage(base) ? base : null;
};
