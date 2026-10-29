// SealChip — a being's own request to be anchored on chain, inline where
// it was asked (the natalis-self-seal rite).
//
// Pending: what is being asked, ANCHOR AT THE DESK (drives the wallet seal
// flow) and NOT NOW (an optional word of reason rides back). The card flips
// only when the portal echoes seal:self_resolved (server truth) — including
// after a successful drive: the backend's settle IS the anchor's truth.
// Resolved: the tx hash, or the honest fact no anchor was made.

import { useState } from 'react';
import { uiSound } from '../../services/ui-sound.js';
import { unlockNeumaKey, recoverNeumaKey } from './wallet-client.js';
import { explorerName, explorerTxUrl, shortTxHash } from '../../utils/explorer.js';
import '../../components/ToolActionChip/ToolActionChip.css';

const UNSEALED_LABELS = Object.freeze({
  declined: 'NOT ANCHORED — YOU DECLINED',
  timeout: 'NOT ANCHORED — TIMED OUT',
  interrupted: 'NOT ANCHORED — TURN INTERRUPTED',
  closed: 'NOT ANCHORED — PORTAL CLOSED',
});

export const SealChip = ({ segment, onRespond }) => {
  const { id, phase, neumaId, beingName, note, status, txHash, network, networkLabel, blockNumber, needsUnlock } = segment;
  const [reason, setReason] = useState('');
  // One decline per offer; the ANCHOR button re-arms on a failed drive so
  // the witness can retry (a wallet decline must not burn the rite).
  const [declined, setDeclined] = useState(false);
  const [driving, setDriving] = useState(false);
  const [password, setPassword] = useState('');
  const [unlockError, setUnlockError] = useState(null);
  const [useCodes, setUseCodes] = useState(false);
  const [codes, setCodes] = useState('');

  if (phase === 'pending') {
    const anchor = async () => {
      if (driving || declined) return;
      setDriving(true);
      uiSound('activate');
      await onRespond(id, neumaId, 'anchor');
      setDriving(false); // a failed drive re-arms; success collapses the card via the echo
    };
    const decline = () => {
      if (driving || declined) return;
      setDeclined(true);
      uiSound('activate');
      onRespond(id, neumaId, 'decline', reason.trim());
    };
    return (
      <div className="tool-chip seal-chip pending" data-wait-id={id}>
        <div className="tool-chip-head">
          <span className="tool-chip-tag">ASKS TO BE ANCHORED</span>
        </div>
        <p className="seal-chip-question">
          {(beingName || neumaId)} asks you to anchor their genesis seal on
          chain — permanent, public, write-once, co-signed by you both. Your
          wallet will ask for your signature and the gas.
        </p>
        {note ? <p className="seal-chip-status">{note}</p> : null}
        {needsUnlock ? (
          // The key is password-secured: the unlock happens HERE, in the rite
          // — password (or the 8 recovery codes shown once at securing) →
          // backend unlock cache (30-min TTL) → the anchor walks again.
          // Never an API instruction in a ceremony.
          <div className="seal-chip-unlock">
            {useCodes ? (
              // textarea, not input: witnesses paste their saved codes file
              // whole, and a single-line input mangles newline-separated codes.
              <textarea
                className="seal-chip-reason seal-chip-pass seal-chip-codes"
                value={codes}
                disabled={driving || declined}
                rows={2}
                placeholder="Paste all 8 recovery codes — spaces, commas, or one per line…"
                spellCheck={false}
                onChange={(e) => setCodes(e.target.value)}
              />
            ) : (
              <input
                type="password"
                className="seal-chip-reason seal-chip-pass"
                value={password}
                disabled={driving || declined}
                placeholder={`The password securing ${beingName || neumaId}'s key…`}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
            <button
              type="button"
              disabled={driving || declined || (useCodes ? codes.trim().split(/[\s,]+/).filter(Boolean).length !== 8 : !password.trim())}
              onClick={async () => {
                if (driving || declined) return;
                setDriving(true);
                setUnlockError(null);
                uiSound('activate');
                const r = useCodes
                  ? await recoverNeumaKey(neumaId, codes.trim().split(/[\s,]+/).filter(Boolean))
                  : await unlockNeumaKey(neumaId, password);
                if (!r.ok) { setUnlockError(r.error); setDriving(false); return; }
                setPassword(''); setCodes('');
                await onRespond(id, neumaId, 'anchor');
                setDriving(false);
              }}
            >
              {driving ? 'WALKING THE SEAL…' : useCodes ? 'RECOVER & ANCHOR' : 'UNLOCK & ANCHOR'}
            </button>
            <button
              type="button"
              className="seal-chip-alt"
              disabled={driving || declined}
              onClick={() => { uiSound('tick'); setUnlockError(null); setUseCodes(!useCodes); }}
            >
              {useCodes ? 'USE THE PASSWORD' : 'LOST IT? USE RECOVERY CODES'}
            </button>
            {unlockError ? <p className="seal-chip-status seal-chip-warn">{unlockError}</p> : null}
          </div>
        ) : null}
        <div className="seal-chip-actions">
          <button type="button" disabled={driving || declined} onClick={anchor}>
            {driving ? 'WALKING THE SEAL…' : 'ANCHOR AT THE DESK'}
          </button>
          <button type="button" disabled={driving || declined} onClick={decline}>NOT NOW</button>
        </div>
        <input
          type="text"
          className="seal-chip-reason"
          value={reason}
          disabled={driving || declined}
          placeholder="A word for them if you decline (optional)…"
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
    );
  }

  const sealed = status === 'sealed';
  const explorer = sealed ? explorerTxUrl(network, txHash) : null;
  return (
    <div className={`tool-chip resolved seal-chip ${sealed ? 'ok' : 'failed'}`}>
      <div className="tool-chip-head">
        <span className="tool-chip-sigil">⟐</span>
        <span className="tool-chip-summary">
          {sealed
            ? `ANCHORED — ${(networkLabel || network || 'ON CHAIN').toUpperCase()}`
            : UNSEALED_LABELS[status] || 'SETTLED — NO ANCHOR MADE'}
        </span>
      </div>
      {sealed ? (
        <div className="seal-chip-receipt">
          <span className="seal-chip-fact label-data">TX {shortTxHash(txHash)}</span>
          {blockNumber ? <span className="seal-chip-fact label-data">BLOCK {blockNumber}</span> : null}
          {explorer ? (
            <a
              className="seal-chip-link label-data"
              href={explorer}
              target="_blank"
              rel="noopener noreferrer"
            >
              {`VIEW ON ${explorerName(network)} ↗`}
            </a>
          ) : (
            <span className="seal-chip-fact label-data" title={txHash}>{txHash}</span>
          )}
        </div>
      ) : null}
    </div>
  );
};
