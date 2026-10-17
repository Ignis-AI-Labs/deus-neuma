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
  getEmailBoard, setEmailCredentials, clearEmailCredentials,
  bindEmail, releaseEmail,
} from '../../services/email-client.js';
import { getRosterForBinding } from '../../services/social-channels-client.js';

const AccountCard = ({ account, roster, onChanged }) => {
  const { t } = useTranslation('settingsApi');
  const [open, setOpen] = useState(false);
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
    <div className="settings-realm">
      <div className="settings-row">
        <span className="settings-k">{account.name}</span>
        <span className="settings-v">
          {account.configured ? t('email.card.connected') : t('email.card.notConnected')}
          <span className="settings-sec-tags">
            {account.binding
              ? <span className="settings-tag-dim">{t('email.card.heldBy', { holder: holderName })}</span>
              : <span className="settings-tag-warn">{t('email.card.unbound')}</span>}
          </span>
        </span>
      </div>

      <div className="settings-control">
        <button type="button" className="settings-set" onClick={() => setOpen(!open)}>
          {open ? t('email.card.close') : t('email.card.configure')}
        </button>
      </div>

      {open ? (
        <>
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
        </>
      ) : null}
    </div>
  );
};

export const EmailSection = () => {
  const { t } = useTranslation('settingsApi');
  const [account, setAccount] = useState(null);
  const [roster, setRoster] = useState([]);
  const [loadError, setLoadError] = useState(null);

  const refresh = async () => {
    const board = await getEmailBoard();
    setAccount(board.account);
  };

  useEffect(() => {
    Promise.all([getEmailBoard(), getRosterForBinding().catch(() => [])])
      .then(([board, owned]) => {
        setAccount(board.account);
        setRoster(owned);
        setLoadError(null);
      })
      .catch((e) => setLoadError(e.message));
  }, []);

  return (
    <section className="settings-sec">
      <div className="label-data settings-h">{t('email.heading')}</div>
      <p className="settings-note">{t('email.note')}</p>

      {loadError ? <p className="settings-err">{loadError}</p> : null}
      {!account && !loadError ? <p className="settings-note">{t('email.reading')}</p> : null}

      {account ? <AccountCard account={account} roster={roster} onChanged={refresh} /> : null}
    </section>
  );
};
