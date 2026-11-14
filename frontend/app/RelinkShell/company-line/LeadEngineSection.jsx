// LeadEngineSection — the Mercator's lead engine on the COMPANY LINE window:
// every audience it wants to sell to, with the pitch and who it targets, and
// the operator's APPROVE / PAUSE / RETIRE (nothing from an audience reaches
// the lead list until it is approved) and APPROVE THE LIST (its leads' emails
// then go within the sales cover's limits); each audience's companies, strongest
// first, every score with the reason it was given, folded one press away;
// what is due on the lead list; and the do-not-contact list. State lives in
// use-lead-engine.js; the words in lead-engine-view.js.

import { useState } from 'react';
import { Select } from '../Select.jsx';
import { EmptyState } from '../empty-state.jsx';
import { useLeadEngine } from './use-lead-engine.js';
import { LeadFactsSheet } from './LeadFactsSheet.jsx';
import {
  MATCH_WORDS, STATE_WORDS, UPKEEP_WORDS, SUPPRESS_REASONS, LIST_WORDS, segmentRows, segmentMoves, suppressTargetOk,
} from './lead-engine-view.js';

const SHOWN_DUE = 12;

const Criteria = ({ title, items }) => (items.length ? <p className="cline-move-t">{title}: {items.join(' · ')}</p> : null);

const Prospect = ({ p }) => (
  <li data-prospect-id={p.id}>
    <details>
      <summary>
        <b>{p.name}</b> ({p.domain}) — <span data-match="">{MATCH_WORDS[p.match]}</span>{p.listApproved ? <span data-listed=""> — ON THE APPROVED LIST</span> : null}
        {p.people.length ? ` — ${p.people.map((m) => `${m.name}, ${m.role}`).join('; ')}` : ' — nobody read yet'}
      </summary>
      <ul aria-label={`why ${p.name} was scored so`}>
        {[...p.fit, ...p.misfit.map((s) => ({ ...s, criterion: `NOT A FIT IF: ${s.criterion}` }))].map((s) => (
          <li key={s.criterion}>{s.criterion} — {s.score}/5: {s.reasoning}</li>
        ))}
        <li>FOUND ON <a className="cline-link" href={p.source} target="_blank" rel="noreferrer noopener">{p.source}</a></li>
      </ul>
    </details>
  </li>
);

const Segment = ({ row, busy, onMove, onList }) => {
  const { segment: s, pool, counts, listable } = row;
  return (
    <li className="cline-sec" data-segment-id={s.id} data-segment-state={s.state}>
      <p className="cline-h label-data">{s.name} · <span data-state-words="">{STATE_WORDS[s.state]}</span></p>
      <p className="cline-move-t">OFFER: {s.offer}</p>
      <p className="cline-move-t">THEIR PROBLEM: {s.customerProblem}</p>
      <p className="cline-move-t">REACH: {s.targetRole} · WHERE: {s.targetGeography}{s.targetCompanySize ? ` · SIZE: ${s.targetCompanySize}` : ''}</p>
      <Criteria title="FITS IF" items={s.positiveCriteria} />
      <Criteria title="NOT A FIT IF" items={s.negativeCriteria} />
      <Criteria title="LIKE" items={s.exampleClients} />
      <p className="cline-move-t">WHY THEM: {s.why}</p>
      <div className="cline-open">
        {segmentMoves(s.state).map((m) => (
          <button key={m.state} type="button" className={`sec-scan label-data${m.state === 'retired' ? ' cline-danger' : ''}`} disabled={busy}
            aria-label={`${m.label} ${s.name}`} onClick={() => onMove(s, m.state)}>{m.label}</button>
        ))}
      </div>
      <p className="cline-move-t" data-pool-counts="">
        COMPANIES: {pool.length} — STRONG {counts.strong} · WEAK {counts.weak} · NO MATCH {counts.none} · ON THE LEAD LIST {counts.onLedger}
      </p>
      {listable ? (
        <div className="cline-open" data-list-approve="">
          <p className="cline-move-t">{LIST_WORDS}</p>
          <button type="button" className="sec-scan label-data" disabled={busy} aria-label={`APPROVE THE LIST of ${listable} for ${s.name}`}
            onClick={() => onList(s, listable)}>APPROVE THE LIST ({listable})</button>
        </div>
      ) : null}
      {pool.length ? <ul className="cline-ws-src" aria-label={`companies for ${s.name}`}>{pool.map((p) => <Prospect key={p.id} p={p} />)}</ul> : null}
    </li>
  );
};

export const LeadEngineSection = () => {
  const { engine, busy, error, notice, refresh, moveSegment, approveList, reviewFacts, suppress } = useLeadEngine();
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('asked');
  const rows = segmentRows(engine);
  const due = engine?.upkeep ?? [];
  const okTarget = suppressTargetOk(target);
  return (
    <section className="cline-sec" aria-label="lead engine" data-lead-engine="">
      <p className="cline-h label-data">LEAD ENGINE — WHO THE MERCATOR SELLS TO, AND WHAT IS DUE</p>
      <div className="cline-open">
        <button type="button" className="sec-scan label-data" disabled={busy} onClick={refresh}>REFRESH</button>
      </div>
      {error ? <p className="cline-move-t" role="alert">{error}</p> : null}
      <p className="cline-move-t" aria-live="polite" data-engine-notice="">{notice}</p>
      {!engine ? null : (
        <>
          <LeadFactsSheet facts={engine.facts} busy={busy} onReview={reviewFacts} />
          {rows.length === 0
            ? <EmptyState title="NO AUDIENCE YET" />
            : <ul className="cline-ws-src" aria-label="audiences">{rows.map((r) => <Segment key={r.segment.id} row={r} busy={busy} onMove={moveSegment} onList={approveList} />)}</ul>}
          <p className="cline-h label-data">LEAD LIST UPKEEP · {due.length ? `${due.length} DUE` : 'NOTHING DUE'}</p>
          {due.length ? (
            <ul className="cline-ws-src" aria-label="lead list upkeep">
              {due.slice(0, SHOWN_DUE).map((d) => (
                <li key={`${d.kind}:${d.leadId}`} data-upkeep={d.kind}>{d.name} — {UPKEEP_WORDS[d.kind]}{d.days ? ` (${d.days} DAYS)` : ''}</li>
              ))}
            </ul>
          ) : null}
          <p className="cline-h label-data">DO NOT CONTACT · {engine.suppressions.length}</p>
          <div className="cline-open" data-suppress-form="">
            <input className="cline-input" aria-label="Email address or company domain never to contact" placeholder="jo@example.com or example.com"
              disabled={busy} value={target} onChange={(e) => setTarget(e.target.value)} />
            <Select fill ariaLabel={`Why never to contact: ${SUPPRESS_REASONS.find((r) => r.value === reason)?.label ?? ''}`}
              value={reason} onChange={setReason} disabled={busy} options={SUPPRESS_REASONS} />
            <button type="button" className="sec-scan label-data" disabled={busy || !okTarget}
              onClick={() => { suppress(target, reason); setTarget(''); }}>ADD</button>
          </div>
          {engine.suppressions.length ? (
            <details>
              <summary className="cline-move-t">SHOW THE LIST</summary>
              <ul className="cline-ws-src" aria-label="do not contact">
                {engine.suppressions.map((e) => <li key={`${e.kind}:${e.value}`} data-suppressed={e.value}>{e.value} — {e.reason}</li>)}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </section>
  );
};
