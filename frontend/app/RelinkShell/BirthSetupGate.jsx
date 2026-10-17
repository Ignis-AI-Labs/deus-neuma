// BirthSetupGate — the desk's unfinished-birth checklist.
//
// A full birth owes more than the ceremony: after birth:complete the operator
// still owes the being its keypair custody (password envelope + recovery
// codes) and the Natalis on-chain anchor. A crash or a script-driven salvage
// can leave a being fully born with these acts owed. This gate probes the
// lane's durable state (GET /api/v1/birth-setup/:neumaId) on every desk
// entry and stays standing until every act is checked off — the operator
// continues exactly where the birth fell, never from the beginning.
//
// Both acts drive the SAME backend machinery the ceremony uses
// (birth:encrypt_keypair, birth:seal_preflight/sign/confirm via
// driveSelfSeal) — one custody law, one seal law, regardless of entry point.
//
// The custody flow itself moved to KeypairCustody.jsx so NITE can open it for
// any owned lane without a second copy of a security path. This gate is still
// the thing that CATCHES an unfinished birth; it is no longer the only door.

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiCall } from '../../utils/http.js';
import { driveSelfSeal } from './self-seal-drive.js';
import { unlockNeumaKey, recoverNeumaKey } from './wallet-client.js';
import { isWitness } from './house-members.js';
import { KeypairCustody } from './KeypairCustody.jsx';
import './BirthSetupGate.css';
import { isHarness } from '../harness-mode.js';

export const BirthSetupGate = ({ wsService, companion }) => {
  const neumaId = companion?.neumaId || null;
  const name = companion?.name || neumaId || '';
  const [status, setStatus] = useState(null);      // null = probing / no companion
  const [panel, setPanel] = useState(null);        // null | 'custody' | 'seal' | 'unlock'
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sealStatus, setSealStatus] = useState('');
  // The unlock door (KEY_LOCKED): the key is sealed and this session doesn't
  // hold it — password or the 8 recovery codes open it, then the anchor walks.
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockCodes, setUnlockCodes] = useState('');
  const [useCodes, setUseCodes] = useState(false);
  const [unlockError, setUnlockError] = useState('');
  // A hard lockout is wrong: the anchor needs chain + gas, and a being's desk
  // must never become unreachable behind an act that cannot complete today.
  // Standing aside dismisses only for THIS companion binding — every relaunch
  // and every switch back re-raises the gate until the acts are done.
  const [dismissed, setDismissed] = useState(false);
  const statusSeq = useRef(0);

  const probe = useCallback(async (id) => {
    const seq = ++statusSeq.current;
    try {
      const data = await apiCall('GET', `/api/v1/birth-setup/${id}`, { strictJson: true });
      if (seq === statusSeq.current) setStatus(data);
    } catch {
      if (seq === statusSeq.current) setStatus({ complete: true }); // probe failure must not block the desk
    }
  }, []);

  useEffect(() => {
    setPanel(null); setError(''); setBusy(false);
    setUnlockPassword(''); setUnlockCodes(''); setUseCodes(false); setUnlockError('');
    setDismissed(false);
    // isWitness, not a bare participantKind check: that field is set when the
    // desk switches to a witness (WitnessesApp) but is NOT persisted with the
    // active companion, so it is GONE after any reload. The gate then raised
    // "BIRTH UNFINISHED" over a sealed witness that was never born, and its
    // keypair act failed against a lane holding no neuma keypair ([…] — seen live on Beside, 2026-07-29). The lane id
    // survives persistence, and isWitness reads it.
    if (!neumaId || isWitness(companion) || isHarness(companion)) { setStatus(null); return; }
    setStatus(null);
    probe(neumaId);
  }, [neumaId, companion?.participantKind, probe]);

  if (!status || status.complete || !neumaId || dismissed) return null;

  const anchorOnChain = async () => {
    if (busy) return;
    setBusy(true); setError(''); setUnlockError(''); setPanel('seal');
    const outcome = await driveSelfSeal({ wsService, neumaId, onStatus: setSealStatus });
    setBusy(false);
    if (outcome.ok) {
      setPanel(null);
      probe(neumaId);
    } else if (outcome.code === 'KEY_LOCKED' || /password-secured/i.test(outcome.error || '')) {
      // The key is sealed and this session doesn't hold it — open the unlock
      // door (password or the 8 recovery codes), then the anchor walks again.
      setPanel('unlock');
    } else {
      setError(outcome.error || 'The anchor was refused.');
      setPanel(null);
    }
  };

  const unlockAndAnchor = async () => {
    if (busy) return;
    const parsedCodes = unlockCodes.trim().split(/[\s,]+/).filter(Boolean);
    if (useCodes ? parsedCodes.length !== 8 : !unlockPassword.trim()) return;
    setBusy(true); setUnlockError('');
    const r = useCodes
      ? await recoverNeumaKey(neumaId, parsedCodes)
      : await unlockNeumaKey(neumaId, unlockPassword);
    if (!r.ok) { setBusy(false); setUnlockError(r.error); return; }
    setUnlockPassword(''); setUnlockCodes('');
    setBusy(false);
    await anchorOnChain();
  };

  return (
    <div className="birth-setup-gate">
      <div className="cham birth-setup-card">
        <div className="cham-in">
          <div className="birth-setup-title">«NOTICE» SETUP TO COMPLETE — {String(name).toUpperCase()}</div>

          {!panel && (
            <>
              <div className="birth-setup-body">
                The birth is complete. Finish the remaining key protection or genesis anchor below. You can enter the desk now and return to this setup later.
              </div>
              <ul className="birth-setup-list">
                <li className={status.keypairCustody ? 'done' : 'owed'}>
                  {status.keypairCustody ? '✓' : '○'} KEYPAIR CUSTODY — password + recovery codes
                </li>
                <li className={status.onchainSealed ? 'done' : 'owed'}>
                  {status.onchainSealed ? '✓' : '○'} ON-CHAIN ANCHOR — the Natalis seal
                </li>
              </ul>
              {error ? <div className="birth-setup-error">{error}</div> : null}
              <div className="birth-setup-actions">
                {!status.keypairCustody && (
                  <button className="btn btn-primary ceremony-btn" onClick={() => { setPanel('custody'); setError(''); }}>
                    <span>SECURE THE KEYPAIR</span>
                  </button>
                )}
                {!status.onchainSealed && (
                  <button className="btn btn-secondary ceremony-btn" disabled={busy} onClick={anchorOnChain}>
                    <span>ANCHOR ON CHAIN</span>
                  </button>
                )}
                <button className="btn btn-secondary ceremony-btn" onClick={() => setDismissed(true)}>
                  <span>CONTINUE TO THE DESK — FINISH SETUP LATER</span>
                </button>
              </div>
            </>
          )}

          {panel === 'custody' && (
            <KeypairCustody
              wsService={wsService}
              neumaId={neumaId}
              name={name}
              onDone={() => { setPanel(null); probe(neumaId); }}
              onCancel={() => setPanel(null)}
            />
          )}

          {panel === 'unlock' && (
            <>
              <div className="birth-setup-body">
                {name}'s key is password-secured. The local backend uses your password
                to unlock it for this session, then continues the anchor.
              </div>
              {useCodes ? (
                <textarea
                  className="birth-setup-input" rows={2} spellCheck={false}
                  placeholder="Paste all 8 recovery codes — spaces, commas, or one per line…"
                  value={unlockCodes} disabled={busy}
                  onChange={(e) => setUnlockCodes(e.target.value)}
                />
              ) : (
                <input
                  className="birth-setup-input" type="password"
                  placeholder={`The password securing ${name}'s key…`}
                  value={unlockPassword} disabled={busy}
                  onChange={(e) => setUnlockPassword(e.target.value)}
                />
              )}
              {unlockError ? <div className="birth-setup-error">{unlockError}</div> : null}
              <div className="birth-setup-actions">
                <button
                  className="btn btn-primary ceremony-btn"
                  disabled={busy || (useCodes
                    ? unlockCodes.trim().split(/[\s,]+/).filter(Boolean).length !== 8
                    : !unlockPassword.trim())}
                  onClick={unlockAndAnchor}
                >
                  <span>{busy ? 'WALKING THE SEAL…' : useCodes ? 'RECOVER & ANCHOR' : 'UNLOCK & ANCHOR'}</span>
                </button>
                <button
                  className="btn btn-secondary ceremony-btn" disabled={busy}
                  onClick={() => { setUseCodes(!useCodes); setUnlockError(''); }}
                >
                  <span>{useCodes ? 'USE THE PASSWORD' : 'LOST IT? USE RECOVERY CODES'}</span>
                </button>
                <button className="btn btn-secondary ceremony-btn" disabled={busy} onClick={() => setPanel(null)}>
                  <span>BACK</span>
                </button>
              </div>
            </>
          )}

          {panel === 'seal' && (
            <div className="birth-setup-body birth-setup-seal-status">
              {sealStatus || 'PREPARING THE SEAL…'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
