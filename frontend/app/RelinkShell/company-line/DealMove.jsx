// DealMove — the operator works a deal with their own hand (Design note, 2026-11-21: what has been said on it so far, and one
// row to move it — to proposed (what was offered), won or lost (why, with the one word the house counts). The same
// rule the sales member's act keeps; a won or lost deal moves its lead too. Opens under the deal's row in the sheet.
// impure — one call to the revenue routes; the screen that holds it reads the board again after.
import { useState } from 'react';
import { moveDeal } from '../../../services/revenue-client.js';

const day = (iso) => String(iso ?? '').slice(0, 10);

/** @param {{deal: object, reasons: {won: string[], lost: string[]}, onMoved: () => void}} props */
export const DealMove = ({ deal, reasons = { won: [], lost: [] }, onMoved = () => {} }) => {
  const targets = deal.stage === 'qualified' ? ['proposed', 'won', 'lost'] : ['won', 'lost'];
  const [stage, setStage] = useState(targets[0]);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const closing = stage === 'won' || stage === 'lost';
  const ask = stage === 'proposed' ? 'what you offered, and on what terms' : `why it was ${stage}`;
  const press = async () => {
    setBusy(true);
    setError(null);
    try {
      await moveDeal(deal.id, { stage, note: note.trim(), ...(closing && reason ? { reason } : {}), ...(next.trim() ? { nextStep: next.trim() } : {}) });
      setNote(''); setNext(''); setReason('');
      onMoved();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="cline-deal" data-deal-move={deal.id}>
      <p className="cline-move-t">WHERE IT HURTS THEM: {deal.spin?.problem ?? '—'} · WHAT FIXING IT IS WORTH: {deal.spin?.needPayoff ?? '—'}</p>
      {deal.notes?.length ? (
        <ol className="cline-deal-notes" aria-label={`what has been said on the deal with ${deal.buyer}, oldest first`}>
          {deal.notes.map((n) => <li key={`${n.at}:${n.stage}`}>{day(n.at)} · {String(n.stage).toUpperCase()}{n.reason ? ` (${n.reason.toUpperCase()})` : ''}{n.by === 'operator' ? ' · BY YOU' : ''} — {n.note}</li>)}
        </ol>
      ) : null}
      <div className="cline-open">
        <select className="cline-input cline-deal-pick" aria-label={`Move the deal with ${deal.buyer} to`} disabled={busy} value={stage} onChange={(e) => { setStage(e.target.value); setReason(''); }}>
          {targets.map((t) => <option key={t} value={t}>{t.toUpperCase()}</option>)}
        </select>
        {closing ? (
          <select className="cline-input cline-deal-pick" aria-label={`The reason it was ${stage} (optional)`} disabled={busy} value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">REASON (OPTIONAL)</option>
            {(reasons[stage] ?? []).map((r) => <option key={r} value={r}>{r.toUpperCase()}</option>)}
          </select>
        ) : null}
        <input className="cline-input" aria-label={`In your words: ${ask}`} placeholder={ask} maxLength={600} disabled={busy} value={note} onChange={(e) => setNote(e.target.value)} />
        {closing ? null : <input className="cline-input" aria-label="The one clear next step (optional)" placeholder="next step (optional)" maxLength={200} disabled={busy} value={next} onChange={(e) => setNext(e.target.value)} />}
        <button type="button" className="sec-scan label-data" disabled={busy || note.trim().length < 10} data-deal-press="" onClick={press}>MARK {stage.toUpperCase()}</button>
      </div>
      {note.trim().length > 0 && note.trim().length < 10 ? <p className="cline-move-t" role="status">SAY A LITTLE MORE — {ask.toUpperCase()}</p> : null}
      {error ? <p className="sec-error" role="alert">{error}</p> : null}
    </div>
  );
};
