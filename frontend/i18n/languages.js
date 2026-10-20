// languages.js — the registry of languages the desk speaks.
//
// One row per supported language: the BCP-47 code i18next switches on, the
// ENDONYM (the language's own name for itself — a picker never makes a
// reader decode a foreign word for their own tongue), and the font set the
// script needs. Wave 1 (ruling, 2026-09-24): English + CJK — the priority
// markets, and the scripts that prove the font pipeline. Later waves (th,
// es, pt, de, ru…) are rows here plus catalog files; nothing else changes.
//
// PREVIEW rows (the 2026-10-19 launch ruling: English only): the CJK catalogs
// cover the frame and settings, but the chips, composer, model bar and tray
// still speak English. A preview stays pickable and is labelled so; the desk
// never chooses one on its own.
//
// Pure.

export const DEFAULT_LANGUAGE = 'en';

export const SUPPORTED_LANGUAGES = Object.freeze([
  Object.freeze({ code: 'en', endonym: 'English', fonts: 'latin' }),
  Object.freeze({ code: 'zh', endonym: '中文', fonts: 'noto-sc', preview: true }),
  Object.freeze({ code: 'ja', endonym: '日本語', fonts: 'noto-jp', preview: true }),
  Object.freeze({ code: 'ko', endonym: '한국어', fonts: 'noto-kr', preview: true }),
]);

/**
 * @param {unknown} code
 * @returns {boolean} true when the code names a shipped language
 */
export const isSupportedLanguage = (code) =>
  SUPPORTED_LANGUAGES.some((lang) => lang.code === code);

/**
 * @param {unknown} code
 * @returns {boolean} true when the code names a shipped language marked preview
 */
export const isPreviewLanguage = (code) =>
  SUPPORTED_LANGUAGES.some((lang) => lang.code === code && lang.preview === true);

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

/**
 * The language a desk boots in. The operator's own saved choice wins, a
 * preview included (they picked it, labelled). A fresh desk follows the OS
 * locale only onto a complete language; English holds the floor.
 * @param {{saved?: unknown, osTag?: unknown}} sources
 * @returns {string} a supported code
 */
export const pickInitialLanguage = ({ saved = null, osTag = null } = {}) => {
  if (isSupportedLanguage(saved)) return saved;
  const os = matchLanguageTag(osTag);
  return os && !isPreviewLanguage(os) ? os : DEFAULT_LANGUAGE;
};
