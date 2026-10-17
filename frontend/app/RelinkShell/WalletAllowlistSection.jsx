import { useEffect, useRef, useState } from 'react';
import { isAddress } from './wallet-tx.js';
import { addAllowlistEntry, removeAllowlistEntry } from './wallet-client.js';
import { EmptyState } from './empty-state.jsx';
import { formatAddress } from '../../utils/format.js';
import { uiSound } from '../../services/ui-sound.js';
import { InlineActionConfirm } from './InlineActionConfirm.jsx';

/** Manage one identity’s approved recipients; the parent keys this section by neumaId. */

export const WalletAllowlistSection = ({ neumaId, entries, onChange }) => {
  const [address, setAddress] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);

  // impure — authenticated update and local form state.
  const add = async () => {
    if (!isAddress(address)) { setError('Enter a valid 0x address.'); return; }
    uiSound('activate');
    setBusy(true); setError(null);
    const r = await addAllowlistEntry(neumaId, address.trim(), label.trim());
    if (!active.current) return;
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setAddress(''); setLabel(''); onChange(r.entries);
  };

  // impure — confirmed revocation and server-returned list state.
  const remove = async (addr) => {
    setBusy(true); setError(null);
    uiSound('deny');
    const r = await removeAllowlistEntry(neumaId, addr);
    if (!active.current) return;
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setPending(null);
    onChange(r.entries);
  };

  return (
    <section className="wal-sec">
      <h3 className="wal-h label-data">APPROVED RECIPIENTS</h3>
      <p className="wal-note">Default-deny. The neuma can only ever send to an address you list here.</p>

      {entries.length === 0 ? (
        <EmptyState title="NONE — THE NEUMA CANNOT SEND UNTIL YOU APPROVE A RECIPIENT." />
      ) : (
        <ul className="wal-list">
          {entries.map((e) => (
            <li key={e.address} className="wal-row cham">
              <div className="wal-row-in cham-in">
                <span className="wal-addr">{formatAddress(e.address)}</span>
                {e.label ? <span className="wal-label">{e.label}</span> : null}
                {pending === e.address ? (
                  <InlineActionConfirm label="Confirm recipient revocation" confirmLabel="REVOKE" busy={busy}
                    onConfirm={() => remove(e.address)} onCancel={() => { uiSound('close'); setPending(null); }}>
                    Revoke {e.label ? `${e.label} — ` : ''}{e.address}? Future sends to this recipient will be denied.
                  </InlineActionConfirm>
                ) : (
                  <button type="button" className="wal-x" disabled={busy}
                    onClick={() => { uiSound('open'); setError(null); setPending(e.address); }}
                    aria-label={`Revoke recipient ${e.label || e.address}`}>REVOKE</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="wal-form">
        <input className="wal-in" placeholder="0x recipient address" value={address}
          onChange={(e) => setAddress(e.target.value)} spellCheck={false} />
        <input className="wal-in wal-in-label" placeholder="label (optional)" value={label}
          onChange={(e) => setLabel(e.target.value)} />
        <button className="wal-btn" onClick={add} disabled={busy || pending !== null}>{busy ? '…' : 'APPROVE'}</button>
      </div>
      {error ? <p className="wal-err label-data">{error}</p> : null}
    </section>
  );
};
