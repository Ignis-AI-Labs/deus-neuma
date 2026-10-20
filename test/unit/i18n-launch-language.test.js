// i18n-launch-language — English only at launch (the 2026-10-19 ruling).
//
// zh/ja/ko are partly translated (the chips, composer, model bar and tray
// still speak English), so the desk never picks one on its own: a fresh desk
// on a Chinese, Japanese or Korean OS boots English. The operator may still
// choose a preview language, and the picker labels each one so.
//
// Proven three ways, none faked: the pure boot pick with real inputs; the
// real preference module in a real node child whose OS locale really is
// zh/ja/ko (LANG/LC_ALL feed ICU, which is where navigator.language comes
// from); and the real picker rendered under the real i18next engine.

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, isPreviewLanguage, pickInitialLanguage,
} from '../../frontend/i18n/languages.js';
import i18next from '../../frontend/i18n/index.js';
import { LanguageSection } from '../../frontend/app/RelinkShell/LanguageSection.jsx';

const PREFERENCE = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '../../frontend/i18n/language-preference.js')).href;

// impure — a real node process booting the preference module under an OS locale
const bootUnder = (locale) => JSON.parse(execFileSync(process.execPath, [
  '--input-type=module', '-e',
  `const m = await import(${JSON.stringify(PREFERENCE)});
   console.log(JSON.stringify({ os: navigator.language, boot: m.resolveInitialLanguage() }));`,
], { env: { ...process.env, LANG: locale, LC_ALL: locale }, encoding: 'utf8' }));

describe('the boot pick never lands on a preview language', () => {
  it('only English is complete; zh, ja and ko are previews', () => {
    expect(isPreviewLanguage(DEFAULT_LANGUAGE)).toBe(false);
    expect(SUPPORTED_LANGUAGES.filter((lang) => lang.preview).map((lang) => lang.code)).toEqual(['zh', 'ja', 'ko']);
  });

  it('a fresh desk on a CJK OS boots English', () => {
    for (const osTag of ['zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'ja']) {
      expect(pickInitialLanguage({ osTag })).toBe('en');
    }
    expect(pickInitialLanguage({ osTag: 'en-GB' })).toBe('en');
    expect(pickInitialLanguage({ osTag: 'fr-FR' })).toBe('en');
    expect(pickInitialLanguage({})).toBe('en');
  });

  it("the operator's own saved choice still wins, a preview included", () => {
    expect(pickInitialLanguage({ saved: 'ja', osTag: 'en-US' })).toBe('ja');
    expect(pickInitialLanguage({ saved: 'en', osTag: 'zh-CN' })).toBe('en');
    // a stale saved row never wedges the desk, and never hands it to the OS preview
    expect(pickInitialLanguage({ saved: 'xx', osTag: 'zh-CN' })).toBe('en');
  });

  it('the real preference module boots English under a real zh/ja/ko OS locale', () => {
    for (const [locale, prefix] of [['zh_CN.UTF-8', 'zh'], ['ja_JP.UTF-8', 'ja'], ['ko_KR.UTF-8', 'ko']]) {
      const { os, boot } = bootUnder(locale);
      expect(os.startsWith(prefix), `the child's OS locale really is ${prefix}`).toBe(true);
      expect(boot).toBe('en');
    }
  });
});

describe('the picker labels every preview language', () => {
  it('renders English plain and each preview with its label', () => {
    expect(i18next.language).toBe('en');
    const html = renderToStaticMarkup(createElement(LanguageSection));
    expect(html).toContain('aria-pressed="true">English</button>');
    for (const endonym of ['中文', '日本語', '한국어']) {
      expect(html).toContain(`aria-pressed="false">${endonym} · PREVIEW (INCOMPLETE)</button>`);
    }
  });
});
