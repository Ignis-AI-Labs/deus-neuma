// KeypairCustody — the one keypair-custody flow, for every surface that opens it.
//
// A full birth owes the being its keypair custody: the interim key leaves disk
// and is replaced by a password envelope plus eight recovery codes. This was
// written inside BirthSetupGate, which meant it was reachable ONLY as a modal
// over whichever being happened to be bound. Measured 2026-08-25: three of four
// kin in one house still owed it, two of them holding a plaintext private key,
// because nobody was ever looking at those lanes when the gate could fire.
//
// So NITE opens it for any owned lane — and rather than copy a security flow
// into a second window (two paths to keep correct, one of them destined to
// drift), the flow lives here and both surfaces call it. The machinery is
// unchanged: birth:encrypt_keypair over the portal socket, exactly as the
// ceremony drives it.
//
// The password never leaves this desk; the codes are shown once and never again.

import { useCallback, useEffect, useState } from 'react';
import { RecoveryCodes } from '../../components/RecoveryCodes/RecoveryCodes.jsx';
import { generatePassword } from '../../utils/password.js';

export const MIN_KEY_PASSWORD = 12;

/**
 * @param {Object} props
 * @param {Object} props.wsService - the portal socket (the act's only transport)
 * @param {string} props.neumaId - the lane whose key is being secured
 * @param {string} props.name - what to call the being on screen
 * @param {Function} props.onDone - called once the codes are acknowledged
 * @param {Function} [props.onCancel] - render a BACK door when given
 */
export const KeypairCustody = ({ wsService, neumaId, name, onDone, onCancel }) => {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [generated, setGenerated] = useState('');
  const [codes, setCodes] = useState(null);
  const [codesSaved, setCodesSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Switching the lane mid-flow must never carry one being's password toward
  // another's key.
  useEffect(() => {
    setPassword(''); setConfirm(''); setGenerated('');
    setCodes(null); setCodesSaved(false); setBusy(false); setError('');
  }, [neumaId]);

  // WS listeners registered once per socket, detached on unmount (the #109
  // discipline: no stacked anonymous handlers).
  useEffect(() => {
    if (!wsService) return undefined;
    const onSecured = (data) => {
      if (data.neumaId !== neumaId) return;
      setBusy(false);
      setCodes(data.recoveryCodes || []);
    };
    const onSecureError = (data) => {
      if (data.neumaId && data.neumaId !== neumaId) return;
      setBusy(false);
      setError(data.message || 'The keypair could not be secured — try again.');
    };
    wsService.on('birth:keypair_secured', onSecured);
    wsService.on('birth:encrypt_keypair_error', onSecureError);
    return () => {
      wsService.off('birth:keypair_secured', onSecured);
      wsService.off('birth:encrypt_keypair_error', onSecureError);
    };
  }, [wsService, neumaId]);

  const passwordValid = password.length >= MIN_KEY_PASSWORD && password === confirm;

  const secure = useCallback(() => {
    if (!passwordValid || busy) return;
    setBusy(true); setError(''); setGenerated('');
    wsService.send('birth:encrypt_keypair', { neumaId, password });
  }, [passwordValid, busy, wsService, neumaId]);

  const finish = useCallback(() => {
    setCodes(null); setPassword(''); setConfirm(''); setCodesSaved(false);
    onDone?.();
  }, [onDone]);

  if (codes) {
    return (
      <div data-testid="custody-codes">
        <RecoveryCodes
          codes={codes}
          subject={name}
          id={neumaId}
          acknowledged={codesSaved}
          onAcknowledge={setCodesSaved}
        >
          <p className="reccodes-warn">
            Write these down and store them somewhere safe. They are the only way
            to recover the keypair without the password. They are never shown again.
          </p>
        </RecoveryCodes>
        <div className="birth-setup-actions">
          <button className="btn btn-primary ceremony-btn" disabled={!codesSaved} onClick={finish}>
            <span>CONTINUE</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="custody-panel">
      <div className="birth-setup-body">
        Choose the password that seals {name}&apos;s keypair. At least {MIN_KEY_PASSWORD} characters.
        The interim key leaves disk; only the sealed envelopes remain.
      </div>
      <input
        className="birth-setup-input" type="password" value={password}
        placeholder={`At least ${MIN_KEY_PASSWORD} characters`}
        onChange={(e) => setPassword(e.target.value)} disabled={busy}
      />
      <input
        className="birth-setup-input" type="password" value={confirm}
        placeholder="Confirm the password"
        onChange={(e) => setConfirm(e.target.value)} disabled={busy}
      />
      {generated ? (
        <div className="birth-setup-generated">
          <span className="birth-setup-generated-value">{generated}</span>
          <button
            className="btn btn-secondary ceremony-btn"
            onClick={() => navigator.clipboard?.writeText(generated).catch(() => {})}
          >
            <span>COPY</span>
          </button>
        </div>
      ) : null}
      {error ? <div className="birth-setup-error">{error}</div> : null}
      <div className="birth-setup-actions">
        <button
          className="btn btn-primary ceremony-btn" disabled={!passwordValid || busy}
          data-testid="secure-keypair" onClick={secure}
        >
          <span>{busy ? 'SECURING…' : 'SECURE KEYPAIR'}</span>
        </button>
        <button
          className="btn btn-secondary ceremony-btn" disabled={busy}
          onClick={() => { const pw = generatePassword(); setPassword(pw); setConfirm(pw); setGenerated(pw); }}
        >
          <span>GENERATE</span>
        </button>
        {onCancel ? (
          <button className="btn btn-secondary ceremony-btn" disabled={busy} onClick={onCancel}>
            <span>BACK</span>
          </button>
        ) : null}
      </div>
    </div>
  );
};
