// DeskSection — desk behavior preferences, inside Settings › GENERAL.
//
// Holds the guards the desk's own surfaces let the witness wave off — today
// the delete confirmation (Design note, 2026-07-24: […]). The pref lives on the wallet-scoped
// slot-free key (window-storage desk prefs) so the answer is the witness's,
// not one window's; the FILES bar's […] writes the same truth
// this toggle reads, and both hear each other over the desk-prefs event.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { loadDeskPrefs, saveDeskPrefs } from '../windowing/window-storage.js';
import { uiSound } from '../../services/ui-sound.js';

export const DeskSection = () => {
  const { t } = useTranslation(['settings', 'common']);
  const [prefs, setPrefs] = useState(loadDeskPrefs);

  // The FILES bar (this window) and sibling desk windows (storage event)
  // both move the one prefs record — either way, re-read the persisted truth.
  useEffect(() => {
    const refresh = () => setPrefs(loadDeskPrefs());
    window.addEventListener('neuma:desk-prefs', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('neuma:desk-prefs', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const flipConfirmDelete = () => {
    uiSound('toggle');
    saveDeskPrefs({ ...prefs, confirmDelete: !prefs.confirmDelete });
    setPrefs(loadDeskPrefs());
    window.dispatchEvent(new CustomEvent('neuma:desk-prefs'));
  };

  return (
    <section className="settings-sec">
      <div className="label-data settings-h">{t('settings:desk.heading')}</div>
      <p className="settings-note">{t('settings:desk.note')}</p>
      <div className="settings-row">
        <span className="settings-k">{t('settings:desk.deleteKey')}</span>
        <button
          type="button"
          className={`settings-desk-toggle${prefs.confirmDelete ? ' on' : ''}`}
          aria-pressed={prefs.confirmDelete}
          onClick={flipConfirmDelete}
        >
          {t('settings:desk.confirmToggle', { state: prefs.confirmDelete ? t('common:on') : t('common:off') })}
        </button>
      </div>
    </section>
  );
};
