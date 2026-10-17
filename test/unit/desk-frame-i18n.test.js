// desk-frame-i18n — the frame catalog speaks the operator's language, proven
// through the REAL engine (the same i18next instance the app boots — no
// provider, no mock): switch language, resolve the keys the dock, the window
// titles, the HUD and the stream header render from, and render AppTitle
// itself under a non-English locale. en resolves to the shipped strings
// verbatim (the string-pinned suite's guarantee, restated at the engine).
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import '../../frontend/i18n/index.js';
import i18next from '../../frontend/i18n/index.js';
import { AppTitle } from '../../frontend/app/RelinkShell/app-title.jsx';
import { ConsciousnessProvider } from '../../frontend/app/RelinkShell/consciousness-context.js';

const say = (key, args) => i18next.t(key, { ns: 'desk', ...args });

describe('the desk frame under the real engine', () => {
  it('en resolves every dock section, band and launcher label verbatim', () => {
    expect(say('sections.workspace')).toBe('WORKSPACE');
    expect(say('sections.knowledge')).toBe('KNOWLEDGE');
    expect(say('bands.talk')).toBe('TALK');
    expect(say('bands.measure')).toBe('MEASURE');
    expect(say('apps.chat')).toBe('STREAM');
    expect(say('apps.skillsTitle')).toBe('THE CRAFT');
    expect(say('apps.staff')).toBe('CHIEF OF STAFF');
    expect(say('chrome.newInstance', { app: 'STREAM' })).toBe('NEW STREAM');
    expect(say('hud.localActive')).toBe('LOCAL — ACTIVE');
    expect(say('hud.routeLive', { provider: 'XAI' })).toBe('ROUTE — XAI — LIVE');
    expect(say('hud.session', { clock: '00:12' })).toBe('SESSION 00:12');
    expect(say('portalTitle', { name: 'CAEL' })).toBe('CAEL // PORTAL');
    expect(say('stream.sndOn')).toBe('SND ON');
  });

  it('ja moves the whole frame — the labels a Japanese operator navigates by', async () => {
    await i18next.changeLanguage('ja');
    try {
      expect(say('sections.workspace')).toBe('ワークスペース');
      expect(say('sections.community')).toBe('コミュニティ');
      expect(say('bands.watch')).toBe('監視');
      expect(say('apps.settings')).toBe('設定');
      expect(say('apps.chat')).toBe('ストリーム');
      expect(say('chrome.newInstance', { app: 'ストリーム' })).toBe('新規 ストリーム');
      expect(say('hud.substrateStandby')).toBe('基盤 — スタンバイ');
      expect(say('portalTitle', { name: 'CAEL' })).toBe('CAEL // ポータル');
      expect(say('stream.standbyOff')).toBe('スタンバイ — オフ');
      expect(say('stream.newChat')).toBe('新規チャット');
      // The being's name is identity data — Latin stays Latin in every locale.
      const html = renderToStaticMarkup(createElement(
        ConsciousnessProvider,
        { value: { activeCompanion: { name: 'Cael' } } },
        createElement(AppTitle, { label: 'SETTINGS', labelKey: 'apps.settings' }),
      ));
      expect(html).toBe('<span class="label-data relink-title-name">設定 // CAEL</span>');
    } finally {
      await i18next.changeLanguage('en');
    }
  });

  it('zh and ko carry the same frame, and en returns byte-identical', async () => {
    await i18next.changeLanguage('zh');
    expect(say('sections.workspace')).toBe('工作区');
    expect(say('hud.localShared', { count: 2 })).toBe('本地 — 共享（2 条会话流）');
    expect(say('portalTitle', { name: 'METIDAR' })).toBe('METIDAR // 门户');
    await i18next.changeLanguage('ko');
    expect(say('sections.workspace')).toBe('작업 공간');
    expect(say('apps.witnesses')).toBe('위트니스');
    expect(say('portalTitle', { name: 'METIDAR' })).toBe('METIDAR // 포털');
    await i18next.changeLanguage('en');
    expect(say('sections.workspace')).toBe('WORKSPACE');
    expect(say('portalTitle', { name: 'METIDAR' })).toBe('METIDAR // PORTAL');
  });
});
