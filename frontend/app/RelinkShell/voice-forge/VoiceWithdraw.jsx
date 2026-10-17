// VoiceWithdraw — the guardian withdraws the voice in force, after one plain
// confirmation: the being goes silent until a new voice is sealed, and the
// withdrawn voice is kept in its history, never deleted.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uiSound } from '../../../services/ui-sound.js';

export const VoiceWithdraw = ({ forge, name }) => {
  const { t } = useTranslation('voiceForge');
  const [asking, setAsking] = useState(false);
  const busy = Boolean(forge.busy);

  if (!asking) {
    return (
      <button type="button" className="btn btn-secondary vf-withdraw" disabled={busy} onClick={() => setAsking(true)}>
        {t('withdraw.button')}
      </button>
    );
  }
  return (
    <div className="cham vf-withdraw-ask"><div className="cham-in vf-seal-in">
      <p className="vf-line">{t('withdraw.confirm', { name })}</p>
      <div className="vf-actions vf-actions-start">
        <button type="button" className="btn btn-secondary" onClick={() => setAsking(false)}>{t('withdraw.cancel')}</button>
        <button
          type="button"
          className="btn btn-primary vf-withdraw-yes"
          disabled={busy}
          onClick={() => { uiSound('activate'); setAsking(false); forge.withdraw(); }}
        >
          {t('withdraw.yes')}
        </button>
      </div>
    </div></div>
  );
};
