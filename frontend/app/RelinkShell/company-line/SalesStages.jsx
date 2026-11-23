// SalesStages — what stands at the front of the line, one sheet a stage (Design note, 2026-11-18: […]).
// DISCOVER: the audiences, whether each may look, and what its searches found. FILTER: the companies found, by where
// the filter left them. VALIDATE: every company past the filter, its site checked, scored, its right person found,
// and the one decision that is the operator's here, APPROVE THE LIST. Pure rendering over sales-pipeline-view.js.

import { isWide } from '../../../../backend/services/sales/wide-search.js';
import { useState } from 'react';
import { Sheet } from '../sheet/Sheet.jsx';
import { Select } from '../Select.jsx';
import { STATE_WORDS, segmentMoves } from './lead-engine-view.js';
import { Pitch } from './LeadAudienceCard.jsx';
import { discoverRows, filterRows, validateRows, listApprovals, FILTER_PICKS, ALL, FIT_RANK, SITE_RANK, STANDING_RANK, STATE_RANK } from './sales-pipeline-view.js';
import { foundByLine, searchesOf, sourceRows, companyPartners, partnerOfCompany } from './sales-sources-view.js';

const n = (v) => Number(v || 0).toLocaleString('en-US');
const stateShort = (state) => String(STATE_WORDS[state] ?? state).split(' — ')[0];
// The campaign stands BEFORE its audience wherever an audience is named (Design note, 2026-11-21: […]).
const campaignColumn = (view, cell) => (view === ALL ? [{ head: 'CAMPAIGN', cell }] : []);
const dash = (v) => (v === null || v === undefined ? '—' : n(v));

// An audience's searches, newest first, each with the partner it ran at (Design note, 2026-11-18: […]).
const Searches = ({ engine, segmentId }) => {
  const list = searchesOf(engine, segmentId);
  if (!list.length) return null;
  return (
    <ul className="spl-detail" aria-label="its searches, newest first">
      {list.map((s, i) => (
        <li key={`${s.at}:${i}`} data-search-source={s.source}>{String(s.at ?? '').slice(0, 10)} · {s.partner} · {s.asked || 'no words recorded'} · {s.matched ? `${n(s.matched)} matched · ` : ''}{n(s.gathered)} gathered{isWide(s.matched) ? <b className="spl-wide-mark"> · TOO WIDE{s.gathered ? '' : ' — KEPT NOTHING'}</b> : null}</li>
      ))}
    </ul>
  );
};

/** WHO FOUND THEM — each partner's finds and how far they went down the line: which funnel helps most. */
const SourcesSheet = ({ engine, view }) => (
  <>
    <p className="spl-body-h label-data">WHO FOUND THEM — EACH PARTNER, WHAT IT GAVE, AND HOW FAR THAT WENT</p>
    <Sheet label="partners and how far their finds went" rows={sourceRows(engine, view)} rowKey={(s) => s.id} rowName={(s) => `${s.partner}, ${s.gave.toLowerCase()}`}
      rowAttrs={(s) => ({ 'data-partner': s.partner, 'data-gave': s.gave })}
      empty={<p className="spl-empty label-data">NOTHING FOUND YET</p>}
      columns={[
        { head: 'PARTNER', cell: (s) => s.partner },
        { head: 'GAVE', cell: (s) => s.gave },
        { head: 'FOUND', sort: (s) => s.found, cell: (s) => dash(s.found) },
        { head: 'SHORTLISTED', sort: (s) => s.shortlisted, cell: (s) => dash(s.shortlisted) },
        { head: 'A FIT', sort: (s) => s.fit, cell: (s) => dash(s.fit) },
        { head: 'LEADS', sort: (s) => s.leads, cell: (s) => n(s.leads) },
        { head: 'WRITTEN', sort: (s) => s.written, cell: (s) => n(s.written) },
        { head: 'REPLIED', sort: (s) => s.replied, cell: (s) => n(s.replied), tone: (s) => (s.replied ? 'on' : null) },
        { head: 'WON', sort: (s) => s.won, cell: (s) => n(s.won), tone: (s) => (s.won ? 'on' : null) },
        { head: 'CREDITS', sort: (s) => s.credits, cell: (s) => dash(s.credits), title: () => 'credits its lookups spent, over every campaign' },
      ]} />
  </>
);

/** DISCOVER — one row an audience. A draft waits for the operator's APPROVE; its pitch opens under the row. */
export const DiscoverStage = ({ engine, view, busy, onMove }) => (
  <>
  <Sheet label="audiences and what they found" rows={discoverRows(engine, view)} rowKey={(r) => r.id} rowName={(r) => r.segment.name}
    rowAttrs={(r) => ({ 'data-segment-id': r.id, 'data-segment-state': r.segment.state })}
    detail={(r) => <div className="spl-detail"><Pitch s={r.segment} /><Searches engine={engine} segmentId={r.id} /></div>} detailLabel={(r) => `the pitch and the searches of ${r.segment.name}`}
    empty={<p className="spl-empty label-data">NO AUDIENCE YET — THE SALES SEAT FILES ONE UNDER A CAMPAIGN</p>}
    columns={[
      ...campaignColumn(view, (r) => r.campaign),
      { head: 'AUDIENCE', cell: (r) => r.segment.name },
      { head: 'STATE', sort: (r) => STATE_RANK[r.segment.state] ?? null, cell: (r) => (r.segment.state === 'draft' ? 'WAITS FOR YOU' : stateShort(r.segment.state)), tone: (r) => (r.segment.state === 'draft' ? 'alert' : r.segment.state === 'approved' ? 'on' : null) },
      { head: 'SEARCHES', sort: (r) => r.searches, cell: (r) => n(r.searches) },
      { head: 'FOUND', sort: (r) => r.found, cell: (r) => n(r.found) },
      { head: 'FOUND BY', cell: (r) => foundByLine(r.row.gathered) || '—' },
      { head: 'NAMED PEOPLE AT', sort: (r) => r.named, cell: (r) => n(r.named), title: () => 'companies where Hunter holds named people' },
      { head: 'DECIDE', cell: (r) => (
        <span className="spl-acts">
          {segmentMoves(r.segment.state).map((m) => (
            <button key={m.state} type="button" className={`sec-scan cline-mini label-data${m.state === 'retired' ? ' cline-danger' : ''}`} disabled={busy}
              aria-label={`${m.label} ${r.segment.name}`} onClick={() => onMove(r.segment, m.state)}>{m.label}</button>
          ))}
        </span>
      ) },
    ]} />
  <SourcesSheet engine={engine} view={view} />
  </>
);

const Picks = ({ picks, value, onPick, counts }) => (
  <div className="spl-picks" role="group" aria-label="show the companies">
    {picks.map((p) => (
      <button key={p.id} type="button" className={`sec-scan cline-mini label-data${value === p.id ? ' is-on' : ''}`} aria-pressed={value === p.id}
        data-pick={`filter:${p.id}`} onClick={() => onPick(p.id)}>{p.label} · {n(counts[p.id])}</button>
    ))}
  </div>
);

/** FILTER — the companies found, by where the filter left them; the most addresses at Hunter first. */
export const FilterStage = ({ engine, view }) => {
  const [pick, setPick] = useState('unsorted');
  const counts = Object.fromEntries(FILTER_PICKS.map((p) => [p.id, filterRows(engine, view, p.id).length]));
  const rows = filterRows(engine, view, pick);
  return (
    <>
      <Picks picks={FILTER_PICKS} value={pick} onPick={setPick} counts={counts} />
      <Sheet label="companies at the filter" rows={rows} rowKey={(c) => `${c.segmentId}:${c.domain}`} rowName={(c) => c.name}
        rowAttrs={(c) => ({ 'data-company': c.domain })}
        detail={(c) => (c.shortlistWhy || c.description ? <p className="spl-detail">{c.shortlistWhy || c.description}</p> : null)} detailLabel={(c) => `why ${c.name}`}
        empty={<p className="spl-empty label-data">NOTHING HERE</p>}
        columns={[
          { head: 'COMPANY', cell: (c) => c.name },
          { head: 'DOMAIN', cell: (c) => c.domain, exact: true },
          ...campaignColumn(view, (c) => c.campaign),
          { head: 'AUDIENCE', cell: (c) => c.audience },
          { head: 'FOUND BY', cell: (c) => partnerOfCompany(c) },
          { head: 'AT HUNTER', sort: (c) => (c.hunterEmails ? Number(c.hunterEmails.total) || 0 : null), cell: (c) => (c.hunterEmails ? n(Number(c.hunterEmails.total) || 0) : '—') },
          { head: 'NAMED', sort: (c) => (c.hunterEmails ? Number(c.hunterEmails.personal) || 0 : null), cell: (c) => (c.hunterEmails ? n(Number(c.hunterEmails.personal) || 0) : '—') },
          { head: 'SIZE', cell: (c) => c.size ?? '—' },
        ]} />
    </>
  );
};

const Why = ({ p }) => (
  <ul className="spl-detail" aria-label={`why ${p.name} was scored so`}>
    {[...(p.fit ?? []), ...(p.misfit ?? []).map((s) => ({ ...s, criterion: `NOT A FIT IF: ${s.criterion}` }))].map((s) => (
      <li key={s.criterion}>{s.criterion} — {s.score}/5: {s.reasoning}</li>
    ))}
    {p.source ? <li>FOUND ON <a className="cline-link" href={p.source} target="_blank" rel="noreferrer noopener">{p.source}</a></li> : null}
  </ul>
);

// The operator's hands on one company (Design note, 2026-11-18: […]): one waiting for the list is taken off before the list is approved; one on
// the approved list is taken off it; any scored one is moved under another audience, or removed (a lead is closed with
// it, anything staged to it withdrawn); one not scored yet is passed over. Removing asks twice.
const CompanyHands = ({ row, audiences, busy, onHand, onPass }) => {
  const [sure, setSure] = useState(false);
  const [moving, setMoving] = useState(false);
  const others = audiences.filter((a) => a.id !== row.segmentId);
  const remove = () => {
    if (!sure) { setSure(true); return; }
    setSure(false);
    if (row.kind === 'candidate') onPass(row, 'removed by the operator at validation');
    else onHand(row, { move: 'drop', reason: row.waits ? 'not this one — taken off by the operator before it was validated' : 'removed by the operator: not a fit' }, `${row.name} is removed${row.prospect?.leadId ? ': its lead is closed and anything staged to it withdrawn' : ''}.`);
  };
  const removeWord = row.waits ? 'NOT THIS ONE' : 'REMOVE';
  return (
    <span className="spl-acts">
      <button type="button" className="sec-scan cline-mini cline-danger label-data" disabled={busy} aria-label={`${sure ? 'PRESS AGAIN TO' : ''} ${removeWord} — ${row.name}`.trim()} onClick={remove}>{sure ? `PRESS AGAIN — ${removeWord}` : removeWord}</button>
      {row.kind === 'prospect' && row.listed ? (
        <button type="button" className="sec-scan cline-mini label-data" disabled={busy} aria-label={`TAKE OFF THE LIST — ${row.name}`}
          onClick={() => onHand(row, { move: 'unlist' }, `${row.name} is off the approved list: its emails ask you again.`)}>TAKE OFF THE LIST</button>
      ) : null}
      {row.kind === 'prospect' && others.length ? (moving ? (
        <Select ariaLabel={`move ${row.name} under another audience`} value="" disabled={busy} placeholder="move it under…"
          options={others.map((a) => ({ value: a.id, label: a.name }))}
          onChange={(segmentId) => { setMoving(false); onHand(row, { move: 'move', segmentId }, `${row.name} now stands under "${others.find((a) => a.id === segmentId)?.name}".`); }} />
      ) : <button type="button" className="sec-scan cline-mini label-data" disabled={busy} aria-label={`MOVE ${row.name} under another audience`} onClick={() => setMoving(true)}>MOVE</button>) : null}
    </span>
  );
};

/** VALIDATE — every company past the filter, what waits on the operator first, and their hands on each. */
export const ValidateStage = ({ engine, view, busy, onList, onHand, onPass }) => {
  const approvals = listApprovals(engine, view);
  const audiences = (engine?.segments ?? []).filter((x) => x.state !== 'retired');
  const foundBy = companyPartners(engine);
  return (
    <>
      {approvals.length ? (
        <p className="spl-note label-data" data-list-waits="">{n(approvals.reduce((t, a) => t + a.count, 0))} COMPANIES WAIT TO BE VALIDATED ({approvals.map((a) => `${a.count} · ${a.segment.name}`).join('; ')}). YOU APPROVE NO LIST: START A LEAD RUN ABOVE AND IT VALIDATES EVERY ONE FROM ITS OWN PAGE, THEN GOES ON TO FILE LEADS.</p>
      ) : null}
      <Sheet label="companies being validated" rows={validateRows(engine, view)} rowKey={(r) => `${r.kind}:${r.id}`} rowName={(r) => r.name}
        rowAttrs={(r) => ({ ...(r.kind === 'prospect' ? { 'data-prospect-id': r.id } : { 'data-company': r.domain }), ...(r.waits ? { 'data-waits': '1' } : {}) })}
        detail={(r) => (r.prospect ? <Why p={r.prospect} /> : null)} detailLabel={(r) => `why ${r.name} was scored so`}
        empty={<p className="spl-empty label-data">NOTHING PAST THE FILTER YET</p>}
        columns={[
          { head: 'COMPANY', cell: (r) => r.name },
          { head: 'DOMAIN', cell: (r) => r.domain, exact: true },
          ...campaignColumn(view, (r) => r.campaign),
          { head: 'AUDIENCE', cell: (r) => r.audience },
          { head: 'FOUND BY', cell: (r) => foundBy(r.segmentId, r.domain) },
          { head: 'SITE', sort: (r) => SITE_RANK[r.site] ?? null, cell: (r) => r.site, tone: (r) => (r.site === 'DEAD' ? 'alert' : r.site === 'ALIVE' ? 'on' : null) },
          { head: 'FIT', sort: (r) => FIT_RANK[r.fit] ?? null, cell: (r) => r.fit, tone: (r) => (r.fit === 'STRONG MATCH' ? 'on' : null) },
          { head: 'PERSON', cell: (r) => (r.person ? `${r.person.name}, ${r.person.role}` : '—') },
          { head: 'NEXT', sort: (r) => STANDING_RANK[r.standing] ?? null, cell: (r) => r.standing, tone: (r) => (r.waits ? 'alert' : r.standing === 'ON THE LIST' ? 'on' : null) },
          ...(onHand ? [{ head: 'DECIDE', cell: (r) => <CompanyHands row={r} audiences={audiences} busy={busy} onHand={onHand} onPass={onPass} /> }] : []),
        ]} />
    </>
  );
};
