// People — the LEADS tab as ONE SHEET (Design note, 2026-11-16: […]; earlier: […]). A lead is a person
// with a status, so there is one row per person and nothing to open: who they are and their company, how to
// reach them and how sure that is, what they are to the house (changed in place), where they stand, where they
// came from, and anything due. The counts on the top line are the state; the row under it is the filters
// (SHOW · WHAT · FROM), each a press; a search narrows by any word. The words and the joins are people-view.js.

import { useState } from 'react';
import { Select } from '../Select.jsx';
import { Sheet } from '../sheet/Sheet.jsx';
import { UPKEEP_WORDS, upkeepAge } from './lead-engine-view.js';
import { STATE_WORDS, PROOF_SHORT, DUE_SHORT, kindWords, rowStatus, sourceWords, peopleRows, viewCounts, firstView, kindCounts, sourceCounts, narrow, peopleLine, contactsCsv, SCAN_ASK, SORT_ASK } from './people-view.js';

const Picks = ({ name, picks, value, onPick, busy, what }) => (picks.length ? (
  <div className="cline-ppl-picks" role="group" aria-label={what}>
    <span className="cline-aud-k label-data">{name}</span>
    {picks.map((p) => (
      <button key={p.id} type="button" className={`sec-scan cline-mini label-data${value === p.id ? ' is-on' : ''}${p.tone && p.n ? ` is-${p.tone}` : ''}`} aria-pressed={value === p.id} disabled={busy}
        data-pick={`${name.toLowerCase()}:${p.id}`} aria-label={`${p.label} · ${p.n} — show only these`} onClick={() => onPick(p.id)}>{p.label} · {p.n}</button>
    ))}
  </div>
) : null);

// One narrowing control in the sheet's own toolbar: everything, or one kind (or one source), each with its count.
const Narrow = ({ all, picks, value, onPick, busy }) => (picks.length > 1 || value ? (
  <Select ariaLabel={`${value ? picks.find((p) => p.id === value)?.label ?? all : all} — narrow the sheet`} value={value} placeholder={all} disabled={busy}
    onChange={onPick} options={[{ value: '', label: all }, ...picks.map((p) => ({ value: p.id, label: `${p.label} · ${p.n}` }))]} />
) : null);

// One person, one line; every column one fact (sheet/Sheet.jsx). The note (the last thing said, or where they were
// found) opens under the row.
const noteOf = (r) => r.lead?.last || r.found || null;
const promisedOf = (r) => r.due.find((d) => d.promised)?.promised ?? null;
const columnsFor = ({ kinds, busy, onKind }) => [
  { head: 'NAME', cell: (r) => r.name },
  { head: 'COMPANY', cell: (r) => r.company || null },
  { head: 'TITLE', cell: (r) => r.title || null },
  { head: 'EMAIL OR REACH', cell: (r) => r.email || r.reach || null, exact: true, attrs: () => ({ 'data-person-reach': '' }) },
  { head: 'PROOF', cell: (r) => PROOF_SHORT[r.state] ?? String(r.state).toUpperCase(), tone: (r) => STATE_WORDS[r.state]?.[1] ?? null, title: (r) => STATE_WORDS[r.state]?.[0] ?? null },
  { head: 'FILED AS', cell: (r) => (r.lead ? (
    <Select ariaLabel={`${kindWords(r.lead.kind)} — file ${r.name} under`} value={kinds.includes(r.lead.kind) ? r.lead.kind : ''} placeholder="file under…" disabled={busy}
      onChange={(kind) => { if (kind !== r.lead.kind) onKind(r.lead, kind); }} options={kinds.map((k) => ({ value: k, label: kindWords(k) }))} />
  ) : 'NOT A LEAD') },
  { head: 'STANDS', cell: (r) => (r.lead ? rowStatus(r.lead) : null), attrs: (r) => ({ 'data-lead-status': r.lead?.status }) },
  { head: 'FROM', cell: (r) => (r.lead ? sourceWords(r.lead.channel) : null), attrs: (r) => ({ 'data-lead-source': r.lead?.channel }) },
  { head: 'DUE', tone: (r) => (r.due.length ? 'alert' : null), cell: (r) => (r.due.length
    ? r.due.map((d) => <span key={d.kind} data-upkeep={d.kind} title={[UPKEEP_WORDS[d.kind], promisedOf(r) ? `PROMISED: ${promisedOf(r)}` : null].filter(Boolean).join(' — ')}>{DUE_SHORT[d.kind] ?? UPKEEP_WORDS[d.kind]}{upkeepAge(d)} </span>)
    : null) },
];
const Note = ({ r }) => {
  const note = noteOf(r);
  return <>{promisedOf(r) ? <span data-promised="">PROMISED: {promisedOf(r)} · </span> : null}{/^https:\/\//.test(String(note)) ? <a className="cline-link" href={note} target="_blank" rel="noreferrer noopener">{note}</a> : note}</>;
};

/** @param {{engine: object, busy: boolean, onKind: Function, onRefresh: Function, holder?: ?object, onHand?: ?Function}} props */
export const People = ({ engine, busy, onKind, onRefresh, holder = null, onHand = null }) => {
  const rows = peopleRows(engine);
  const kinds = engine.leadKinds ?? [];
  const [pick, setPick] = useState({ view: null, kind: '', source: '', query: '' });
  const view = pick.view ?? firstView(rows);
  const shown = narrow(rows, { ...pick, view });
  const unsorted = rows.filter((r) => r.lead?.kind === 'unsorted').length;
  const hand = holder && onHand;
  return (
    <div className="cline-ppl" data-people="">
      <div className="cline-ppl-head">
        <span className="fold-title label-data">LEADS</span>
        {peopleLine(rows, engine.contactStats).map((s) => (typeof s === 'string' ? { text: s } : s)).map((s) => <span key={s.text} className={`fold-stat label-data${s.tone ? ` is-${s.tone}` : ''}`} data-people-stat="">{s.text}</span>)}
      </div>
      {rows.length ? <Picks name="SHOW" what="which people to show" picks={viewCounts(rows)} value={view} onPick={(id) => setPick((p) => ({ ...p, view: id, kind: '', source: '' }))} busy={busy} /> : null}
      <div className="cline-open cline-ppl-tools">
        <input className="cline-input" aria-label="Search by name, title, company or address" placeholder="search a name, a title, a company, an address" value={pick.query} onChange={(e) => setPick((p) => ({ ...p, query: e.target.value }))} />
        <Narrow all="ALL KINDS" picks={kindCounts(rows, view)} value={pick.kind} onPick={(id) => setPick((p) => ({ ...p, kind: id }))} busy={busy} />
        <Narrow all="ALL SOURCES" picks={sourceCounts(rows, view)} value={pick.source} onPick={(id) => setPick((p) => ({ ...p, source: id }))} busy={busy} />
        {hand && unsorted ? <button type="button" className="sec-scan cline-mini label-data" disabled={busy} aria-label={`SORT ${unsorted} — HAND TO ${holder.name}`} title={`${holder.name}'s chat opens with the ask drafted; you send it`} onClick={() => onHand(holder, SORT_ASK)}>SORT {unsorted} — HAND TO {holder.name.toUpperCase()}</button> : null}
        {hand ? <button type="button" className="sec-scan cline-mini label-data" disabled={busy} aria-label={`SCAN MAILBOX — hand it to ${holder.name}`} title={`Finds people who wrote in and are on no list. It reads who wrote and the subject, never a body. ${holder.name}'s chat opens with the ask drafted; you send it`} onClick={() => onHand(holder, SCAN_ASK)}>SCAN MAILBOX</button> : null}
        {rows.length ? <a className="sec-scan cline-mini label-data pos-step-link" download="contacts.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(contactsCsv(engine.contacts ?? []))}`}>SPREADSHEET</a> : null}
        <button type="button" className="sec-scan cline-mini label-data" disabled={busy} onClick={onRefresh}>REFRESH</button>
      </div>
      <Sheet label="people" columns={columnsFor({ kinds, busy, onKind })} rows={shown} rowKey={(r) => r.key} rowName={(r) => r.name}
        rowAttrs={(r) => ({ 'data-person': r.key, 'data-lead-id': r.lead?.id, 'data-lead-kind': r.lead?.kind, 'data-contact-state': r.state })}
        detail={(r) => (noteOf(r) ? <Note r={r} /> : null)} detailLabel={() => 'the note on this person'}
        empty={<p className="cline-move-t" data-people-empty="">{rows.length ? 'NOBODY MATCHES — CHANGE SHOW, THE KIND, THE SOURCE OR THE SEARCH' : 'NOBODY YET — LEADS ARRIVE FROM YOUR CAMPAIGNS, YOUR MAILBOX AND YOUR SALES MEMBER'}</p>} />
    </div>
  );
};
