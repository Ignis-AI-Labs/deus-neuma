// ServiceKeysSection — keys for the registry's keyed SERVICES, the outside
// APIs that are not models (Tavily web search, read by the benchmarks' own
// search relay), under SETTINGS → API.
//
// Same encrypted provider-credential store as Settings → Models, same masked
// contract: a stored key is never shown back, only THAT it is stored. A
// service is never a model, a route or a connection, so there is nothing to
// test or connect here: only set, replace and remove.
//
// A service that takes two values (Tomba: its API key and its secret) is ONE
// row with a field for each, one under the other (Design note, 2026-11-18: […]).

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uiSound } from '../../services/ui-sound.js';
import { setServiceKey, removeServiceKey } from '../../services/routing.js';
import { InlineActionConfirm } from './InlineActionConfirm.jsx';
import { KeyLink } from './KeyLink.jsx';
import { CredentialRow } from './CredentialMap.jsx';
import { passesState, serviceItem, withParts } from './credential-view.js';

// What a value looks like, said in the empty field.
const PLACEHOLDER = Object.freeze({ url: 'https://… (the full address, key included)', id: 'account id' });

// pure — where the value in use comes from. Saved here wins over the env file.
const sourceLine = (service) => {
  if (service.source === 'stored') return `Saved here, encrypted on this computer${service.keyEnv ? ` — used instead of ${service.keyEnv} in the env file` : ''}.`;
  if (service.source === 'env') return `In use from the env file (${service.keyEnv}). A value saved here takes over.`;
  return service.keyEnv ? `Not set. Save it here, or set ${service.keyEnv} in the env file.` : null;
};

// pure — the service's short name, without what it is for: "Tomba".
const shortName = (name) => String(name ?? '').replace(/\s*\(.*$/, '');

/** One value of a service: its field, SAVE, and REMOVE once saved. `labelled` names it when the row holds two. */
const KeyField = ({ service, rowName, labelled, onChanged }) => {
  const { t } = useTranslation('settingsApi');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);

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

  const label = labelled ? String(service.label ?? service.name) : null;
  return (
    <>
      {label ? <div className="label-data">{label.toUpperCase()}</div> : null}
      {sourceLine(service) ? <p className="settings-note">{sourceLine(service)}</p> : null}
      <div className="settings-control">
        <input
          className="settings-input"
          type={service.format === 'id' ? 'text' : 'password'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={service.source === 'stored' ? t('serviceKeys.keyStoredPlaceholder') : (label ?? PLACEHOLDER[service.format] ?? t('serviceKeys.keyPlaceholder'))}
          spellCheck={false}
          autoComplete="off"
          aria-label={label ? `${shortName(rowName)} ${label}` : t('serviceKeys.keyAria', { name: service.name })}
          data-service-input={service.id}
          disabled={busy}
        />
        <button type="button" className="settings-set" disabled={busy || !draft.trim()}
          onClick={() => act(() => setServiceKey(service.id, draft.trim()))}>
          {t('serviceKeys.save')}
        </button>
      </div>
      {service.source === 'stored' ? (
        <div className="settings-control">
          {confirming ? (
            <InlineActionConfirm label={t('serviceKeys.removeConfirmAria')} confirmLabel={t('serviceKeys.remove')}
              busy={busy} onConfirm={() => act(() => removeServiceKey(service.id))}
              onCancel={() => { uiSound('close'); setConfirming(false); }}>
              {t('serviceKeys.removeConfirm', { name: label ? `${shortName(rowName)} ${label}` : service.name })}
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
    </>
  );
};

const ServiceKeyCard = ({ service, item, open, onToggle, onChanged }) => {
  const parts = service.parts ?? [];
  return (
    <CredentialRow item={item} open={open} onToggle={onToggle}>
      {service.endpoint ? <p className="settings-note"><code>{service.endpoint}</code></p> : null}
      <KeyLink family="service" id={service.id} />
      <KeyField service={service} rowName={service.name} labelled={parts.length > 0} onChanged={onChanged} />
      {parts.map((part) => <KeyField key={part.id} service={part} rowName={service.name} labelled onChanged={onChanged} />)}
    </CredentialRow>
  );
};

// pure — services under their headings, in catalog order.
const groupsOf = (services) => {
  const groups = new Map();
  for (const s of services || []) {
    const g = s.group || 'Services';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(s);
  }
  return [...groups.entries()];
};

/**
 * The keyed services, one row each under what they unlock, from the board the
 * API tab read once (use-api-credentials.js). Under a state filter only
 * matching rows stand, and a section with none steps aside.
 */
export const ServiceKeysSection = ({ services, error, onChanged, stateFilter, openKey, onOpen }) => {
  const { t } = useTranslation('settingsApi');
  const shown = withParts(services).filter((s) => passesState(serviceItem(s), stateFilter));
  if (stateFilter && shown.length === 0) return null;

  return (
    <section className="settings-sec">
      <div className="label-data settings-h">{t('serviceKeys.heading')}</div>
      <p className="settings-note">{t('serviceKeys.note')}</p>

      {error ? <p className="settings-err">{error}</p> : null}
      {!services && !error ? <p className="settings-note">{t('serviceKeys.reading')}</p> : null}

      {groupsOf(shown).map(([group, rows]) => (
        <div key={group}>
          <div className="label-data settings-h">{group.toUpperCase()}</div>
          {rows.map((service) => {
            const item = serviceItem(service);
            return (
              <ServiceKeyCard key={service.id} service={service} item={item} open={openKey === item.key}
                onToggle={() => onOpen(openKey === item.key ? null : item.key)} onChanged={onChanged} />
            );
          })}
        </div>
      ))}
    </section>
  );
};
