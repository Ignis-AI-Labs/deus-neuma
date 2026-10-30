// RaiseSection — the raise room on the COMPANY LINE window, per standing
// company: the Quaestor's draft and the operator's SIGN (the receiving account
// entered here, never by a being; counsel's choice of route confirmed); the
// signed mandate and its switch; the Numerarius's facts sheet and counsel's
// verdict carried back; and the questions counsel answers before any investor
// is asked. Pure rendering; the IO lives in CompanyLineApp.jsx.

import { EmptyState } from '../empty-state.jsx';
import { ACCOUNT_KINDS, COUNSEL_QUESTIONS, signReady, mandateWords, accountWords, money } from './raise-view.js';

const FIELDS = Object.freeze({
  wallet: [['address', 'Receiving wallet (0x…)']],
  bank: [['bankName', 'Bank'], ['accountName', 'Account name'], ['details', 'Wire details (routing / IBAN / SWIFT)']],
  portal: [['portal', 'Registered funding portal'], ['url', 'Its https link']],
});

const SignForm = ({ id, raise, draft, busy, onDraft, onSign }) => (
  <div className="cline-move cham" data-raise-sign={id}>
    <div className="cline-move-in cham-in">
      <p className="cline-move-h label-data">SIGN THE MANDATE — ONLY YOU CAN</p>
      <p className="cline-co-line label-data">{mandateWords(raise.draft)}</p>
      <p className="cline-move-t">VALUED BY: {raise.draft.valuation.basis}</p>
      <p className="cline-move-t">THE MONEY WILL: {raise.draft.useOfFunds}</p>
      <div className="cline-modes" role="radiogroup" aria-label="Where the money lands">
        {ACCOUNT_KINDS.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={draft.kind === k} disabled={busy}
            className={`cline-mode label-data${draft.kind === k ? ' is-on' : ''}`} onClick={() => onDraft(`raise:${id}`, 'kind', k)}>{k.toUpperCase()}</button>
        ))}
      </div>
      {(FIELDS[draft.kind] ?? []).map(([field, label]) => (
        <input key={field} className="cline-input" aria-label={label} placeholder={label} value={draft[field] ?? ''} disabled={busy}
          onChange={(e) => onDraft(`raise:${id}`, field, e.target.value)} />
      ))}
      <label className="cline-co-line label-data">
        <input type="checkbox" checked={draft.counsel === true} disabled={busy} onChange={(e) => onDraft(`raise:${id}`, 'counsel', e.target.checked)} /> COUNSEL CHOSE THIS ROUTE
      </label>
      <div className="cline-actions">
        <button type="button" className="sec-scan label-data" disabled={busy || !signReady(draft)} onClick={() => onSign(id, raise.draft.id)}>SIGN</button>
      </div>
    </div>
  </div>
);

const Facts = ({ id, raise, draft, busy, onDraft, onReview }) => (
  <>
    <p className="cline-co-line label-data">FACTS SHEET — {raise.sheet.facts.length} FACTS · {!raise.review ? 'WAITING FOR COUNSEL' : raise.review.verdict === 'approved' ? 'APPROVED BY COUNSEL' : 'RETURNED BY COUNSEL'}</p>
    <ul className="cline-ws-src">
      {raise.sheet.facts.map((f) => (
        <li key={f.n}>{f.claim}{f.figure ? ` (${f.figure.value} ${f.figure.unit})` : ''}{f.forwardLooking ? ' — FORWARD-LOOKING' : ''} — {f.source}</li>
      ))}
    </ul>
    {raise.review ? (raise.review.note ? <p className="cline-move-t">COUNSEL: {raise.review.note}</p> : null) : (
      <>
        <input className="cline-input" aria-label="Counsel's note" placeholder="Counsel's note (what to change, if returned)" value={draft.note ?? ''} disabled={busy}
          onChange={(e) => onDraft(`raise:${id}`, 'note', e.target.value)} />
        <div className="cline-actions">
          <button type="button" className="sec-scan label-data" disabled={busy} onClick={() => onReview(id, raise.sheet.id, 'approved')}>COUNSEL APPROVED</button>
          <button type="button" className="sec-scan cline-danger label-data" disabled={busy || !(draft.note ?? '').trim()} onClick={() => onReview(id, raise.sheet.id, 'returned')}>COUNSEL RETURNED</button>
        </div>
      </>
    )}
  </>
);

// The close only the operator signs: the papers, accreditation where the route asks it,
// and the money landed — a money-in receipt at the mandate's wallet, or the wire/portal reference.
const CloseForm = ({ id, raise, investor, draft, busy, onDraft, onClose }) => {
  const key = `close:${investor.id}`;
  const needsAccredited = raise.mandate.route.kind === '506c';
  const ready = draft.papers === true && (!needsAccredited || draft.accredited === true) && String(raise.account.kind === 'wallet' ? draft.receipt ?? '' : draft.reference ?? '').trim().length > 4;
  return (
    <div className="cline-move cham" data-raise-close={investor.id}>
      <div className="cline-move-in cham-in">
        <p className="cline-move-h label-data">CLOSE {investor.name} — {money(investor.terms.amount)} {raise.mandate.currency} AT A {money(investor.terms.valuation)} VALUATION — ONLY YOU SIGN</p>
        <label className="cline-co-line label-data"><input type="checkbox" checked={draft.papers === true} disabled={busy} onChange={(e) => onDraft(key, 'papers', e.target.checked)} /> THE PAPERS ARE SIGNED</label>
        {needsAccredited ? <label className="cline-co-line label-data"><input type="checkbox" checked={draft.accredited === true} disabled={busy} onChange={(e) => onDraft(key, 'accredited', e.target.checked)} /> THE INVESTOR IS VERIFIED ACCREDITED</label> : null}
        <input className="cline-input" disabled={busy} value={(raise.account.kind === 'wallet' ? draft.receipt : draft.reference) ?? ''}
          aria-label={raise.account.kind === 'wallet' ? 'The money-in receipt' : 'The reference the money arrived under'}
          placeholder={raise.account.kind === 'wallet' ? 'The money-in receipt (network:tx:index) the money landed under' : 'The wire or portal reference the money arrived under'}
          onChange={(e) => onDraft(key, raise.account.kind === 'wallet' ? 'receipt' : 'reference', e.target.value)} />
        <div className="cline-actions">
          <button type="button" className="sec-scan label-data" disabled={busy || !ready} onClick={() => onClose(id, investor.id)}>SIGN THE CLOSE</button>
        </div>
      </div>
    </div>
  );
};

// Every investor the house listed, where each stands, and each thread as it was written.
const Investors = ({ investors }) => (
  <>
    <p className="cline-co-line label-data">INVESTORS — {investors.length}</p>
    <ul className="cline-ws-src">
      {investors.map((i) => (
        <li key={i.id} data-investor-id={i.id}>
          {i.name}{i.firm ? ` (${i.firm})` : ''} — {String(i.status).toUpperCase()}{i.note ? `: ${i.note}` : ''}{i.closed ? ` — ${money(i.closed.amount)} IN, UNDER ${i.closed.received.ref}` : ''}
          {i.thread.length ? (
            <details className="cline-floor">
              <summary className="label-data">{i.thread.length} MESSAGE{i.thread.length === 1 ? '' : 'S'} SENT</summary>
              {i.thread.map((m) => <p key={m.at + m.subject} className="cline-move-t">{m.at.slice(0, 16).replace('T', ' ')} — {m.subject}: {m.text}</p>)}
            </details>
          ) : null}
        </li>
      ))}
    </ul>
  </>
);

/**
 * @param {{raises: ?Array<object>, drafts: object, busy: boolean, onDraft: Function,
 *   onSign: Function, onMove: Function, onReview: Function}} props
 */
export const RaiseSection = ({ raises, drafts, busy, onDraft, onSign, onMove, onReview, onClose = () => {} }) => (
  <section className="cline-sec" aria-label="the raise room" data-raise-room="">
    <p className="cline-h label-data">THE RAISE ROOM — THE HOUSE RAISES, YOU SIGN</p>
    <details className="cline-floor">
      <summary className="label-data">BEFORE ANY INVESTOR IS ASKED, COUNSEL ANSWERS</summary>
      <ol>{COUNSEL_QUESTIONS.map((q) => <li key={q}>{q}</li>)}</ol>
    </details>
    {!raises || raises.every((r) => !r.raise.draft) ? <EmptyState title="NO RAISE — THE QUAESTOR DRAFTS A MANDATE FOR A STANDING COMPANY" /> : raises.filter((r) => r.raise.draft).map(({ id, name, raise }) => {
      const draft = drafts[`raise:${id}`] ?? {};
      return (
        <div key={id} className="cline-co" data-raise={id}>
          <p className="cline-co-name">{name} — MANDATE {raise.status === 'none' ? 'UNSIGNED' : raise.status.toUpperCase()}</p>
          {raise.draft.id !== raise.mandate?.id ? <SignForm id={id} raise={raise} draft={draft} busy={busy} onDraft={onDraft} onSign={onSign} /> : null}
          {raise.mandate ? (
            <>
              <p className="cline-co-line label-data">SIGNED: {mandateWords(raise.mandate)}</p>
              <p className="cline-co-line label-data">MONEY LANDS AT: <span className="cline-exact">{accountWords(raise.account)}</span></p>
              <div className="cline-actions">
                {raise.status === 'active' ? <button type="button" className="sec-scan label-data" disabled={busy} onClick={() => onMove(id, 'paused')}>PAUSE</button> : null}
                {raise.status === 'paused' ? <button type="button" className="sec-scan label-data" disabled={busy} onClick={() => onMove(id, 'resumed')}>RESUME</button> : null}
                {['active', 'paused'].includes(raise.status) ? <button type="button" className="sec-scan cline-danger label-data" disabled={busy} onClick={() => onMove(id, 'closed')}>END THE RAISE</button> : null}
              </div>
            </>
          ) : null}
          {raise.sheet ? <Facts id={id} raise={raise} draft={draft} busy={busy} onDraft={onDraft} onReview={onReview} /> : <p className="cline-co-line label-data">NO FACTS SHEET YET — THE NUMERARIUS FILES ONE</p>}
          {raise.investors?.length ? <Investors investors={raise.investors} /> : null}
          {raise.investors?.filter((i) => i.status === 'sound').map((i) => (
            <CloseForm key={i.id} id={id} raise={raise} investor={i} draft={drafts[`close:${i.id}`] ?? {}} busy={busy} onDraft={onDraft} onClose={onClose} />
          ))}
        </div>
      );
    })}
  </section>
);
