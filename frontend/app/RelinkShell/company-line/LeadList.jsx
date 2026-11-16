// LeadList — the house's lead list, filed by what each lead is to the house
// (Design note, 2026-11-16: […]). One line per kind (BUYERS, APPLICANTS, PARTNERS, …) with its
// counts; open, each lead with how to reach them, where it stands, and one
// control to re-file it. SCAN THE MAILBOX hands the search to the seat's
// holder: their chat opens with the ask drafted. Above the kinds, CAME FROM counts the same leads by the
// channel each arrived on (email, X, LinkedIn, …); a press shows only that channel's. Pure rendering
// but for which source is chosen.

import { Select } from '../Select.jsx';
import { Fold } from '../fold/Fold.jsx';
import { useState } from 'react';
import { KIND_WORDS, leadGroups, groupLine, listLine, statusWords, SCAN_ASK, SORT_ASK, sourceCounts, sourceWords, fromSource } from './lead-list-view.js';

const Lead = ({ lead, kinds, busy, onKind }) => (
  <li className="cline-lead" data-lead-id={lead.id} data-lead-kind={lead.kind}>
    <p className="cline-lead-who"><span className="cline-chip cline-lead-from" data-lead-source={lead.channel} title="where this lead came from">{sourceWords(lead.channel)}</span> <b>{lead.name || lead.contact}</b>{lead.name && lead.contact ? <span className="cline-exact"> · {lead.contact}</span> : null}</p>
    <p className="cline-lead-state"><span className={`cline-chip${lead.status === 'replied' ? ' is-alert' : ''}`}>{statusWords(lead)}</span>{lead.last ? <span className="cline-lead-last"> {lead.last}</span> : null}</p>
    <Select ariaLabel={`${KIND_WORDS[lead.kind]?.[0] ?? lead.kind} — file ${lead.name || lead.contact} under`} value={kinds.includes(lead.kind) ? lead.kind : ''} placeholder="file under…" disabled={busy}
      onChange={(kind) => { if (kind !== lead.kind) onKind(lead, kind); }} options={kinds.map((k) => ({ value: k, label: KIND_WORDS[k]?.[0] ?? k.toUpperCase() }))} />
  </li>
);

/** @param {{leads: object[], kinds: string[], busy: boolean, onKind: Function, holder?: ?object, onHand?: ?Function}} props */
export const LeadList = ({ leads, kinds, busy, onKind, holder = null, onHand = null }) => {
  // Two ways to read one list: by what each lead is (the folds), and by where it came from (the row of sources;
  // pressing one shows only its leads, pressing it again shows all).
  const [source, setSource] = useState('');
  const sources = sourceCounts(leads);
  const groups = leadGroups(fromSource(leads, source), kinds);
  return (
    <Fold id="leads:list" title="THE LEAD LIST" waits={groups.some((g) => g.owed || g.unsorted)} stats={listLine(groups)}>
      {holder && onHand ? (
        <div className="cline-open">
          <button type="button" className="sec-scan label-data" disabled={busy} aria-label={`SCAN THE MAILBOX FOR MISSED LEADS — hand it to ${holder.name}`} title={`${holder.name}'s chat opens with the ask drafted; you send it`}
            onClick={() => onHand(holder, SCAN_ASK)}>SCAN THE MAILBOX FOR MISSED LEADS</button>
          <p className="cline-move-t">It reads who wrote and the subject, never a body, and names everyone who is on no list.</p>
        </div>
      ) : null}
      {sources.length ? (
        <div className="cline-open" role="group" aria-label="where the leads came from" data-lead-sources="">
          <span className="cline-aud-k label-data">CAME FROM</span>
          {sources.map((s) => (
            <button key={s.channel} type="button" className={`sec-scan cline-mini label-data${source === s.channel ? ' is-on' : ''}`} aria-pressed={source === s.channel} disabled={busy}
              aria-label={`${s.label} · ${s.n} — show only leads that came from ${s.label}`} onClick={() => setSource(source === s.channel ? '' : s.channel)}>{s.label} · {s.n}</button>
          ))}
          {source ? <span className="cline-move-t" data-lead-source-on="">SHOWING ONLY {sourceWords(source)} — PRESS IT AGAIN FOR ALL</span> : null}
        </div>
      ) : null}
      {groups.length ? groups.map((g) => (
        <Fold key={g.kind} id={`leads:kind:${g.kind}`} level={2} title={g.label} waits={g.owed > 0 || g.unsorted} stats={groupLine(g)}>
          <p className="cline-move-t">{g.what}</p>
          {g.unsorted && holder && onHand ? (
            <div className="cline-open">
              <button type="button" className="sec-scan label-data" disabled={busy} aria-label={`SORT THEM — HAND TO ${holder.name}: all ${g.leads.length} not sorted yet`} title={`${holder.name}'s chat opens with the ask drafted; you send it`}
                onClick={() => onHand(holder, SORT_ASK)}>SORT THEM — HAND TO {holder.name.toUpperCase()}</button>
            </div>
          ) : null}
          <ul className="cline-lead-list" aria-label={`${g.label.toLowerCase()} on the lead list`}>
            {g.leads.map((l) => <Lead key={l.id} lead={l} kinds={kinds} busy={busy} onKind={onKind} />)}
          </ul>
        </Fold>
      )) : <p className="cline-move-t">NOBODY IS ON THE LEAD LIST YET</p>}
    </Fold>
  );
};
