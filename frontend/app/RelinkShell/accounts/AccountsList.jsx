// AccountsList — one platform's ACCOUNTS in SETTINGS → API → CHANNEL KEYS
// (campaign plan §2.6). Each account row carries its company, its live proof,
// its DEVELOPER APP, its own keys (CONNECT for a sign-in platform, paste for
// the rest) and REMOVE. ADD ACCOUNT opens the next one under a chosen company;
// NEW COMPANY adds a company to choose (AddCompany.jsx).
//
// EVERY ACCOUNT ITS OWN APP (Design note, 2026-11-11: […]): the first account's app keys are the house app; an added
// account rides it until its own app's keys are pasted on its row, and from then
// on uses its own (account-shape.js patchAccount).
//
// Keys are sealed on this machine and never echoed back — a set field shows
// only THAT it is set and where it came from. WHO may post through an
// account is decided in the platform's own window.
// impure — network.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uiSound } from '../../../services/ui-sound.js';
import {
  addAccount, updateAccount, setAccountKeys, removeAccount,
} from '../../../services/social-accounts-client.js';
import { ChannelConnect } from '../ChannelConnect.jsx';
import { CompanyPicker } from './CompanyPicker.jsx';
import { AddCompany } from './AddCompany.jsx';
import { FlightLine } from './FlightLine.jsx';
import { handleOf } from './account-words.js';
import { ACCOUNT_SETUP, flightHint } from './account-setup.js';
import './accounts.css';

// impure — one act with its busy state and its honest error.
const useAct = (onChanged) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const act = async (fn) => {
    uiSound('toggle');
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };
  return { busy, error, act };
};

// Typed key fields: what is not the app's and not filled by CONNECT.
const KeyFields = ({ fields, draft, setDraft, busy }) => {
  const { t } = useTranslation('settingsApi');
  return fields.map((f) => (
    <div className="settings-control" key={f.key}>
      <input
        className="settings-input"
        type={f.secret ? 'password' : 'text'}
        aria-label={f.label}
        placeholder={f.set ? t('channelKeys.card.fieldSetPlaceholder', { label: f.label, source: f.source }) : f.label}
        value={draft[f.key] ?? ''}
        onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
        disabled={busy}
      />
    </div>
  ));
};

// The account's developer app: the house app for the first account; an added
// account's own once its keys are pasted here, else the first account's.
const AppFields = ({ account, firstId, draft, setDraft, busy }) => {
  const appFields = account.fields.filter((f) => f.app);
  const own = account.id === firstId || account.appId === account.id;
  const [opened, setOpened] = useState(false);
  if (!appFields.length) return null;
  if (!own && !opened) {
    return (
      <div className="settings-row account-app-line">
        <span className="settings-k">DEVELOPER APP</span>
        <span className="settings-v">uses {firstId}'s app</span>
        <button type="button" className="settings-set" disabled={busy} onClick={() => setOpened(true)}>
          THIS ACCOUNT HAS ITS OWN APP
        </button>
      </div>
    );
  }
  // fields of an app not yet saved read empty, never as the shared app's "set"
  const shown = own ? appFields : appFields.map((f) => ({ ...f, set: false }));
  return (
    <>
      <div className="settings-row account-app-line">
        <span className="settings-k">DEVELOPER APP</span>
        <span className="settings-v">{account.id === firstId ? 'this account\'s app' : own ? 'this account\'s own app' : 'paste the keys of this account\'s app below'}</span>
      </div>
      <KeyFields fields={shown} draft={draft} setDraft={setDraft} busy={busy} />
    </>
  );
};

const AccountRow = ({ channel, account, companies, test, onChanged, onRetest }) => {
  const [draft, setDraft] = useState({});
  const { busy, error, act } = useAct(onChanged);
  const firstId = `${channel.id}-1`;
  const typed = account.fields.filter((f) => !f.app && !f.connect);
  const hasApp = account.fields.some((f) => f.app);
  const dirty = Object.entries(draft).filter(([, v]) => v !== '');
  const signsIn = account.fields.some((f) => f.connect);
  return (
    <div className="account-row" data-account={account.id}>
      <div className="settings-row">
        <span className="settings-k">{account.id}{handleOf(account) ? ` · ${handleOf(account)}` : ''}</span>
        <CompanyPicker value={account.companyId || ''} companies={companies} unsortedLabel="no company yet — choose one" disabled={busy}
          ariaLabel={`company of ${account.id}`}
          onChange={(companyId) => act(() => updateAccount(account.id, { companyId: companyId || null }))} />
      </div>
      <div className="settings-row">
        <span className="settings-k">{signsIn ? 'SIGNED IN AS' : 'PROVEN'}</span>
        <FlightLine test={test} />
      </div>
      {flightHint(channel.id, test) ? <p className="settings-err account-hint">{flightHint(channel.id, test)}</p> : null}
      <AppFields account={account} firstId={firstId} draft={draft} setDraft={setDraft} busy={busy} />
      <KeyFields fields={typed} draft={draft} setDraft={setDraft} busy={busy} />
      <div className="settings-control">
        {typed.length || hasApp ? (
          <button type="button" className="settings-set" disabled={busy || !dirty.length}
            onClick={() => act(async () => { await setAccountKeys(account.id, Object.fromEntries(dirty)); setDraft({}); onRetest(); })}>
            SAVE KEYS
          </button>
        ) : null}
        <button type="button" className="settings-set" disabled={!account.configured} onClick={onRetest}>RE-TEST</button>
        <button type="button" className="settings-set is-danger" disabled={busy}
          onClick={() => act(() => removeAccount(account.id))}>
          REMOVE
        </button>
      </div>
      {signsIn ? (
        <ChannelConnect channel={{ id: channel.id, fields: account.fields }} test={test} accountId={account.id}
          onConnected={async () => { await onChanged(); onRetest(); }} />
      ) : null}
      {error ? <p className="settings-err">{error}</p> : null}
    </div>
  );
};

/**
 * @param {object} props
 * @param {object} props.channel - the masked board entry
 * @param {{apps: object[], accounts: object[], companies: object[]}} props.house
 * @param {Record<string, object>} props.tests - account id → flight test
 * @param {() => Promise<void>} props.onChanged
 * @param {() => void} props.onRetest
 */
export const AccountsList = ({ channel, house, tests, onChanged, onRetest }) => {
  const [companyId, setCompanyId] = useState('');
  const { busy, error, act } = useAct(onChanged);
  const accounts = house.accounts.filter((a) => a.channelId === channel.id);
  const setup = ACCOUNT_SETUP[channel.id] || null;
  return (
    <div className="account-list">
      {setup ? (
        <details className="account-setup">
          <summary className="settings-v">{setup.summary} <span className="label-data">HOW</span></summary>
          <ol>{setup.steps.map((step) => <li key={step}>{step}</li>)}</ol>
        </details>
      ) : null}
      <div className="settings-row">
        <span className="settings-k">ACCOUNTS</span>
        <span className="settings-v">{accounts.length ? `${accounts.length} on ${channel.name}` : `none yet — add the first ${channel.name} account`}</span>
      </div>
      {accounts.map((account) => (
        <AccountRow key={account.id} channel={channel} account={account} companies={house.companies}
          test={tests?.[account.id] || null} onChanged={onChanged} onRetest={onRetest} />
      ))}
      <div className="settings-control account-add">
        <CompanyPicker value={companyId} companies={house.companies} unsortedLabel="for which company?" onChange={setCompanyId}
          ariaLabel={`company of the new ${channel.name} account`} disabled={busy} />
        <button type="button" className="settings-set" disabled={busy}
          onClick={() => act(() => addAccount({ channelId: channel.id, ...(companyId ? { companyId } : {}) }))}>
          ADD ACCOUNT
        </button>
      </div>
      <AddCompany companies={house.companies} onAdded={async (company) => { await onChanged(); setCompanyId(company.id); }} />
      {error ? <p className="settings-err">{error}</p> : null}
    </div>
  );
};
