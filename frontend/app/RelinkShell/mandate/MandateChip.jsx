// MandateChip — the CMO's MANDATE where the operator looks for it: the
// notification tray (its MANDATE row, beside WAITING ON YOU) and the House
// Clock's head. While a
// mandate stands its WITHDRAW is one press — no confirm, because ending
// capacity is the safe direction (Design note, 2026-10-24: […]). Nothing renders while no mandate stands.

import { useState } from 'react';
import { requestWaitingJump } from '../waiting/waiting-jump.js';
import { uiSound } from '../../../services/ui-sound.js';
import { withdrawMandate } from '../../../services/mandate-client.js';
import { useMandate } from './use-mandate.js';
import { chipLine, canWithdraw } from './mandate-view.js';
import './Mandate.css';

export const MandateChip = () => {
  const { view, act } = useMandate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const line = chipLine(view?.standing);
  if (!line) return null;
  const withdraw = async () => {
    uiSound('toggle');
    setBusy(true);
    setError(null);
    try { await act(() => withdrawMandate('withdrawn from the desk')); } catch (err) { setError(err.message); }
    setBusy(false);
  };
  return (
    <span className="mandate-chip" data-tone={line.tone}>
      <button type="button" className="mandate-chip-k" title={line.words} onClick={() => { uiSound('open'); requestWaitingJump({ where: { app: 'marketing' } }); }}>
        <span className="mandate-chip-mark" aria-hidden="true" />{line.label}
      </button>
      {canWithdraw(view.standing)
        ? <button type="button" className="mandate-withdraw" disabled={busy} onClick={withdraw}>{busy ? 'WITHDRAWING…' : 'WITHDRAW'}</button>
        : null}
      {error ? <span className="mandate-chip-err" role="alert">{error}</span> : null}
    </span>
  );
};
