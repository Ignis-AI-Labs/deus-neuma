// EmailSection — the witness's mailbox board inside Settings.
//
// Connect the house email account (credentials sealed server-side; a stored
// secret is never echoed back), then tie the mailbox to the ONE neuma who
// holds that position. An unbound account grants nothing — credentials alone
// never let a being write, and no neuma but the bound holder can ride the
// keys (the portal enforces this again on every call). Every send and every
// inbox read still passes the ACTS approval gate.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from './Select.jsx';
import { uiSound } from '../../services/ui-sound.js';
import {
  setEmailCredentials, clearEmailCredentials,
  bindEmail, releaseEmail,
} from '../../services/email-client.js';
import { getRosterForBinding } from '../../services/social-channels-client.js';
import { KeyLink } from './KeyLink.jsx';
import { CredentialRow } from './CredentialMap.jsx';
import { emailItem, passesState } from './credential-view.js';

const AccountCard = ({ account, roster, item, open, onToggle, onChanged }) => {
  const { t } = useTranslation('settingsApi');
  const [draft, setDraft] = useState({});
  const [holder, setHolder] = useState(account.binding?.neumaId || '');
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
  const holderName = roster.find((m) => m.neumaId === account.binding?.neumaId)?.name
    || account.binding?.neumaId;

  return (
    <CredentialRow item={item} open={open} onToggle={onToggle}>
      <div className="settings-row">
        <span className="settings-k">{t('email.card.holder')}</span>
        <span className="settings-v">
          {account.binding
            ? <span className="settings-tag-dim">{t('email.card.heldBy', { holder: holderName })}</span>
            : <span className="settings-tag-warn">{t('email.card.unbound')}</span>}
        </span>
      </div>
      <KeyLink family="email" id="gmail" lead="APP PASSWORD" />
      <KeyLink family="email" id="other" lead="OTHER PROVIDERS" />
      <p className="settings-note">{t('email.card.note')}</p>
      {account.fields.map((f) => (
        <div className="settings-control" key={f.key}>
          <input
            className="settings-input"
            type={f.secret ? 'password' : 'text'}
            placeholder={f.set ? t('email.card.fieldSetPlaceholder', { label: f.label, source: f.source }) : f.label}
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
          onClick={() => act(() => setEmailCredentials(Object.fromEntries(dirtyFields)))}
        >
          {t('email.card.save')}
        </button>
        <button
          type="button"
          className="settings-set is-danger"
          disabled={busy}
          onClick={() => act(() => clearEmailCredentials())}
        >
          {t('email.card.forget')}
        </button>
      </div>

      <div className="settings-control">
        <Select
          fill
          ariaLabel={t('email.card.holderAria')}
          value={holder}
          onChange={setHolder}
          disabled={busy || roster.length === 0}
          placeholder={t('email.card.holderPlaceholder')}
          options={roster.map((m) => ({ value: m.neumaId, label: m.name || m.neumaId }))}
        />
        <button
          type="button"
          className="settings-set"
          disabled={busy || !holder}
          onClick={() => act(() => bindEmail(holder))}
        >
          {t('email.card.bind')}
        </button>
        {account.binding ? (
          <button
            type="button"
            className="settings-set is-danger"
            disabled={busy}
            onClick={() => act(() => releaseEmail())}
          >
            {t('email.card.release')}
          </button>
        ) : null}
      </div>
      {error ? <p className="settings-err">{error}</p> : null}
    </CredentialRow>
  );
};

/**
 * The house mailbox as one row, from the board the API tab read once
 * (use-api-credentials.js); the holder roster is read here, where the
 * binding is made. Under a state filter it stands only when it matches.
 */
export const EmailSection = ({ account, error, onChanged, stateFilter, openKey, onOpen }) => {
  const { t } = useTranslation('settingsApi');
  const [roster, setRoster] = useState([]);

  useEffect(() => {
    getRosterForBinding().then(setRoster).catch(() => setRoster([]));
  }, []);

  const item = emailItem(account);
  if (stateFilter && !passesState(item, stateFilter)) return null;

  return (
    <section className="settings-sec">
      <div className="label-data settings-h">{t('email.heading')}</div>
      <p className="settings-note">{t('email.note')}</p>

      {error ? <p className="settings-err">{error}</p> : null}
      {!account && !error ? <p className="settings-note">{t('email.reading')}</p> : null}

      {item ? (
        <AccountCard account={account} roster={roster} item={item} open={openKey === item.key}
          onToggle={() => onOpen(openKey === item.key ? null : item.key)} onChanged={onChanged} />
      ) : null}
    </section>
  );
};
