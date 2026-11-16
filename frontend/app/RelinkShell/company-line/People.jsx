// People — the LEADS tab as ONE list (Design note, 2026-11-16: […]). A lead is a person
// with a status, so there is one row per person and nothing to open: who they are and their company, how to
// reach them and how sure that is, what they are to the house (changed in place), where they stand, where they
// came from, and anything due. The counts on the top line are the state; the row under it is the filters
// (SHOW · WHAT · FROM), each a press; a search narrows by any word. The words and the joins are people-view.js.

import { useState } from 'react';
import { Select } from '../Select.jsx';
import { UPKEEP_WORDS, upkeepAge } from './lead-engine-view.js';
import { STATE_WORDS, PROOF_SHORT, DUE_SHORT, kindWords, rowStatus, sourceWords, peopleRows, viewCounts, firstView, kindCounts, sourceCounts, narrow, peopleLine, contactsCsv, SCAN_ASK, SORT_ASK } from './people-view.js';

const SHOWN = 200;

const Picks = ({ name, picks, value, onPick, busy, what }) => (picks.length ? (
  <div className="cline-ppl-picks" role="group" aria-label={what}>
    <span className="cline-aud-k label-data">{name}</span>
    {picks.map((p) => (
      <button key={p.id} type="button" className={`sec-scan cline-mini label-data${value === p.id ? ' is-on' : ''}${p.tone && p.n ? ` is-${p.tone}` : ''}`} aria-pressed={value === p.id} disabled={busy}
        data-pick={`${name.toLowerCase()}:${p.id}`} aria-label={`${p.label} · ${p.n} — show only these`} onClick={() => onPick(p.id)}>{p.label} · {p.n}</button>
    ))}
  </div>
) : null);

const Person = ({ r, kinds, busy, onKind }) => {
  const [proof, tone] = STATE_WORDS[r.state] ?? [String(r.state).toUpperCase(), null];
  const note = r.lead?.last || r.found;
  const promised = r.due.find((d) => d.promised)?.promised;
  return (
    <li className="cline-ppl-row" data-person={r.key} data-lead-id={r.lead?.id} data-lead-kind={r.lead?.kind} data-contact-state={r.state}>
      <p className="cline-lead-who"><b>{r.name}</b>{r.title ? <span className="cline-lead-last"> · {r.title}</span> : null}{r.company ? <span className="cline-lead-last"> · {r.company}</span> : null}</p>
      <p className="cline-lead-state">{r.email || r.reach ? <span className="cline-exact">{r.email || r.reach} </span> : null}<span className={`cline-chip${tone ? ` is-${tone}` : ''}`} title={proof}>{PROOF_SHORT[r.state] ?? proof}</span></p>
      {r.lead ? (
        <Select ariaLabel={`${kindWords(r.lead.kind)} — file ${r.name} under`} value={kinds.includes(r.lead.kind) ? r.lead.kind : ''} placeholder="file under…" disabled={busy}
          onChange={(kind) => { if (kind !== r.lead.kind) onKind(r.lead, kind); }} options={kinds.map((k) => ({ value: k, label: kindWords(k) }))} />
      ) : <p className="cline-lead-state cline-lead-last">NOT A LEAD YET</p>}
      <p className="cline-lead-state">
        {r.lead ? <><span className="cline-chip" data-lead-status={r.lead.status}>{rowStatus(r.lead)}</span> <span className="cline-chip" data-lead-source={r.lead.channel} title="where this lead came from">{sourceWords(r.lead.channel)}</span> </> : null}
        {r.due.map((d) => <span key={d.kind} className="cline-chip is-alert" data-upkeep={d.kind} title={UPKEEP_WORDS[d.kind]}>{DUE_SHORT[d.kind] ?? UPKEEP_WORDS[d.kind]}{upkeepAge(d)} </span>)}
      </p>
      {note || promised ? (
        <p className="cline-ppl-note" title={note ?? ''}>{promised ? <span data-promised="">PROMISED: {promised}{note ? ' · ' : ''}</span> : null}{/^https:\/\//.test(String(note)) ? <a className="cline-link" href={note} target="_blank" rel="noreferrer noopener">{note}</a> : note}</p>
      ) : null}
    </li>
  );
};

/** @param {{engine: object, busy: boolean, onKind: Function, onRefresh: Function, holder?: ?object, onHand?: ?Function}} props */
export const People = ({ engine, busy, onKind, onRefresh, holder = null, onHand = null }) => {
  const rows = peopleRows(engine);
  const kinds = engine.leadKinds ?? [];
  const [pick, setPick] = useState({ view: null, kind: '', source: '', query: '' });
  const view = pick.view ?? firstView(rows);
  const shown = narrow(rows, { ...pick, view });
  const set = (key) => (id) => setPick((p) => ({ ...p, ...(key === 'view' ? { kind: '', source: '' } : {}), [key]: key !== 'view' && p[key] === id ? '' : id }));
  const unsorted = rows.filter((r) => r.lead?.kind === 'unsorted').length;
  const hand = holder && onHand;
  return (
    <div className="cline-ppl" data-people="">
      <div className="cline-ppl-head">
        <span className="fold-title label-data">LEADS</span>
        {peopleLine(rows, engine.contactStats).map((s) => (typeof s === 'string' ? { text: s } : s)).map((s) => <span key={s.text} className={`fold-stat label-data${s.tone ? ` is-${s.tone}` : ''}`} data-people-stat="">{s.text}</span>)}
      </div>
      <div className="cline-open">
        <input className="cline-input" aria-label="Search by name, title, company or address" placeholder="search a name, a title, a company, an address" value={pick.query} onChange={(e) => setPick((p) => ({ ...p, query: e.target.value }))} />
        {hand && unsorted ? <button type="button" className="sec-scan label-data" disabled={busy} aria-label={`SORT ${unsorted} — HAND TO ${holder.name}`} title={`${holder.name}'s chat opens with the ask drafted; you send it`} onClick={() => onHand(holder, SORT_ASK)}>SORT {unsorted} — HAND TO {holder.name.toUpperCase()}</button> : null}
        {hand ? <button type="button" className="sec-scan label-data" disabled={busy} aria-label={`SCAN THE MAILBOX — hand it to ${holder.name}`} title={`Finds people who wrote in and are on no list. It reads who wrote and the subject, never a body. ${holder.name}'s chat opens with the ask drafted; you send it`} onClick={() => onHand(holder, SCAN_ASK)}>SCAN THE MAILBOX</button> : null}
        {rows.length ? <a className="sec-scan label-data pos-step-link" download="contacts.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(contactsCsv(engine.contacts ?? []))}`}>SPREADSHEET</a> : null}
        <button type="button" className="sec-scan label-data" disabled={busy} onClick={onRefresh}>REFRESH</button>
      </div>
      {rows.length ? (
        <div className="cline-ppl-filters">
          <Picks name="SHOW" what="which people to show" picks={viewCounts(rows)} value={view} onPick={(id) => setPick((p) => ({ ...p, view: id, kind: '', source: '' }))} busy={busy} />
          <Picks name="WHAT" what="what they are to the house" picks={kindCounts(rows, view)} value={pick.kind} onPick={set('kind')} busy={busy} />
          <Picks name="FROM" what="where they came from" picks={sourceCounts(rows, view)} value={pick.source} onPick={set('source')} busy={busy} />
        </div>
      ) : null}
      {shown.length ? (
        <ul className="cline-lead-list" aria-label="people">
          {shown.slice(0, SHOWN).map((r) => <Person key={r.key} r={r} kinds={kinds} busy={busy} onKind={onKind} />)}
        </ul>
      ) : <p className="cline-move-t" data-people-empty="">{rows.length ? 'NOBODY MATCHES — CHANGE SHOW, WHAT, FROM OR THE SEARCH' : 'NOBODY YET — LEADS ARRIVE FROM YOUR CAMPAIGNS, YOUR MAILBOX AND YOUR SALES MEMBER'}</p>}
      {shown.length > SHOWN ? <p className="cline-move-t">SHOWING THE FIRST {SHOWN} OF {shown.length} — SEARCH OR NARROW TO SEE THE REST</p> : null}
    </div>
  );
};
