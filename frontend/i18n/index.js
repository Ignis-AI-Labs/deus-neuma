// i18n/index.js — the desk's language engine, initialized once at boot.
//
// i18next + react-i18next (operator's choice, 2026-09-24; Rule 4: plural
// grammar, fallback chains, and React-idiomatic re-render on switch are not
// a clean ~20-line write). No detector/backend plugins: preference
// resolution is ours (language-preference.js) and catalogs ship in the
// bundle, so the desk localizes fully OFFLINE — an Electron app must never
// need a network to speak its operator's language.
//
// The CJK font sets ride this import too: fontsource ships Noto Sans SC/JP/
// KR as unicode-range-split woff2 inside node_modules, so Vite hashes them
// into the build and a script only pulls its own subsets. Inter/JetBrains
// Mono ship the same way (styles/main.css): the desk's type works with the
// network cable pulled.
//
// impure — module-side i18next init, document lang attribute, localStorage.

import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import '@fontsource/noto-sans-sc/400.css';
import '@fontsource/noto-sans-sc/700.css';
import '@fontsource/noto-sans-jp/400.css';
import '@fontsource/noto-sans-jp/700.css';
import '@fontsource/noto-sans-kr/400.css';
import '@fontsource/noto-sans-kr/700.css';
import { DEFAULT_LANGUAGE, isSupportedLanguage } from './languages.js';
import { setActiveLocale } from './active-locale.js';
import {
  loadLanguagePreference, resolveInitialLanguage, saveLanguagePreference,
} from './language-preference.js';
import commonEn from './locales/en/common.js';
import deskEn from './locales/en/desk.js';
import settingsEn from './locales/en/settings.js';
import settingsLookEn from './locales/en/settingsLook.js';
import settingsMemoryEn from './locales/en/settingsMemory.js';
import settingsModelsEn from './locales/en/settingsModels.js';
import settingsApiEn from './locales/en/settingsApi.js';
import settingsSecurityEn from './locales/en/settingsSecurity.js';
import voiceForgeEn from './locales/en/voiceForge.js';
import taskbarEn from './locales/en/taskbar.js';
import commonZh from './locales/zh/common.js';
import deskZh from './locales/zh/desk.js';
import settingsZh from './locales/zh/settings.js';
import settingsLookZh from './locales/zh/settingsLook.js';
import settingsMemoryZh from './locales/zh/settingsMemory.js';
import settingsModelsZh from './locales/zh/settingsModels.js';
import settingsApiZh from './locales/zh/settingsApi.js';
import settingsSecurityZh from './locales/zh/settingsSecurity.js';
import voiceForgeZh from './locales/zh/voiceForge.js';
import taskbarZh from './locales/zh/taskbar.js';
import commonJa from './locales/ja/common.js';
import deskJa from './locales/ja/desk.js';
import settingsJa from './locales/ja/settings.js';
import settingsLookJa from './locales/ja/settingsLook.js';
import settingsMemoryJa from './locales/ja/settingsMemory.js';
import settingsModelsJa from './locales/ja/settingsModels.js';
import settingsApiJa from './locales/ja/settingsApi.js';
import settingsSecurityJa from './locales/ja/settingsSecurity.js';
import voiceForgeJa from './locales/ja/voiceForge.js';
import taskbarJa from './locales/ja/taskbar.js';
import commonKo from './locales/ko/common.js';
import deskKo from './locales/ko/desk.js';
import settingsKo from './locales/ko/settings.js';
import settingsLookKo from './locales/ko/settingsLook.js';
import settingsMemoryKo from './locales/ko/settingsMemory.js';
import settingsModelsKo from './locales/ko/settingsModels.js';
import settingsApiKo from './locales/ko/settingsApi.js';
import settingsSecurityKo from './locales/ko/settingsSecurity.js';
import voiceForgeKo from './locales/ko/voiceForge.js';
import taskbarKo from './locales/ko/taskbar.js';

i18next.use(initReactI18next).init({
  lng: resolveInitialLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  ns: ['common', 'desk', 'settings', 'settingsLook', 'settingsMemory', 'settingsModels', 'settingsApi', 'settingsSecurity', 'voiceForge', 'taskbar'],
  defaultNS: 'common',
  resources: {
    en: { common: commonEn, desk: deskEn, settings: settingsEn, settingsLook: settingsLookEn, settingsMemory: settingsMemoryEn, settingsModels: settingsModelsEn, settingsApi: settingsApiEn, settingsSecurity: settingsSecurityEn, voiceForge: voiceForgeEn, taskbar: taskbarEn },
    zh: { common: commonZh, desk: deskZh, settings: settingsZh, settingsLook: settingsLookZh, settingsMemory: settingsMemoryZh, settingsModels: settingsModelsZh, settingsApi: settingsApiZh, settingsSecurity: settingsSecurityZh, voiceForge: voiceForgeZh, taskbar: taskbarZh },
    ja: { common: commonJa, desk: deskJa, settings: settingsJa, settingsLook: settingsLookJa, settingsMemory: settingsMemoryJa, settingsModels: settingsModelsJa, settingsApi: settingsApiJa, settingsSecurity: settingsSecurityJa, voiceForge: voiceForgeJa, taskbar: taskbarJa },
    ko: { common: commonKo, desk: deskKo, settings: settingsKo, settingsLook: settingsLookKo, settingsMemory: settingsMemoryKo, settingsModels: settingsModelsKo, settingsApi: settingsApiKo, settingsSecurity: settingsSecurityKo, voiceForge: voiceForgeKo, taskbar: taskbarKo },
  },
  interpolation: { escapeValue: false }, // React already escapes
  returnEmptyString: false,
});

setActiveLocale(i18next.language);
if (typeof document !== 'undefined') document.documentElement.lang = i18next.language;

// The Intl formatters and any non-React reader follow the engine through
// the leaf (active-locale.js) — they never import this module.
const applyLanguage = (code) => {
  setActiveLocale(code);
  if (typeof document !== 'undefined') document.documentElement.lang = code;
};

/**
 * Switch the desk's language: persist the operator's choice, move i18next
 * (subscribed components re-render), keep <html lang> honest, and tell the
 * non-React listeners (sibling desk windows hear the same switch over the
 * storage event).
 * @param {string} code a shipped language code
 * @returns {Promise<void>}
 */
export const setUiLanguage = async (code) => {
  if (!isSupportedLanguage(code) || code === i18next.language) return;
  saveLanguagePreference(code);
  await i18next.changeLanguage(code);
  applyLanguage(code);
};

// A sibling desk window (or another tab) moving the preference moves this
// one too — one operator, one language, every window.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === null || event.newValue === null) return;
    const saved = loadLanguagePreference();
    if (saved && saved !== i18next.language) {
      i18next.changeLanguage(saved).then(() => applyLanguage(saved));
    }
  });
}

export default i18next;
