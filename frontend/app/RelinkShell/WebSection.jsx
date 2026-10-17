// WebSection — the operator's web-egress switch inside Settings.
//
// One switch, machine-wide: internet research starts available on a fresh
// install; while ON, beings may call web_search / web_fetch from inside their
// streams (each call still asks first, per the ACTS gate). OFF is the explicit
// air-gap posture. The panel reports the effective state and every index a
// search will query today.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uiSound } from '../../services/ui-sound.js';
import { getWebAccess, setWebAccess } from '../../services/web-client.js';

const BACKEND_LABEL = Object.freeze({
  exa: 'Exa Instant',
  searxng: 'SearXNG (local)',
  brave: 'Brave Search API',
  duckduckgo: 'DuckDuckGo (fallback)',
});

const searchBackendLabel = (value) => String(value || '')
  .split('+')
  .filter(Boolean)
  .map((backend) => BACKEND_LABEL[backend] || backend)
  .join(' + ');

const PAGE_READER_LABEL = Object.freeze({
  direct: 'Direct guarded fetch',
  'direct+kitesurf': 'Direct guarded fetch + Kitesurf JS fallback',
});

export const WebSection = () => {
  const { t } = useTranslation('settingsApi');
  const [state, setState] = useState(null); // { enabled, envLocked, searchBackend, pageReader }
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [flipError, setFlipError] = useState(null);

  useEffect(() => {
    getWebAccess()
      .then((s) => { setState(s); setLoadError(null); })
      .catch((e) => setLoadError(e.message));
  }, []);

  const flip = async () => {
    if (!state || busy) return;
    uiSound('toggle');
    setBusy(true);
    setFlipError(null);
    try {
      setState(await setWebAccess(!state.enabled));
    } catch (e) {
      setFlipError(e.message);
    }
    setBusy(false);
  };

  return (
    <section className="settings-sec">
      <div className="label-data settings-h">{t('web.heading')}</div>
      <p className="settings-note">{t('web.note')}</p>

      {loadError ? <p className="settings-err">{loadError}</p> : null}

      {state ? (
        <div className="settings-realm">
          <div className="settings-row">
            <span className="settings-k">{t('web.egressKey')}</span>
            <span className="settings-v">
              {state.enabled ? t('web.egressOn') : t('web.egressOff')}
              {state.envLocked ? (
                <span className="settings-sec-tags">
                  <span className="settings-tag-warn">{t('web.lockedByOperator')}</span>
                </span>
              ) : null}
            </span>
          </div>
          <div className="settings-row">
            <span className="settings-k">{t('web.searchKey')}</span>
            <span className="settings-v">{searchBackendLabel(state.searchBackend)}</span>
          </div>
          <div className="settings-row">
            <span className="settings-k">{t('web.pageReaderKey')}</span>
            <span className="settings-v">{PAGE_READER_LABEL[state.pageReader] || state.pageReader}</span>
          </div>
        </div>
      ) : (
        !loadError && <p className="settings-note">{t('web.reading')}</p>
      )}

      <div className="settings-control">
        <button
          type="button"
          className="settings-set"
          onClick={flip}
          disabled={!state || busy}
        >
          {busy ? t('web.switching') : state?.enabled ? t('web.switchOff') : t('web.switchOn')}
        </button>
      </div>
      {flipError ? <p className="settings-err">{flipError}</p> : null}
      {state?.envLocked ? (
        <p className="settings-warn">
          {t('web.envLockedNote', { env: 'NEUMA_WEB_ACCESS=0' })}
        </p>
      ) : null}
    </section>
  );
};
