// AccountsList — one platform's APP and its ACCOUNTS in SETTINGS → API →
// CHANNEL KEYS (campaign plan §2.6). The developer app is stored once (its
// fields serve every account); each account row carries its company, its
// live proof, its own keys (CONNECT for a sign-in platform, paste for the
// rest) and REMOVE. ADD ACCOUNT opens the next one under a chosen company;
// NEW COMPANY adds a company to choose (AddCompany.jsx).
//
// Keys are sealed on this machine and never echoed back — a set field shows
// only THAT it is set and where it came from. WHO may post through an
// account is decided in the platform's own window.
// impure — network.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uiSound } from '../../../services/ui-sound.js';
import {
  addAccount, updateAccount, setAccountKeys, removeAccount, setAppKeys,
} from '../../../services/social-accounts-client.js';
import { ChannelConnect } from '../ChannelConnect.jsx';
import { CompanyPicker } from './CompanyPicker.jsx';
import { AddCompany } from './AddCompany.jsx';
import { FlightLine } from './FlightLine.jsx';
import { handleOf } from './account-words.js';
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

const AppBlock = ({ app, onChanged }) => {
  const [draft, setDraft] = useState({});
  const { busy, error, act } = useAct(onChanged);
  const dirty = Object.entries(draft).filter(([, v]) => v !== '');
  return (
    <div className="account-app">
      <div className="settings-row">
        <span className="settings-k">APP</span>
        <span className="settings-v">{app.configured ? 'saved — every account below uses it' : 'one developer app serves every account'}</span>
      </div>
      <KeyFields fields={app.fields} draft={draft} setDraft={setDraft} busy={busy} />
      <div className="settings-control">
        <button type="button" className="settings-set" disabled={busy || !dirty.length}
          onClick={() => act(async () => { await setAppKeys(app.id, Object.fromEntries(dirty)); setDraft({}); })}>
          SAVE APP
        </button>
      </div>
      {error ? <p className="settings-err">{error}</p> : null}
    </div>
  );
};

const AccountRow = ({ channel, account, companies, test, onChanged, onRetest }) => {
  const [draft, setDraft] = useState({});
  const { busy, error, act } = useAct(onChanged);
  const typed = account.fields.filter((f) => !f.app && !f.connect);
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
      <KeyFields fields={typed} draft={draft} setDraft={setDraft} busy={busy} />
      <div className="settings-control">
        {typed.length ? (
          <button type="button" className="settings-set" disabled={busy || !dirty.length}
            onClick={() => act(async () => { await setAccountKeys(account.id, Object.fromEntries(dirty)); setDraft({}); })}>
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
  const app = house.apps.find((a) => a.id === channel.id) || null;
  const accounts = house.accounts.filter((a) => a.channelId === channel.id);
  return (
    <div className="account-list">
      {app ? <AppBlock app={app} onChanged={onChanged} /> : null}
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
