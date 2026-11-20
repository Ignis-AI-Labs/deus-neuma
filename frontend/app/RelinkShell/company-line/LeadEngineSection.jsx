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
import { Fold } from '../fold/Fold.jsx';
import { Sheet } from '../sheet/Sheet.jsx';
import { People } from './People.jsx';
import { Outbox } from './Outbox.jsx';
import { useLeadEngine } from './use-lead-engine.js';
import { LeadFactsSheet } from './LeadFactsSheet.jsx';
import { LeadAudienceCard } from './LeadAudienceCard.jsx';
import { SUPPRESS_REASONS, segmentRows, suppressTargetOk } from './lead-engine-view.js';

// Each part stands where its data belongs (Design note, 2026-11-16: […]; […]): 'facts' on a
// position's COMPANY tab; 'leads' on LEADS: ONE list of people (People.jsx: a lead is a person with a status, and
// what is due stands on that person's row), and under it the do-not-contact list. In the POSITIONS window an audience stands UNDER ITS CAMPAIGN
// (SalesCampaigns.jsx), with its companies and its leads; 'audiences' here is the old COMPANY LINE
// window's flat list, which still shows all three parts.
const HEADS = Object.freeze({ facts: 'THE FACTS — WHAT A BUYER MAY BE TOLD', audiences: 'AUDIENCES — WHO EACH CAMPAIGN REACHES, AND THE OFFER', leads: 'LEADS — EVERY PERSON THE HOUSE KNOWS, AND WHO IS NEVER WRITTEN TO', people: 'PEOPLE — EVERY PERSON THE HOUSE KNOWS, AND WHO IS NEVER WRITTEN TO' });
// 'people' is 'leads' without the outbox: on the sales hub the outbox is its own stage, EMAILS (SalesPipeline.jsx).
const ALL_PARTS = Object.freeze(['facts', 'audiences', 'leads']);

/** @param {{holder?: ?{laneId: string, name: string}, onHand?: Function, parts?: string[]}} props - the seat's holder and the door to their chat, where the screen has them; parts: which of 'facts', 'audiences', 'leads' this screen carries */
export const LeadEngineSection = ({ holder = null, onHand = null, parts = ALL_PARTS }) => {
  const has = (part) => parts.includes(part);
  const { engine, busy, error, notice, refresh, moveSegment, approveList, reviewFacts, suppress, lift, changeFact, refileLead, sendEmails, returnEmail, editEmail, sending, stopSending, clearSending } = useLeadEngine();
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('asked');
  const rows = segmentRows(engine);
  // A part that names itself on its own first line (the facts fold, the people list) gets no second heading.
  const alone = parts.length === 1 && ['facts', 'leads', 'people'].includes(parts[0]);
  const okTarget = suppressTargetOk(target);
  return (
    <section className="cline-sec" aria-label={parts.length === 1 ? HEADS[parts[0]].split(' — ')[0].toLowerCase() : 'lead engine'} data-lead-engine={parts.join(' ')}>
      {alone ? null : <p className="cline-h label-data">{parts.length === 1 ? HEADS[parts[0]] : 'LEAD ENGINE — WHO THE MERCATOR SELLS TO, AND WHAT IS DUE'}</p>}
      {has('leads') || has('people') ? null : (
        <div className="cline-open">
          <button type="button" className="sec-scan label-data" disabled={busy} onClick={refresh}>REFRESH</button>
        </div>
      )}
      {error ? <p className="cline-move-t" role="alert">{error}</p> : null}
      <p className="cline-move-t" aria-live="polite" data-engine-notice="">{notice}</p>
      {!engine ? null : (
        <>
          {has('facts') ? <LeadFactsSheet key={engine.facts?.sheet?.id ?? 'none'} facts={engine.facts} companies={engine.companies} busy={busy} onReview={reviewFacts} onChange={changeFact} holder={holder} onHand={onHand} /> : null}
          {has('audiences') ? (rows.length === 0
            ? <EmptyState title="NO AUDIENCE YET" />
            : <ul className="cline-aud-list" aria-label="audiences">{rows.map((r) => <LeadAudienceCard key={r.segment.id} row={r} busy={busy} onMove={moveSegment} onList={approveList} />)}</ul>) : null}
          {has('leads') || has('people') ? (
            <>
              {has('people') ? null : <Outbox outbox={engine.outbox ?? null} leads={engine.leads ?? []} busy={busy} onSend={sendEmails} onReturn={returnEmail} onEdit={editEmail} sending={sending} onStop={stopSending} onClear={clearSending} />}
              <People engine={engine} busy={busy} onKind={refileLead} onRefresh={refresh} holder={holder} onHand={onHand} />
              <Fold id="leads:dnc" title="DO NOT CONTACT" stats={[`${engine.suppressions.length} ENTR${engine.suppressions.length === 1 ? 'Y' : 'IES'}`]}>
                <div className="cline-open" data-suppress-form="">
                  <input className="cline-input" aria-label="Email address or company domain never to contact" placeholder="jo@example.com or example.com"
                    disabled={busy} value={target} onChange={(e) => setTarget(e.target.value)} />
                  <Select fill ariaLabel={`Why never to contact: ${SUPPRESS_REASONS.find((r) => r.value === reason)?.label ?? ''}`}
                    value={reason} onChange={setReason} disabled={busy} options={SUPPRESS_REASONS} />
                  <button type="button" className="sec-scan label-data" disabled={busy || !okTarget}
                    onClick={() => { suppress(target, reason); setTarget(''); }}>ADD</button>
                </div>
                <Sheet label="do not contact" rows={engine.suppressions} rowKey={(e) => `${e.kind}:${e.value}`} rowAttrs={(e) => ({ 'data-suppressed': e.value })}
                  columns={[{ head: 'ADDRESS OR DOMAIN', cell: (e) => e.value, exact: true }, { head: 'WHY', cell: (e) => SUPPRESS_REASONS.find((r) => r.value === e.reason)?.label ?? e.reason }, { head: 'ADDED BY', cell: (e) => (e.by ? String(e.by).toUpperCase() : null) }, { head: 'WHEN', cell: (e) => (e.at ? String(e.at).slice(0, 10) : null) },
                    { head: 'LIFT', cell: (e) => <button type="button" className="sec-scan label-data" data-lift={e.value} disabled={busy} aria-label={`LIFT ${e.value} from the do-not-contact list`} onClick={() => lift(e)}>LIFT</button> }]} />
              </Fold>
            </>
          ) : null}
        </>
      )}
    </section>
  );
};
