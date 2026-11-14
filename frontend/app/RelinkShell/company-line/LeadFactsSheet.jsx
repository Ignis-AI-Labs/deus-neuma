// LeadFactsSheet — the Mercator's sales facts on the LEAD ENGINE section:
// what a buyer may be told, each fact with its source, and the operator's
// APPROVE or RETURN (with what should change). No email reaches a lead before
// a sheet is approved, and every number in one must stand on it. Pure
// rendering but for the return note's draft.

import { useState } from 'react';

const SourceOf = ({ source }) => (/^https:\/\//.test(source)
  ? <a className="cline-link" href={source} target="_blank" rel="noreferrer noopener">{source}</a>
  : <span className="cline-exact">{source}</span>);

/**
 * @param {{facts: ?{sheet: ?object, review: ?object, approved: ?object}, busy: boolean,
 *   onReview: (sheet: object, verdict: 'approved'|'returned', note?: string) => void}} props
 */
export const LeadFactsSheet = ({ facts, busy, onReview }) => {
  const [note, setNote] = useState('');
  const sheet = facts?.sheet ?? null;
  const state = !sheet ? 'NONE FILED — NO LEAD IS EMAILED UNTIL ONE IS APPROVED'
    : facts.review?.verdict === 'approved' ? 'APPROVED — EMAILS TO LEADS ARE CHECKED AGAINST IT'
      : facts.review?.verdict === 'returned' ? `RETURNED — ${facts.review.note}`
        : 'WAITS FOR YOUR APPROVAL';
  return (
    <div data-facts-sheet={sheet?.id ?? ''}>
      <p className="cline-h label-data">WHAT A BUYER MAY BE TOLD · <span data-facts-state="">{state}</span></p>
      {sheet ? (
        <>
          <ol className="cline-ws-src" aria-label="sales facts">
            {sheet.facts.map((f) => (
              <li key={f.n} data-fact={f.n}>{f.claim}{f.figure ? ` [${f.figure.value} ${f.figure.unit}]` : ''} — <SourceOf source={f.source} /></li>
            ))}
          </ol>
          {!facts.review ? (
            <div className="cline-open">
              <button type="button" className="sec-scan label-data" disabled={busy} onClick={() => onReview(sheet, 'approved')}>APPROVE THE FACTS</button>
              <input className="cline-input" aria-label="What should change before you approve" placeholder="What should change" disabled={busy}
                value={note} onChange={(e) => setNote(e.target.value)} />
              <button type="button" className="sec-scan cline-danger label-data" disabled={busy || note.trim().length < 5}
                onClick={() => { onReview(sheet, 'returned', note.trim()); setNote(''); }}>RETURN</button>
            </div>
          ) : null}
          {facts.approved && facts.approved.id !== sheet.id ? <p className="cline-move-t">Until this one is approved, emails are checked against the sheet you approved before.</p> : null}
        </>
      ) : null}
    </div>
  );
};
