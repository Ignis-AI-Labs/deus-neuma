// SalesCalls — the CALLS stage (Design note, 2026-11-20: […]). One sheet: the calls coming, the next one on top, with how far off each is, where it is joined, and
// whether it MOVED; the calls held under them. Each row opens to move it, call it off, and read the messages with
// that person. Under it, the calls that were called off — kept, so a call that fell through is not forgotten.
import { useState } from 'react';
import { Sheet } from '../sheet/Sheet.jsx';
import { Fold } from '../fold/Fold.jsx';
import { CallAdd } from './CallAdd.jsx';
import { Thread } from './SalesStagesOut.jsx';
import { rowStatus } from './people-view.js';
import { callRows, calledOffRows, callAway, callWhen, saidLabel, ALL } from './sales-pipeline-view.js';

const campaignColumn = (view) => (view === ALL ? [{ head: 'CAMPAIGN', cell: (l) => l.origin?.campaign ?? 'NO CAMPAIGN' }] : []);
const coming = (l) => callAway(l) !== 'HELD';

// One call's own controls: a new time moves it; calling it off takes two presses (the second says it).
const CallHand = ({ lead, busy, onBook, onCancel }) => {
  const [when, setWhen] = useState('');
  const [armed, setArmed] = useState(false);
  const at = when && !Number.isNaN(Date.parse(when)) ? new Date(when).toISOString() : null;
  return (
    <div className="spl-call-hand" data-call-hand={lead.id}>
      <span className="spl-k label-data">{coming(lead) ? 'RESCHEDULED?' : 'ANOTHER CALL?'}</span>
      <input className="cline-input" type="datetime-local" aria-label={`The new time of the call with ${lead.name || lead.contact}, in this computer's time`} disabled={busy} value={when} onChange={(e) => setWhen(e.target.value)} />
      <button type="button" className="sec-scan label-data" disabled={busy || !at} data-call-move="" onClick={() => { onBook(lead, { at, title: lead.call.title ?? '', link: lead.call.link ?? '' }); setWhen(''); }}>{coming(lead) ? 'MOVE THE CALL' : 'BOOK IT'}</button>
      <button type="button" className="sec-scan label-data" disabled={busy} data-call-off={armed ? 'armed' : ''} onClick={() => { if (armed) onCancel(lead); setArmed(!armed); }} onBlur={() => setArmed(false)}>
        {armed ? 'PRESS AGAIN TO CALL IT OFF' : coming(lead) ? 'CALL IT OFF' : 'REMOVE FROM CALLS'}
      </button>
    </div>
  );
};

/** @param {{engine: object, view: string, busy?: boolean, onBook?: Function, onCancel?: Function}} props */
export const CallsStage = ({ engine, view, busy = false, onBook = null, onCancel = null }) => {
  const off = calledOffRows(engine, view);
  return (
    <>
      {/* A call can be with anyone on the ledger, whatever campaign is in view. */}
      {onBook ? <CallAdd leads={engine?.leads ?? []} busy={busy} onBook={onBook} /> : null}
      <Sheet label="calls" rows={callRows(engine, view)} rowKey={(l) => l.id} rowName={(l) => l.name || l.contact} rowAttrs={(l) => ({ 'data-lead-id': l.id, 'data-call': coming(l) ? 'coming' : 'held' })}
        detail={(l) => <>{onBook && onCancel ? <CallHand lead={l} busy={busy} onBook={onBook} onCancel={onCancel} /> : null}<Thread engine={engine} lead={l} /></>}
        detailLabel={(l) => `move or call off the call with ${l.name || l.contact}, and the messages with them`}
        empty={<p className="spl-empty label-data">NO CALL BOOKED YET — ADD ONE ABOVE, OR YOUR SALES MEMBER FILES THE ONES IT VERIFIES</p>}
        columns={[
          { head: 'WHEN', cell: (l) => callWhen(l.call.at), sort: (l) => Date.parse(l.call.at), exact: true },
          { head: 'AWAY', cell: (l) => callAway(l), sort: (l) => Date.parse(l.call.at), tone: (l) => (!coming(l) ? 'dim' : /MIN|NOW| H$/.test(callAway(l)) ? 'alert' : 'on') },
          { head: 'CHANGED', cell: (l) => (l.call.movedFrom ? `MOVED · WAS ${callWhen(l.call.movedFrom)}` : '—'), tone: (l) => (l.call.movedFrom && coming(l) ? 'alert' : null), attrs: (l) => ({ 'data-call-moved': l.call.movedFrom ? '' : undefined }) },
          { head: 'PERSON', cell: (l) => l.name || l.contact },
          { head: 'JOIN', cell: (l) => (l.call.link ? <a className="cline-link" href={l.call.link} target="_blank" rel="noreferrer noopener" aria-label={`join the call with ${l.name || l.contact}`}>OPEN LINK</a> : '—') },
          { head: 'ADDRESS', cell: (l) => l.contact, exact: true },
          ...campaignColumn(view),
          { head: 'CALL', cell: (l) => l.call.title ?? '—', wrap: true },
          { head: 'THEY SAID', cell: (l) => (l.said ? saidLabel(l.said) : '—'), title: (l) => (l.said?.why ? `They wrote: "${l.said.why}"` : null) },
          { head: 'STATUS', cell: (l) => rowStatus(l) },
        ]} />
      {off.length ? (
        <Fold id="calls-off" title="CALLED OFF" stats={[`${off.length}`, 'THE LEADS STAY OPEN']} level={2}>
          <Sheet label="calls called off" rows={off} rowKey={(l) => l.id} rowName={(l) => l.name || l.contact} rowAttrs={(l) => ({ 'data-lead-id': l.id, 'data-call': 'off' })}
            detail={(l) => <Thread engine={engine} lead={l} />} detailLabel={(l) => `the messages with ${l.name || l.contact}`}
            columns={[
              { head: 'PERSON', cell: (l) => l.name || l.contact },
              { head: 'ADDRESS', cell: (l) => l.contact, exact: true },
              ...campaignColumn(view),
              { head: 'WAS FOR', cell: (l) => callWhen(l.callOff.at), sort: (l) => Date.parse(l.callOff.at), exact: true },
              { head: 'CALL', cell: (l) => l.callOff.title ?? '—', wrap: true },
              { head: 'CALLED OFF', cell: (l) => (l.callOff.offAt ? String(l.callOff.offAt).slice(0, 10) : '—') },
              { head: 'BY', cell: (l) => (l.callOff.by === 'operator' ? 'YOU' : l.callOff.by === 'calendar' ? 'YOUR CALENDAR' : 'YOUR SALES MEMBER') },
              { head: 'STATUS', cell: (l) => rowStatus(l) },
            ]} />
        </Fold>
      ) : null}
      <p className="spl-note label-data">A CALL COMES IN THREE WAYS: YOU ADD IT HERE, YOUR SALES MEMBER FILES ONE IT VERIFIED IN THE MAILBOX, OR IT IS READ FROM A CALENDAR YOU ADDED (HOUSE CALENDAR › YOUR CALENDARS). EVERY ONE IS ON YOUR HOUSE CALENDAR AND ANNOUNCED AN HOUR AND TEN MINUTES BEFORE. A CALL THAT MOVES OR IS CALLED OFF ON A CALENDAR YOU ADDED MOVES OR LEAVES HERE BY ITSELF, AND YOU ARE TOLD.</p>
    </>
  );
};
