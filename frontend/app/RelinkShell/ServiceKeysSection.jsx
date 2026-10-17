// ServiceKeysSection — keys for the registry's keyed SERVICES, the outside
// APIs that are not models (Tavily web search, read by the benchmarks' own
// search relay), under SETTINGS → API.
//
// Same encrypted provider-credential store as Settings → Models, same masked
// contract: a stored key is never shown back, only THAT it is stored. A
// service is never a model, a route or a connection, so there is nothing to
// test or connect here: only set, replace and remove.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uiSound } from '../../services/ui-sound.js';
import { listServices, setServiceKey, removeServiceKey } from '../../services/routing.js';
import { providerState } from './model-route-view.js';
import { InlineActionConfirm } from './InlineActionConfirm.jsx';

const ServiceKeyCard = ({ service, onChanged }) => {
  const { t } = useTranslation('settingsApi');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);
  const state = providerState(service);

  // impure — one store write, then the masked state is re-read from the server.
  const act = async (fn) => {
    uiSound('activate');
    setBusy(true);
    setError(null);
    try {
      await fn();
      setDraft('');
      setConfirming(false);
      await onChanged();
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  return (
    <div className="settings-realm">
      <div className="settings-row">
        <span className="settings-k">{service.name}</span>
        <span className="settings-v">
          <code>{service.endpoint}</code>
          <span className="settings-sec-tags"><span className={state.cls}>{state.tag}</span></span>
        </span>
      </div>
      <div className="settings-control">
        <input
          className="settings-input"
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={service.hasKey ? t('serviceKeys.keyStoredPlaceholder') : t('serviceKeys.keyPlaceholder')}
          spellCheck={false}
          autoComplete="off"
          aria-label={t('serviceKeys.keyAria', { name: service.name })}
          disabled={busy}
        />
        <button type="button" className="settings-set" disabled={busy || !draft.trim()}
          onClick={() => act(() => setServiceKey(service.id, draft.trim()))}>
          {t('serviceKeys.save')}
        </button>
      </div>
      {service.hasKey ? (
        <div className="settings-control">
          {confirming ? (
            <InlineActionConfirm label={t('serviceKeys.removeConfirmAria')} confirmLabel={t('serviceKeys.remove')}
              busy={busy} onConfirm={() => act(() => removeServiceKey(service.id))}
              onCancel={() => { uiSound('close'); setConfirming(false); }}>
              {t('serviceKeys.removeConfirm', { name: service.name })}
            </InlineActionConfirm>
          ) : (
            <button type="button" className="settings-set is-danger" disabled={busy}
              onClick={() => { uiSound('open'); setError(null); setConfirming(true); }}>
              {t('serviceKeys.remove')}
            </button>
          )}
        </div>
      ) : null}
      {error ? <p className="settings-err">{error}</p> : null}
    </div>
  );
};

export const ServiceKeysSection = () => {
  const { t } = useTranslation('settingsApi');
  const [services, setServices] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const refresh = () =>
    listServices()
      .then((r) => { setServices(r.services); setLoadError(null); })
      .catch((e) => setLoadError(e.message));

  useEffect(() => { refresh(); }, []);

  return (
    <section className="settings-sec">
      <div className="label-data settings-h">{t('serviceKeys.heading')}</div>
      <p className="settings-note">{t('serviceKeys.note')}</p>

      {loadError ? <p className="settings-err">{loadError}</p> : null}
      {!services && !loadError ? <p className="settings-note">{t('serviceKeys.reading')}</p> : null}

      {services?.map((service) => (
        <ServiceKeyCard key={service.id} service={service} onChanged={refresh} />
      ))}
    </section>
  );
};
