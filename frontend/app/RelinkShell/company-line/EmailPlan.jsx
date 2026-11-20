// EmailPlan — a campaign's email variables, under its row in CAMPAIGNS (backend/services/sales/email-formula.js). Founder,
// 2026-11-19: […] The
// sales seat files them (sales/email-plan); the operator reads them here and LOCKS THEM IN, or sends them back with
// what should change. No first email of the campaign is written until they are locked in. Pure rendering + one form.

import { useState } from 'react';

export const PLAN_STATE_WORDS = Object.freeze({ approved: 'LOCKED IN', waiting: 'WAITS FOR YOU', returned: 'SENT BACK', none: 'NONE YET' });

/** pure — where a campaign's email plan stands. */
export const planState = (c) => {
  const p = c?.emailPlan;
  if (p?.proposed) return p.review?.verdict === 'returned' ? 'returned' : 'waiting';
  return p?.approved ? 'approved' : 'none';
};

const Variables = ({ plan, label }) => (
  <dl className="spl-plan" aria-label={label}>
    <dt className="label-data">FOR</dt><dd>{plan.objective}</dd>
    <dt className="label-data">THEY NEED</dt><dd>{plan.need}</dd>
    <dt className="label-data">WE OFFER</dt><dd>{plan.offer}</dd>
    <dt className="label-data">ASKS</dt>
    <dd><ol className="spl-plan-asks">{plan.asks.map((a, i) => <li key={i}>{a.ask} <span className="spl-msg-note">— on a yes: {a.delivers}</span></li>)}</ol></dd>
    <dt className="label-data">SIGN-OFF</dt><dd className="spl-msg-text">{plan.signature}</dd>
  </dl>
);

/** @param {{campaign: object, busy: boolean, onReview: (campaign: object, verdict: string, note: string) => void}} props */
export const EmailPlan = ({ campaign, busy, onReview }) => {
  const [note, setNote] = useState('');
  const p = campaign.emailPlan ?? null;
  const state = planState(campaign);
  return (
    <div className="spl-email-plan" data-email-plan={state}>
      <p className="cline-h label-data">EMAIL PLAN · {PLAN_STATE_WORDS[state]}</p>
      {state === 'none' ? <p className="cline-move-t">Your sales member files it (what this campaign is for, what its people need from us, the offer, its asks and its sign-off). No first email of this campaign is written until you lock it in.</p> : null}
      {p?.proposed ? (
        <>
          {state === 'returned' ? <p className="cline-move-t">You sent it back: {p.review.note}</p> : null}
          <Variables plan={p.proposed} label={`the email plan of ${campaign.name}, waiting for you`} />
          {state === 'waiting' ? (
            <div className="cline-fact-bar">
              <button type="button" className="sec-scan label-data" disabled={busy} aria-label={`LOCK IN the email plan of ${campaign.name}`} onClick={() => onReview(campaign, 'approved', '')}>LOCK IT IN</button>
              <input className="cline-input" aria-label={`What should change in the email plan of ${campaign.name}`} placeholder="what should change" maxLength={600} disabled={busy} value={note} onChange={(e) => setNote(e.target.value)} />
              <button type="button" className="sec-scan cline-danger label-data" disabled={busy || note.trim().length < 5} aria-label={`SEND BACK the email plan of ${campaign.name}`} onClick={() => { onReview(campaign, 'returned', note.trim()); setNote(''); }}>SEND BACK</button>
            </div>
          ) : null}
        </>
      ) : null}
      {p?.approved ? (
        <>
          {p.proposed ? <p className="cline-h label-data">LOCKED IN NOW, UNTIL THE ONE ABOVE IS</p> : null}
          <Variables plan={p.approved} label={`the email plan of ${campaign.name}, locked in`} />
        </>
      ) : null}
    </div>
  );
};
