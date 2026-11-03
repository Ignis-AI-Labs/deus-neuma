// VisionSection — the operator's image-input switch inside Settings → API.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uiSound } from '../../services/ui-sound.js';
import { getVision, setVision } from '../../services/vision-client.js';

export const VisionSection = () => {
  const { t } = useTranslation('settingsApi');
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    getVision().then(setState).catch((e) => setError(e.message));
  }, []);

  const flip = async () => {
    if (!state || busy) return;
    uiSound('toggle');
    setBusy(true);
    setError(null);
    try {
      setState(await setVision(!state.enabled));
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  return (
    <section className="settings-sec">
      <div className="label-data settings-h">{t('vision.heading')}</div>
      <p className="settings-note">{t('vision.note')}</p>
      {error ? <p className="settings-err">{error}</p> : null}
      {state ? (
        <div className="settings-realm">
          <div className="settings-row">
            <span className="settings-k">{t('vision.key')}</span>
            <span className="settings-v">
              {state.enabled ? t('vision.on') : t('vision.off')}
              {state.envLocked ? <span className="settings-sec-tags"><span className="settings-tag-warn">{t('vision.lockedByOperator')}</span></span> : null}
            </span>
          </div>
        </div>
      ) : !error && <p className="settings-note">{t('vision.reading')}</p>}
      <div className="settings-control">
        <button type="button" className="settings-set" onClick={flip} disabled={!state || busy}>
          {busy ? t('vision.switching') : state?.enabled ? t('vision.switchOff') : t('vision.switchOn')}
        </button>
      </div>
      {state?.envLocked ? <p className="settings-warn">{t('vision.envLockedNote', { env: 'NEUMA_VISION=0' })}</p> : null}
    </section>
  );
};
