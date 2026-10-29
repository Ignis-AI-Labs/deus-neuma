// SpendCard — one being's pending wallet spend, as the operator decides it
// (#586) — the most consequential card on the desk, so the
// card shows everything the decision rests on — who asks and in its own
// words why, the exact amount, asset and chain, the recipient and its
// standing (a plain warning on a first-time address), the wallet it leaves
// and what that wallet holds after, the limits, the time left, and the
// Quaestor's review — and offers exactly two ways forward:
//
//   SIGN & APPROVE — the existing flow, unchanged (wallet-client.js): your own
//     wallet signs the exact approval message, then the being's key password
//     unlocks its key for this one transfer. Never one press: the password is
//     typed here, and your wallet asks again for its signature.
//   DENY — nothing moves; an optional note goes back to the being.
//
// The card root carries data-spend-id, so a WAITING ON YOU row lands on it.

import { useState } from 'react';
import { uiSound } from '../../../services/ui-sound.js';
import { approvePendingSpend, rejectPendingSpend } from '../wallet-client.js';
import {
  timeLeftLabel, isClosing, secondsLeftAt, askerLabel, recipientLines, fromLine, limitsLine, reviewLine, mayApprove,
} from './spend-card-view.js';
import './SpendCard.css';

/**
 * @param {{card: object, readAtMs: number, now: number, seated: boolean,
 *   onDecided: (card: object, outcome: {kind: 'approved'|'denied', hash?: string}) => void}} props
 */
export const SpendCard = ({ card, readAtMs, now, seated, onDecided }) => {
  const [password, setPassword] = useState('');
  const [denying, setDenying] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const left = secondsLeftAt(card, readAtMs, now);
  const recipient = recipientLines(card.recipient);
  const review = reviewLine(card.review, seated);

  const approve = async () => {
    uiSound('activate');
    setBusy(true); setError(null);
    const r = await approvePendingSpend(card.neumaId, { id: card.id, ...card.approval }, password);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setPassword('');
    onDecided(card, { kind: 'approved', hash: r.hash });
  };

  const deny = async () => {
    uiSound('deny');
    setBusy(true); setError(null);
    const r = await rejectPendingSpend(card.neumaId, card.id, note.trim());
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    onDecided(card, { kind: 'denied' });
  };

  return (
    <article className={`spend cham${left <= 0 ? ' is-expired' : ''}`} data-spend-id={card.id} aria-label={`spend asked by ${askerLabel(card)}`}>
      <div className="spend-in cham-in">
        <header className="spend-head">
          <span className="spend-kind label-data">SPEND</span>
          <span className="spend-who label-data">{askerLabel(card)} ASKS</span>
          <span className={`spend-left label-data${isClosing(left) ? ' is-closing' : ''}`}>{timeLeftLabel(left)}</span>
        </header>

        <p className="spend-amount">
          <b className="spend-figure">{card.amount}</b> <span className="spend-asset label-data">{card.asset} · {String(card.chain).toUpperCase()}</span>
        </p>

        <p className={`spend-reason${card.reason ? '' : ' is-none'}`}>
          {card.reason ? <q>{card.reason}</q> : 'NO REASON GIVEN'}
        </p>

        <dl className="spend-facts">
          <dt className="label-data">TO</dt>
          <dd><span className="spend-addr">{card.recipient.address}</span><span className="spend-sub label-data">{recipient.standing}</span></dd>
          <dt className="label-data">FROM</dt>
          <dd><span className="spend-addr">{card.from.address || '—'}</span><span className={`spend-sub label-data${card.from.short ? ' is-loud' : ''}`}>{fromLine(card.from)}</span></dd>
          <dt className="label-data">LIMITS</dt>
          <dd className="spend-sub label-data">{limitsLine(card.limits)}</dd>
          <dt className="label-data">QUAESTOR</dt>
          <dd>
            <span className={`spend-sub label-data${card.review?.recommend === 'deny' ? ' is-loud' : ''}`}>{review.mark}</span>
            {review.reasons ? <span className="spend-review">{review.reasons}</span> : null}
          </dd>
        </dl>

        {recipient.warning ? <p className="spend-warn label-data" role="note">{recipient.warning}</p> : null}

        {denying ? (
          <div className="spend-deny">
            <textarea className="spend-note" rows={2} maxLength={280} placeholder={`a note for ${askerLabel(card).toLowerCase()} (optional)`}
              value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="spend-acts">
              <button type="button" className="spend-btn is-deny label-data" disabled={busy} onClick={deny}>{busy ? 'DENYING…' : 'DENY — NOTHING MOVES'}</button>
              <button type="button" className="spend-btn label-data" disabled={busy} onClick={() => { uiSound('close'); setDenying(false); }}>BACK</button>
            </div>
          </div>
        ) : (
          <div className="spend-acts">
            <input className="spend-pass" type="password" autoComplete="off" placeholder="the being's key password"
              aria-label="the being's key password" value={password} disabled={left <= 0} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" className="spend-btn is-go label-data" disabled={busy || !mayApprove(card, password, left)} onClick={approve}>
              {busy ? 'SIGNING…' : 'SIGN & APPROVE'}
            </button>
            <button type="button" className="spend-btn label-data" disabled={busy} onClick={() => { uiSound('open'); setDenying(true); }}>DENY</button>
          </div>
        )}
        {error ? <p className="spend-err label-data" role="alert">{error}</p> : null}
      </div>
    </article>
  );
};
