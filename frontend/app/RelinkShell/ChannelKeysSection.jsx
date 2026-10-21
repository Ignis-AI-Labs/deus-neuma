// ChannelKeysSection — the API keys for every platform the house speaks
// through, gathered under SETTINGS → API (Founder's law, 2026-07-23: keys are
// linked in Settings, not scattered through the operational boards).
//
// Keys are sealed on this machine and never echoed back — a set field shows
// only THAT it is set and where it came from (store or env). WHO may post is
// a different decision entirely: the single-holder binding lives in each
// platform's own OUTREACH window, because keys alone never let a being speak.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uiSound } from '../../services/ui-sound.js';
import { setChannelCredentials, clearChannelCredentials } from '../../services/social-channels-client.js';
import { KeyLink } from './KeyLink.jsx';
import { CredentialRow } from './CredentialMap.jsx';
import { channelItem, passesState } from './credential-view.js';

// THE FLIGHT LINE (ruling, 2026-07-28): a key being SET is a claim; the flight
// test is the proof — the platform accepted it, answered, named the account.
// PROVEN with the account, FAILING with the honest reason, unconfigured
// said as nothing-to-prove (never an error).
const FlightLine = ({ test }) => {
  const { t } = useTranslation('settingsApi');
  if (!test) return <span className="settings-v flight-line is-idle">{t('channelKeys.flight.untested')}</span>;
  if (test.ok === true) {
    // A passing flight may still carry a warning — LinkedIn's mortal token
    // rides its expiry note here; channels with nothing to say render exactly
    // as before (no detail, no suffix).
    const account = test.account?.name ? `@${test.account.name}` : t('channelKeys.flight.proven');
    return (
      <span className="settings-v flight-line is-live" title={test.detail}>
        {test.detail
          ? t('channelKeys.flight.liveDetail', { account, detail: test.detail })
          : t('channelKeys.flight.live', { account })}
      </span>
    );
  }
  if (test.ok === false) {
    return (
      <span className="settings-v flight-line is-down" title={test.detail}>
        {t('channelKeys.flight.down', { detail: test.detail })}
      </span>
    );
  }
  return <span className="settings-v flight-line is-idle">{t('channelKeys.flight.unconfigured')}</span>;
};

const ChannelKeysCard = ({ channel, test, item, open, onToggle, onRetest, onChanged }) => {
  const { t } = useTranslation('settingsApi');
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const act = async (fn) => {
    uiSound('toggle');
    setBusy(true);
    setError(null);
    try {
      await fn();
      setDraft({});
      await onChanged();
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  const dirtyFields = Object.entries(draft).filter(([, v]) => v !== '');

  return (
    <CredentialRow item={item} open={open} onToggle={onToggle}>
      <KeyLink family="channel" id={channel.id} lead="GET THE KEYS" />
      <div className="settings-row">
        <span className="settings-k">{t('channelKeys.card.flightTest')}</span>
        <FlightLine test={test} />
      </div>
      {channel.fields.map((f) => (
        <div className="settings-control" key={f.key}>
          <input
            className="settings-input"
            type={f.secret ? 'password' : 'text'}
            placeholder={f.set ? t('channelKeys.card.fieldSetPlaceholder', { label: f.label, source: f.source }) : f.label}
            value={draft[f.key] ?? ''}
            onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
            disabled={busy}
          />
        </div>
      ))}
      <div className="settings-control">
        <button
          type="button"
          className="settings-set"
          disabled={busy || dirtyFields.length === 0}
          onClick={() => act(() => setChannelCredentials(channel.id, Object.fromEntries(dirtyFields)))}
        >
          {t('channelKeys.card.save')}
        </button>
        <button type="button" className="settings-set" disabled={!channel.configured}
          title={channel.configured ? t('channelKeys.card.retestTitle') : t('channelKeys.card.retestTitleIdle')}
          onClick={onRetest}>
          {t('channelKeys.card.retest')}
        </button>
        <button
          type="button"
          className="settings-set is-danger"
          disabled={busy}
          onClick={() => act(() => clearChannelCredentials(channel.id))}
        >
          {t('channelKeys.card.forget')}
        </button>
      </div>
      {error ? <p className="settings-err">{error}</p> : null}
    </CredentialRow>
  );
};

/**
 * The platform keys, one row each, from the boards the API tab read once
 * (use-api-credentials.js). Under a state filter only matching rows stand,
 * and a section with none steps aside.
 */
export const ChannelKeysSection = ({ channels, tests, error, onChanged, onRetest, stateFilter, openKey, onOpen }) => {
  const { t } = useTranslation('settingsApi');
  const rows = (channels ?? []).map((channel) => ({ channel, item: channelItem(channel, tests?.[channel.id]) }))
    .filter(({ item }) => passesState(item, stateFilter));
  if (stateFilter && rows.length === 0) return null;

  return (
    <section className="settings-sec">
      <div className="label-data settings-h">{t('channelKeys.heading')}</div>
      <p className="settings-note">{t('channelKeys.note')}</p>

      {error ? <p className="settings-err">{error}</p> : null}
      {!channels && !error ? <p className="settings-note">{t('channelKeys.reading')}</p> : null}

      {rows.map(({ channel, item }) => (
        <ChannelKeysCard key={channel.id} channel={channel} test={tests?.[channel.id] || null} item={item}
          open={openKey === item.key} onToggle={() => onOpen(openKey === item.key ? null : item.key)}
          onRetest={() => onRetest({ fresh: true })} onChanged={onChanged} />
      ))}
    </section>
  );
};
