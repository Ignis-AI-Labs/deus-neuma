// AddCompany — NEW COMPANY beside ADD ACCOUNT's company picker (Founder
// 2026-11-05: […]). A
// company needs only its name to hold accounts; it stands on its own or under
// one of the house's companies, and its brand voice is filled later in BRAND
// KITS. The server makes its short id and refuses in words
// (marketing/companies.js addCompany); the new company is chosen for the
// account being added.
// impure — network.

import { useState } from 'react';
import { uiSound } from '../../../services/ui-sound.js';
import { addCompany } from '../../../services/company-sources-client.js';
import { CompanyPicker } from './CompanyPicker.jsx';

/**
 * @param {object} props
 * @param {ReadonlyArray<object>} props.companies - the house's companies, for the parent choice
 * @param {(company: object) => Promise<void>} props.onAdded
 */
export const AddCompany = ({ companies, onAdded }) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const close = () => { setOpen(false); setName(''); setParentId(''); setError(null); };
  const ready = name.trim() !== '' && !busy;
  const create = async () => {
    uiSound('toggle');
    setBusy(true);
    setError(null);
    try {
      const { company } = await addCompany({ name: name.trim(), parentId });
      close();
      await onAdded(company);
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  if (!open) {
    return (
      <div className="settings-control">
        <button type="button" className="settings-set" onClick={() => setOpen(true)}>NEW COMPANY</button>
      </div>
    );
  }
  return (
    <div className="settings-control account-new-company">
      <input className="settings-input" type="text" value={name} autoFocus spellCheck="false" disabled={busy}
        placeholder="company name, as it should read" aria-label="new company name"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && ready) create(); if (e.key === 'Escape') close(); }} />
      <CompanyPicker value={parentId} companies={companies} unsortedLabel="on its own" onChange={setParentId}
        ariaLabel="the company it stands under" disabled={busy} />
      <button type="button" className="settings-set" disabled={!ready} onClick={create}>ADD COMPANY</button>
      <button type="button" className="settings-set" disabled={busy} onClick={close}>CANCEL</button>
      {error ? <p className="settings-err">{error}</p> : null}
    </div>
  );
};
