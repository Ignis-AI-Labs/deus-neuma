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
import { LeadList } from './LeadList.jsx';
import { ContactBook } from './ContactBook.jsx';
import { useLeadEngine } from './use-lead-engine.js';
import { LeadFactsSheet } from './LeadFactsSheet.jsx';
import { LeadAudienceCard } from './LeadAudienceCard.jsx';
import { UPKEEP_WORDS, upkeepAge, SUPPRESS_REASONS, segmentRows, suppressTargetOk } from './lead-engine-view.js';

const SHOWN_DUE = 12;

// Each part stands where its data belongs (Design note, 2026-11-16: […]; […]): 'facts' on a
// position's COMPANY tab; 'leads' (the lead list, the contact book, what is due, do-not-contact: the things that
// belong to no one campaign) on LEADS. In the POSITIONS window an audience stands UNDER ITS CAMPAIGN
// (SalesCampaigns.jsx), with its companies and its leads; 'audiences' here is the old COMPANY LINE
// window's flat list, which still shows all three parts.
const HEADS = Object.freeze({ facts: 'THE FACTS — WHAT A BUYER MAY BE TOLD', audiences: 'AUDIENCES — WHO EACH CAMPAIGN REACHES, AND THE OFFER', leads: 'LEADS — THE LEAD LIST, THE CONTACT BOOK, WHAT IS DUE, AND WHO IS NEVER WRITTEN TO' });
const ALL_PARTS = Object.freeze(['facts', 'audiences', 'leads']);

/** @param {{holder?: ?{laneId: string, name: string}, onHand?: Function, parts?: string[]}} props - the seat's holder and the door to their chat, where the screen has them; parts: which of 'facts', 'audiences', 'leads' this screen carries */
export const LeadEngineSection = ({ holder = null, onHand = null, parts = ALL_PARTS }) => {
  const has = (part) => parts.includes(part);
  const { engine, busy, error, notice, refresh, moveSegment, approveList, reviewFacts, suppress, changeFact, refileLead } = useLeadEngine();
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('asked');
  const rows = segmentRows(engine);
  const due = engine?.upkeep ?? [];
  const waiting = (engine?.candidates ?? []).filter((c) => c.state === 'waiting').length;
  const okTarget = suppressTargetOk(target);
  return (
    <section className="cline-sec" aria-label={parts.length === 1 ? HEADS[parts[0]].split(' — ')[0].toLowerCase() : 'lead engine'} data-lead-engine={parts.join(' ')}>
      {/* The facts fold names itself; a second heading over it would say the same thing twice. */}
      {parts.length === 1 && parts[0] === 'facts' ? null : <p className="cline-h label-data">{parts.length === 1 ? HEADS[parts[0]] : 'LEAD ENGINE — WHO THE MERCATOR SELLS TO, AND WHAT IS DUE'}</p>}
      <div className="cline-open">
        <button type="button" className="sec-scan label-data" disabled={busy} onClick={refresh}>REFRESH</button>
      </div>
      {error ? <p className="cline-move-t" role="alert">{error}</p> : null}
      <p className="cline-move-t" aria-live="polite" data-engine-notice="">{notice}</p>
      {!engine ? null : (
        <>
          {has('facts') ? <LeadFactsSheet key={engine.facts?.sheet?.id ?? 'none'} facts={engine.facts} companies={engine.companies} busy={busy} onReview={reviewFacts} onChange={changeFact} holder={holder} onHand={onHand} /> : null}
          {has('audiences') ? (rows.length === 0
            ? <EmptyState title="NO AUDIENCE YET" />
            : <ul className="cline-aud-list" aria-label="audiences">{rows.map((r) => <LeadAudienceCard key={r.segment.id} row={r} busy={busy} onMove={moveSegment} onList={approveList} />)}</ul>) : null}
          {has('leads') ? (
            <>
              <LeadList leads={engine.leads ?? []} kinds={engine.leadKinds ?? []} busy={busy} onKind={refileLead} holder={holder} onHand={onHand} />
              <ContactBook contacts={engine.contacts ?? []} stats={engine.contactStats ?? null} />
              <Fold id="leads:upkeep" title="LEAD LIST UPKEEP" waits={due.length > 0} stats={[due.length ? { text: `${due.length} DUE`, tone: 'alert' } : { text: 'NOTHING DUE', tone: 'on' }, `${(engine?.candidates ?? []).length} GATHERED · ${waiting} WAITING TO BE SCORED`]}>
                <p className="cline-move-t" data-candidates="">GATHERED FROM LEAD SOURCES: {(engine?.candidates ?? []).length} — {waiting} WAITING FOR THE SALES SEAT TO SCORE</p>
                {due.length ? (
                  <ul className="cline-ws-src" aria-label="lead list upkeep">
                    {due.slice(0, SHOWN_DUE).map((d) => (
                      <li key={`${d.kind}:${d.leadId}`} data-upkeep={d.kind}>{d.name} — {UPKEEP_WORDS[d.kind]}{upkeepAge(d)}{d.promised ? <span data-promised=""> — PROMISED: {d.promised}</span> : null}</li>
                    ))}
                  </ul>
                ) : <p className="cline-move-t">Nobody on the lead list is owed an answer or a follow-up today.</p>}
              </Fold>
              <Fold id="leads:dnc" title="DO NOT CONTACT" stats={[`${engine.suppressions.length} ENTR${engine.suppressions.length === 1 ? 'Y' : 'IES'}`]}>
                <div className="cline-open" data-suppress-form="">
                  <input className="cline-input" aria-label="Email address or company domain never to contact" placeholder="jo@example.com or example.com"
                    disabled={busy} value={target} onChange={(e) => setTarget(e.target.value)} />
                  <Select fill ariaLabel={`Why never to contact: ${SUPPRESS_REASONS.find((r) => r.value === reason)?.label ?? ''}`}
                    value={reason} onChange={setReason} disabled={busy} options={SUPPRESS_REASONS} />
                  <button type="button" className="sec-scan label-data" disabled={busy || !okTarget}
                    onClick={() => { suppress(target, reason); setTarget(''); }}>ADD</button>
                </div>
                {engine.suppressions.length ? (
                  <ul className="cline-ws-src" aria-label="do not contact">
                    {engine.suppressions.map((e) => <li key={`${e.kind}:${e.value}`} data-suppressed={e.value}>{e.value} — {e.reason}</li>)}
                  </ul>
                ) : null}
              </Fold>
            </>
          ) : null}
        </>
      )}
    </section>
  );
};
