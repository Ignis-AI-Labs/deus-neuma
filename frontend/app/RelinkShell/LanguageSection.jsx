// LanguageSection — the operator's language choice, inside Settings ›
// GENERAL beside ACCOUNT (the two things the desk knows about its human:
// what to call them, and what language to say it in).
//
// One button per shipped language, named by its ENDONYM — a reader never
// decodes a foreign word for their own tongue. The choice applies the
// moment it is made (i18next re-renders every subscribed surface) and
// persists wallet-scoped for the next boot. A PREVIEW language (its catalog
// only partly translated) says so on its own button.

import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES } from '../../i18n/languages.js';
import { setUiLanguage } from '../../i18n/index.js';
import { uiSound } from '../../services/ui-sound.js';

export const LanguageSection = () => {
  const { t, i18n } = useTranslation('settings');

  return (
    <section className="settings-sec">
      <div className="label-data settings-h">{t('language.heading')}</div>
      <p className="settings-note">{t('language.note')}</p>
      <div className="settings-row">
        {SUPPORTED_LANGUAGES.map((lang) => {
          const active = i18n.language === lang.code;
          return (
            <button
              key={lang.code}
              type="button"
              className={`settings-desk-toggle${active ? ' on' : ''}`}
              aria-pressed={active}
              onClick={() => { uiSound('toggle'); setUiLanguage(lang.code); }}
            >
              {lang.endonym}
              {lang.preview ? ` · ${t('language.preview')}` : null}
            </button>
          );
        })}
      </div>
    </section>
  );
};
