// AccountStrip — a platform window's accounts, grouped by company (campaign
// plan §2.6): one window per platform, never one per account. The company
// picker (ALL · a company) filters the boards below to that company's
// accounts; each account shows who holds it, and the holder is chosen right
// here — one house lane per account (never an external witness: crew only).
// impure — network.

import { useState } from 'react';
import { uiSound } from '../../../services/ui-sound.js';
import { bindAccount, releaseAccount } from '../../../services/social-accounts-client.js';
import { Select } from '../Select.jsx';
import { CompanyPicker } from './CompanyPicker.jsx';
import { useHouseAccounts } from './use-house-accounts.js';
import { accountsByCompany, handleOf } from './account-words.js';
import './accounts.css';

const NO_HOLDER = '';

/**
 * @param {object} props
 * @param {string} props.channelId
 * @param {string} props.companyId - '' = ALL
 * @param {(companyId: string) => void} props.onCompany
 * @param {ReadonlyArray<object>} props.roster - the house's lanes (neuma hold; witnesses never)
 */
export const AccountStrip = ({ channelId, companyId, onCompany, roster }) => {
  const house = useHouseAccounts();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const groups = accountsByCompany(house.accounts, house.companies, channelId);
  const holders = [
    { value: NO_HOLDER, label: 'no holder — nobody posts' },
    ...(roster || []).filter((m) => m.participantKind !== 'witness').map((m) => ({ value: m.neumaId, label: m.name || m.neumaId })),
  ];
  const hold = async (accountId, neumaId) => {
    uiSound('toggle');
    setBusy(accountId);
    setError(null);
    try {
      await (neumaId ? bindAccount(accountId, neumaId) : releaseAccount(accountId));
      await house.refresh();
    } catch (e) {
      setError(e.message);
    }
    setBusy(null);
  };
  if (!groups.length) {
    return <p className="settings-note account-strip">No accounts on this platform yet — add one in Settings → API → Channel keys.</p>;
  }
  return (
    <div className="account-strip" aria-label="accounts">
      <div className="settings-row">
        <span className="settings-k">COMPANY</span>
        <CompanyPicker value={companyId} companies={house.companies} allLabel="ALL COMPANIES" onChange={onCompany} ariaLabel="show the boards of" />
      </div>
      {groups.filter((g) => !companyId || g.companyId === companyId).map((g) => (
        <div className="account-strip-group" key={g.companyId || 'unsorted'}>
          <span className={`label-data ${g.companyId ? 'settings-tag-dim' : 'settings-tag-warn'}`}>{g.name}</span>
          {g.accounts.map((a) => (
            <div className="settings-row account-strip-row" key={a.id} data-account={a.id}>
              <span className="settings-k">{a.id}{handleOf(a) ? ` · ${handleOf(a)}` : ''}</span>
              <Select value={a.binding?.neumaId || NO_HOLDER} options={holders} disabled={busy === a.id}
                ariaLabel={`holder of ${a.id}`} onChange={(neumaId) => hold(a.id, neumaId)} />
            </div>
          ))}
        </div>
      ))}
      {error ? <p className="settings-err">{error}</p> : null}
    </div>
  );
};
