// LeadFactsSheet — the Mercator's sales facts on the LEAD ENGINE section:
// what a buyer may be told, under the company each fact is true of, each with
// its source, and the operator's hands on it (Design note, 2026-11-15: […];
// […]). One bar over the sheet: CHECK ALL, APPROVE
// ALL, APPROVE CHECKED (the rest go back to the seat to fix), RETURN ALL with
// what should change. Each company's facts are a sheet, one fact a line: a tick,
// its words, its figure, its source, where it stands, EDIT, DELETE, ASK the holder.
// No email reaches a lead before facts are approved, and every number in one
// must stand on an approved fact. Pure rendering but for the drafts and ticks.

import { useState } from 'react';
import { Fold } from '../fold/Fold.jsx';
import { Sheet } from '../sheet/Sheet.jsx';
import { sheetState, factsByCompany, factAsk, editReady, startChecked, factStanding, checkedWords, reviewWords, sheetStats, groupStats } from './lead-facts-view.js';

const SourceOf = ({ source }) => (/^https:\/\//.test(source)
  ? <a className="cline-link" href={source} target="_blank" rel="noreferrer noopener">{source}</a>
  : <span className="cline-exact">{source}</span>);

const STANDING = Object.freeze({ approved: 'APPROVED', held: 'NOT APPROVED — TO FIX' });

// One company's facts as a sheet (sheet/Sheet.jsx): one fact a line; its words read whole in their own column, and
// its figure, its source, where it stands and the operator's hands each have a column of their own. EDIT turns that
// row's words and source into boxes in place.
const FactSheet = ({ group, sheet, facts, busy, holder, ticked, onCheck, onChange, onHand }) => {
  const [edit, setEdit] = useState(null); // {n, claim, source} while one fact is being edited
  const [sure, setSure] = useState(null); // the fact whose DELETE was pressed once
  const editing = (fact) => edit?.n === fact.n;
  const columns = [
    { head: '#', cell: (fact) => fact.n },
    ...(onCheck ? [{ head: 'OK', cell: (fact) => <input type="checkbox" className="cline-fact-tick" aria-label={`Approve fact ${fact.n}`} disabled={busy} checked={ticked.includes(fact.n)} onChange={() => onCheck(fact.n)} /> }] : []),
    { head: 'WHAT MAY BE SAID', wrap: true, cell: (fact) => (editing(fact)
      ? <textarea className="cline-input cline-fact-edit" rows={3} maxLength={400} aria-label={`Fact ${fact.n}, the words`} disabled={busy} value={edit.claim} onChange={(e) => setEdit({ ...edit, claim: e.target.value })} />
      : <span className="cline-fact-claim">{fact.claim}</span>) },
    { head: 'FIGURE', cell: (fact) => (fact.figure ? <span className="cline-fact-figure">{fact.figure.value} {fact.figure.unit}</span> : null) },
    { head: 'SOURCE', exact: true, title: (fact) => fact.source, cell: (fact) => (editing(fact)
      ? <input className="cline-input" maxLength={300} aria-label={`Fact ${fact.n}, where it comes from`} disabled={busy} value={edit.source} onChange={(e) => setEdit({ ...edit, source: e.target.value })} />
      : <span className="cline-fact-source"><SourceOf source={fact.source} /></span>) },
    { head: 'STANDS', tone: (fact) => ({ approved: 'on', held: 'alert' }[factStanding(facts, fact)] ?? null), cell: (fact) => STANDING[factStanding(facts, fact)] ?? null },
    ...(onChange ? [{ head: 'CHANGE', cell: (fact) => (editing(fact) ? (
      <span className="cline-fact-hands">
        <button type="button" className="sec-scan cline-mini label-data" disabled={busy || !editReady(edit, fact)} aria-label={`SAVE fact ${fact.n}`}
          onClick={() => { onChange(sheet, { n: fact.n, claim: edit.claim.trim(), source: edit.source.trim() }, `Fact ${fact.n} is changed. The sheet waits for your approval.`); setEdit(null); }}>SAVE</button>
        <button type="button" className="sec-scan cline-mini label-data" disabled={busy} onClick={() => setEdit(null)}>CANCEL</button>
      </span>
    ) : (
      <span className="cline-fact-hands">
        <button type="button" className="sec-scan cline-mini label-data" disabled={busy} aria-label={`EDIT fact ${fact.n}`} onClick={() => setEdit({ n: fact.n, claim: fact.claim, source: fact.source })}>EDIT</button>
        <button type="button" className="sec-scan cline-mini cline-danger label-data" disabled={busy} aria-label={`${sure === fact.n ? 'PRESS AGAIN TO DELETE' : 'DELETE'} fact ${fact.n}`}
          onClick={() => { if (sure === fact.n) onChange(sheet, { n: fact.n, remove: true }, `Fact ${fact.n} is taken off. The sheet waits for your approval.`); setSure(sure === fact.n ? null : fact.n); }}>{sure === fact.n ? 'PRESS AGAIN TO DELETE' : 'DELETE'}</button>
        {holder && onHand ? <button type="button" className="sec-scan cline-mini label-data" disabled={busy} aria-label={`ASK ${holder.name} about fact ${fact.n}`} title={`${holder.name}'s chat opens with the question drafted; you send it`} onClick={() => onHand(holder, factAsk(fact))}>ASK {holder.name.toUpperCase()}</button> : null}
      </span>
    )) }] : []),
  ];
  return (
    <Sheet label={`facts about ${group.name}`} columns={columns} rows={group.facts} rowKey={(fact) => `${sheet.id}:${fact.n}`} rowName={(fact) => `fact ${fact.n}`}
      rowAttrs={(fact) => ({ 'data-fact': fact.n, 'data-fact-standing': factStanding(facts, fact) ?? '' })} />
  );
};

/**
 * @param {{facts: ?{sheet: ?object, review: ?object, approved: ?object}, companies?: object[], busy: boolean,
 *   onReview: (sheet: object, verdict: 'approved'|'returned', note?: string, only?: number[]) => void,
 *   onChange?: (sheet: object, change: object, said: string) => void, holder?: ?object, onHand?: ?Function}} props
 */
export const LeadFactsSheet = ({ facts, companies = [], busy, onReview, onChange = null, holder = null, onHand = null }) => {
  const [note, setNote] = useState('');
  const [ticked, setTicked] = useState(() => startChecked(facts));
  const sheet = facts?.sheet ?? null;
  const open = Boolean(sheet) && !facts.review; // the sheet waits: the ticks and the bar are live
  const all = sheet?.facts.map((f) => f.n) ?? [];
  const toggle = (n) => setTicked((t) => (t.includes(n) ? t.filter((x) => x !== n) : [...t, n]));
  const setMany = (ns, on) => setTicked((t) => (on ? [...new Set([...t, ...ns])] : t.filter((x) => !ns.includes(x))));
  return (
    <div data-facts-sheet={sheet?.id ?? ''}>
      <Fold id="company:facts" title="WHAT A BUYER MAY BE TOLD" waits={open} stats={sheetStats(facts)}>
      <p className="cline-move-t" data-facts-state="">{sheetState(facts)}</p>
      {sheet ? (
        <>
          {reviewWords(facts) ? <p className="cline-move-t" data-facts-review="">{reviewWords(facts)}</p> : null}
          {open ? (
            <div className="cline-fact-bar" data-facts-bar="">
              <label className="cline-fact-all label-data"><input type="checkbox" className="cline-fact-tick" disabled={busy} checked={ticked.length === all.length} onChange={(e) => setMany(all, e.target.checked)} /> CHECK ALL · <span data-facts-checked="">{checkedWords(ticked.length, all.length)}</span></label>
              <button type="button" className="sec-scan label-data" disabled={busy} aria-label={`APPROVE ALL (${all.length}) — every fact on the sheet`} onClick={() => onReview(sheet, 'approved')}>APPROVE ALL ({all.length})</button>
              <button type="button" className="sec-scan label-data" disabled={busy || !ticked.length || ticked.length === all.length} aria-label={`APPROVE CHECKED (${ticked.length}) · REST GO BACK — the other ${all.length - ticked.length} go to the sales seat to fix`}
                title="The facts you ticked stand. The rest go back to the sales seat to fix." onClick={() => onReview(sheet, 'approved', note.trim() || undefined, ticked)}>APPROVE CHECKED ({ticked.length}) · REST GO BACK</button>
              <input className="cline-input" aria-label="What should change before you approve" placeholder="What should change" disabled={busy}
                value={note} onChange={(e) => setNote(e.target.value)} />
              <button type="button" className="sec-scan cline-danger label-data" disabled={busy || note.trim().length < 5} aria-label="RETURN ALL — send the whole sheet back"
                onClick={() => { onReview(sheet, 'returned', note.trim()); setNote(''); }}>RETURN ALL</button>
            </div>
          ) : null}
          {factsByCompany(sheet, companies).map((group) => {
            const ns = group.facts.map((f) => f.n);
            const on = ns.every((n) => ticked.includes(n));
            return (
              <section key={group.id} className="cline-fact-group" aria-label={`facts about ${group.name}`} data-fact-company={group.id}>
                <Fold id={`facts:${group.id}`} level={2} title={group.name.toUpperCase()} waits={open} stats={groupStats(group, facts, ticked)}>
                {open ? (
                  <label className="cline-fact-all label-data">
                    <input type="checkbox" className="cline-fact-tick" aria-label={`Check every fact about ${group.name}`} disabled={busy} checked={on} onChange={(e) => setMany(ns, e.target.checked)} />
                    CHECK ALL OF {group.name.toUpperCase()}
                  </label>
                ) : null}
                <FactSheet group={group} sheet={sheet} facts={facts} busy={busy} holder={holder} ticked={ticked} onCheck={open ? toggle : null} onChange={onChange} onHand={onHand} />
                </Fold>
              </section>
            );
          })}
          {facts.approved && facts.approved.id !== sheet.id ? <p className="cline-move-t">Until this one is approved, emails are checked against the facts you approved before.</p> : null}
        </>
      ) : null}
      </Fold>
    </div>
  );
};
