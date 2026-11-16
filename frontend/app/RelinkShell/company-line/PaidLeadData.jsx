// PaidLeadData — when the sales seat may spend the operator's credits at an
// attached contact-data provider (Design note, 2026-11-15: […]). One choice of three and a monthly cap; what the month has spent
// and the last lookups, counted from the house's own record. Pure rendering:
// the presses arrive from use-lead-engine.js.

import { useState } from 'react';
import { SPEND_CHOICES, attachedWords, spentWords, lookupWords, capOk } from './paid-lead-view.js';

/** @param {{spend: object, busy: boolean, onSet: (mode: string, cap: number) => void}} props */
export const PaidLeadData = ({ spend, busy, onSet }) => {
  const [cap, setCap] = useState(String(spend.rule.cap));
  const chosen = SPEND_CHOICES.find((c) => c.mode === spend.rule.mode);
  return (
    <div className="cline-paid" data-paid-lead="" data-spend-mode={spend.rule.mode}>
      <p className="cline-move-t">A lookup at an attached provider spends your credits there, so you choose when one may run.</p>
      <p className="cline-move-t" data-spend-attached="">{attachedWords(spend)}</p>
      <div className="cline-open" role="group" aria-label="when paid lead data may be used">
        {SPEND_CHOICES.map((c) => (
          <button key={c.mode} type="button" className={`sec-scan label-data${spend.rule.chosen && c.mode === spend.rule.mode ? ' is-on' : ''}`} aria-pressed={spend.rule.chosen && c.mode === spend.rule.mode}
            disabled={busy} title={c.what} onClick={() => onSet(c.mode, spend.rule.cap)}>{c.label}</button>
        ))}
      </div>
      <p className="cline-move-t">{chosen.what}</p>
      <div className="cline-open">
        <input className="cline-input" inputMode="numeric" aria-label="Most credits the seat may spend in one month" disabled={busy} value={cap} onChange={(e) => setCap(e.target.value)} />
        <button type="button" className="sec-scan label-data" disabled={busy || !capOk(cap) || Number(cap) === spend.rule.cap} aria-label="SET CAP — the most credits a month"
          onClick={() => onSet(spend.rule.mode, Number(cap))}>SET CAP</button>
      </div>
      <p className="cline-move-t" data-spend-spent="">{spentWords(spend)}</p>
      {spend.lookups.length ? (
        <details>
          <summary className="cline-move-t">SHOW THE LAST LOOKUPS</summary>
          <ul className="cline-ws-src" aria-label="paid lookups">{spend.lookups.map((l) => <li key={`${l.at}:${l.domain}:${l.source}`}>{lookupWords(l)}</li>)}</ul>
        </details>
      ) : null}
    </div>
  );
};
