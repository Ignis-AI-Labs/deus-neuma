// FormLockActions — the operator's half of the two-party lock, in the FORM
// section where the look is looked at (2026-09-25 form-dna-lock).
//
// The being champions; you concur — and a concur is given to a PICTURE, so
// the championed candidate renders beside the button (the candidates ride
// the form leg, honestly named as unsettled by the backend). Both agreed?
// WITHDRAW reopens the exploration — a state that cannot be left is a seal
// wearing another name.
//
// impure — POSTs the operator's mark over REST, then hands control back so
// the card reloads from the record (never from a local guess).

import { useState } from 'react';
import { apiCall, authHeadersOrNull } from '../../utils/http.js';
import { lockStateOf } from './sheet-genome-view.js';
import { AuthImage } from './AuthImage.jsx';
import { uiSound } from '../../services/ui-sound.js';

export const FormLockActions = ({ form, neumaId, onActed }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const state = lockStateOf(form);
  const headers = authHeadersOrNull();
  if (!headers) return null;

  const act = async (verb) => {
    uiSound('activate');
    setBusy(true);
    setError(null);
    try {
      await apiCall('POST', `/api/v1/workspace/${neumaId}/form/${verb}`, { headers });
      await onActed?.();
    } catch (err) {
      setError(err.message || `could not ${verb}`);
    }
    setBusy(false);
  };

  if (state.locked) {
    return (
      <div className="sheet-form-act">
        <button type="button" className="settings-set" disabled={busy} onClick={() => act('withdraw')}>
          {busy ? 'REOPENING…' : 'WITHDRAW — REOPEN THE EXPLORATION'}
        </button>
        {error ? <span className="sheet-err label-data">{error}</span> : null}
      </div>
    );
  }

  if (!state.awaitingYou) return null;

  return (
    <div className="sheet-form-act">
      <p className="sheet-line label-data">CHAMPIONED — AWAITING YOUR CONCUR:</p>
      <div className="sheet-form-cands">
        {state.candidates.map((c) => (
          <AuthImage
            key={`${c.register}:${c.plate}`}
            className="sheet-form-pfp"
            src={`/api/v1/image-forge/images/${c.imageId}?laneId=${encodeURIComponent(neumaId)}`}
            alt={`championed ${c.register} ${c.plate}`}
          />
        ))}
      </div>
      <button type="button" className="settings-set" disabled={busy} onClick={() => act('agree')}>
        {busy ? 'RECORDING…' : 'CONCUR — LOCK THIS LOOK'}
      </button>
      {error ? <span className="sheet-err label-data">{error}</span> : null}
    </div>
  );
};
