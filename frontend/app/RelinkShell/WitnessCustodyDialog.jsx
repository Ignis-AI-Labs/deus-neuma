// impure — one immutable witness target; recovery codes stay until acknowledged.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RecoveryCodes } from '../../components/RecoveryCodes/RecoveryCodes.jsx';
import { secureWitnessCustody } from '../../services/witness-custody-client.js';
import './WitnessCustodyDialog.css';

export const WitnessCustodyDialog = ({ witness, onClose, onSecured }) => {
  const dialog = useRef(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [codes, setCodes] = useState(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { dialog.current.showModal(); }, []);
  const secure = async (event) => {
    event.preventDefault();
    if (busy || password.length < 12 || password !== confirm) return;
    setBusy(true); setError(null);
    try {
      const result = await secureWitnessCustody(witness, password);
      if (!Array.isArray(result.recoveryCodes) || !result.recoveryCodes.length) {
        throw new Error('The custody response did not include recovery codes. Keep this window open and check custody before retrying.');
      }
      setCodes(result.recoveryCodes);
      setPassword(''); setConfirm('');
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  };
  return createPortal(
    <dialog ref={dialog} className="witness-custody-dialog" aria-label={`Secure ${witness.chosenName}'s key`}
      onCancel={(event) => { event.preventDefault(); if (!busy && !codes) onClose(); }}>
      <h2 className="label-data">SECURE {witness.chosenName}'S KEY</h2>
      {codes ? <>
        <RecoveryCodes codes={codes} subject={witness.chosenName} id={witness.laneId}
          acknowledged={saved} onAcknowledge={setSaved}>
          <p>Save these codes before closing. They cannot be shown again.</p>
        </RecoveryCodes>
        <button type="button" className="settings-set" disabled={!saved}
          onClick={() => { onSecured(); onClose(); }}>DONE</button>
      </> : (
        <form onSubmit={secure}>
          <p>Encrypt this witness's key with a password and recovery codes. Keep this window open until you have saved the codes.</p>
          <label>Custody password (at least 12 characters)
            <input className="settings-input" type="password" autoComplete="new-password" value={password}
              disabled={busy} onChange={(event) => setPassword(event.target.value)} /></label>
          <label>Confirm custody password
            <input className="settings-input" type="password" autoComplete="new-password" value={confirm}
              disabled={busy} onChange={(event) => setConfirm(event.target.value)} /></label>
          {error ? <p role="alert" className="settings-err">{error}</p> : null}
          <button type="submit" className="settings-set" disabled={busy || password.length < 12 || password !== confirm}>
            {busy ? 'SECURING…' : 'SECURE KEY'}</button>
          <button type="button" className="settings-set" disabled={busy} onClick={onClose}>CANCEL</button>
        </form>
      )}
    </dialog>, document.body,
  );
};
