// LeadAudienceCard — one audience on the leads screen, read at a glance (Founder,
// 2026-11-15: […]). The same
// data as before, carried by marks instead of sentences: the pool as count
// tiles, the offer and the problem side by side, who and where as chips, the
// signs of a fit as a ticked list and the signs of a misfit as a crossed one.
// Only the long […] folds. The operator's APPROVE / PAUSE / RETIRE and
// APPROVE THE LIST stand in the head and under the tiles. Pure rendering.

import { AudienceRequires } from './AudienceRequires.jsx';
import { MATCH_WORDS, STATE_WORDS, LIST_WORDS, segmentMoves, roadSteps } from './lead-engine-view.js';
import { AudienceCompanies } from './AudienceCompanies.jsx';
import { poolTiles, chipsOf, poolWords, audienceWaits } from './lead-audience-view.js';

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

const Chips = ({ label, items, attr }) => (items.length ? (
  <div className="cline-aud-chips" {...(attr ? { [attr]: '' } : {})}>
    <span className="cline-aud-k label-data">{label}</span>
    {items.map((item) => <span key={item} className="cline-chip">{item}</span>)}
  </div>
) : null);

const Signs = ({ title, items, mark, tone }) => (items.length ? (
  <div className={`cline-aud-signs is-${tone}`}>
    <p className="cline-aud-k label-data">{title}</p>
    <ul aria-label={title.toLowerCase()}>
      {items.map((item) => <li key={item}><span className="cline-aud-mark" aria-hidden="true">{mark}</span>{item}</li>)}
    </ul>
  </div>
) : null);

// The audience's own data, in the order it is read: what waits on the operator, the pitch, then the companies.
const Moves = ({ s, busy, onMove }) => (
  <div className="cline-open">
    {segmentMoves(s.state).map((m) => (
      <button key={m.state} type="button" className={`sec-scan label-data${m.state === 'retired' ? ' cline-danger' : ''}`} disabled={busy}
        aria-label={`${m.label} ${s.name}`} onClick={() => onMove(s, m.state)}>{m.label}</button>
    ))}
  </div>
);

// THE PIPELINE, drawn: the eight steps every audience walks, each with its count; the next one marked,
// and the one that is the operator's (APPROVE) marked when it waits on them.
const Road = ({ road }) => (
  <div className="cline-road" data-pipeline="">
    <ol className="cline-road-steps" aria-label="the pipeline, step by step">
      {roadSteps(road).map((step, i) => (
        <li key={step.id} className={`cline-road-step${step.next ? ' is-next' : ''}${step.you ? ' is-you' : ''}`} data-step={step.id} aria-current={step.next ? 'step' : undefined}>
          <span className="cline-road-n label-data">{i + 1} {step.label}</span>
          <span className="cline-road-w">{step.words}</span>
        </li>
      ))}
    </ol>
    {road.next ? <p className="cline-road-next label-data" data-pipeline-next="">NEXT · {road.next.words}</p> : null}
  </div>
);

// No list to approve (Design note, 2026-11-21: what waits is validated by a lead run, from each company's own page.
const ListApproval = ({ ids }) => (ids.length ? (
  <div className="cline-open" data-list-waits={ids.length}>
    <p className="cline-move-t">{ids.length} COMPAN{ids.length === 1 ? 'Y WAITS' : 'IES WAIT'} TO BE VALIDATED — A LEAD RUN DOES IT. {LIST_WORDS}</p>
  </div>
) : null);

export const Pitch = ({ s }) => (
  <>
    <div className="cline-aud-two">
      <div><p className="cline-aud-k label-data">THE OFFER</p><p className="cline-aud-text">{s.offer}</p></div>
      <div><p className="cline-aud-k label-data">THEIR PROBLEM</p><p className="cline-aud-text">{s.customerProblem}</p></div>
    </div>
    <Chips label="FOR" items={s.company ? [s.company.toUpperCase()] : []} />
    <Chips label="REACH" items={chipsOf(s.targetRole)} />
    {(s.countries ?? []).length
      ? <Chips label="SENT ONLY TO" items={s.countries} attr="data-countries" />
      : <p className="cline-move-t" data-countries="">NO COUNTRY NAMED — NOTHING CAN BE SENT</p>}
    <Chips label="SIZE" items={s.targetCompanySize ? [s.targetCompanySize] : []} />
    <Chips label="LIKE" items={s.exampleClients ?? []} />
    {/* What MUST be true of a company: a hard condition, proved from its own words, never averaged with the signs below. */}
    {(s.required ?? []).length ? (
      <div className="cline-aud-signs is-must" data-required="">
        <p className="cline-aud-k label-data">MUST BE TRUE — PROVED FROM THE COMPANY&apos;S OWN WORDS, OR IT IS NOT WRITTEN TO</p>
        <ul aria-label="must be true">
          {s.required.map((r) => (
            <li key={r.sign}><span className="cline-aud-mark" aria-hidden="true">■</span>{r.sign}
              <span className="cline-aud-must-how"> · proved by {r.evidence.map((w) => `“${w}”`).join(' or ')} in its own words{r.otherwise ? ` · if not, it goes to ${r.otherwiseName ? `“${r.otherwiseName}”` : `audience ${r.otherwise}`}` : ''}</span>
            </li>
          ))}
        </ul>
      </div>
    ) : null}
    <AudienceRequires segment={s} />
    <div className="cline-aud-two">
      <Signs title="FITS IF" items={s.positiveCriteria ?? []} mark="✓" tone="fit" />
      <Signs title="NOT A FIT IF" items={s.negativeCriteria ?? []} mark="✕" tone="misfit" />
    </div>
    {s.why ? <details className="cline-aud-why"><summary className="cline-aud-k label-data">WHY THEM</summary><p className="cline-aud-text">{s.why}</p></details> : null}
  </>
);

/**
 * @param {{row: {segment: object, pool: object[], leads?: object[], counts: object, listableIds: string[]}, busy: boolean, onMove: Function, onList: Function,
 *   mode?: 'full' | 'nested'}} props — nested: folded under its campaign (one line; a press opens the pitch, the
 *   companies and the leads; it stands open while it waits on the operator)
 */
export const LeadAudienceCard = ({ row, busy, onMove, onList, onRead = null, mode = 'full' }) => {
  const { segment: s, pool, leads = [], gathered = [], counts, listableIds } = row;
  if (mode === 'nested') {
    return (
      <li className="cline-aud is-nested" data-segment-id={s.id} data-segment-state={s.state}>
        <details open={audienceWaits(row)}>
          <summary className="cline-aud-sum">
            <span className="cline-aud-name label-data">AUDIENCE · {s.name}</span>
            <span className={`cline-chip${s.state === 'approved' ? ' is-on' : ''}`} data-state-words="">{STATE_WORDS[s.state]}</span>
            <span className="cline-aud-count label-data" data-pool-counts="">{poolWords(pool, counts)}</span>
          </summary>
          <div className="cline-aud-in">
            {row.road ? <Road road={row.road} /> : null}
            <Moves s={s} busy={busy} onMove={onMove} />
            <ListApproval s={s} ids={listableIds} busy={busy} onList={onList} />
            {/* The one list of this audience's companies; a scored one opens to why, and who was read. */}
            <AudienceCompanies segment={s} gathered={gathered} pool={pool} leads={leads} busy={busy} onRead={onRead}
              detailOf={(domain) => { const p = [...leads, ...pool].find((x) => x.domain === domain); return p ? <ul className="cline-ws-src"><Prospect p={p} /></ul> : null; }} />
            <details className="cline-aud-why" open={s.state === 'draft'}>
              <summary className="cline-aud-k label-data">THE PITCH — THE OFFER, WHO IT REACHES, WHAT MAKES A FIT</summary>
              <Pitch s={s} />
            </details>
          </div>
        </details>
      </li>
    );
  }
  return (
    <li className="cline-sec cline-aud" data-segment-id={s.id} data-segment-state={s.state}>
      <div className="cline-aud-head">
        <p className="cline-h label-data">{s.name} · <span data-state-words="">{STATE_WORDS[s.state]}</span></p>
        <Moves s={s} busy={busy} onMove={onMove} />
      </div>
      <div className="cline-tiles cline-tiles-flat" data-pool-counts="">
        {poolTiles(pool, counts).map((t) => (
          <div key={t.label} className={`cline-tile${t.loud ? ' is-loud' : ''}`}><b className="cline-tile-n">{t.n}</b><span className="cline-tile-l label-data">{t.label}</span></div>
        ))}
      </div>
      <ListApproval s={s} ids={listableIds} busy={busy} onList={onList} />
      <Pitch s={s} />
      {pool.length ? <ul className="cline-ws-src" aria-label={`companies for ${s.name}`}>{pool.map((p) => <Prospect key={p.id} p={p} />)}</ul> : null}
    </li>
  );
};
