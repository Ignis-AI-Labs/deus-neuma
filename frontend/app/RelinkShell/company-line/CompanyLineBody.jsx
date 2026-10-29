// CompanyLineBody — the COMPANY LINE window, pure rendering. What waits on
// you comes first: the overview, then each move that is yours (a stage you
// master, an inspection that is yours, counsel's answer to record). Then the
// dial, every company with its seven-stage rail (each stage's master by name,
// done · in hand · ahead), and opening a new company. The display law lives
// in company-line-view.js; the IO in CompanyLineApp.jsx. NO sound imports —
// renderable under node.

import '../SecurityApp.css';
import './CompanyLine.css';
import { EmptyState } from '../empty-state.jsx';
import { WorksheetView } from './WorksheetView.jsx';
import { SalesSection } from './SalesSection.jsx';
import {
  MODE_WORDS, holderName, statusWords, currentStage, upWords, stepWords, operatorMove, lineOverview,
  ANSWER_ASKS, openHands, domainOf, handOnReady,
} from './company-line-view.js';

export const CompanyLineIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <path d="M1.5 8 H14.5 M3 6 V10 M6 6 V10 M9 6 V10 M12 6 V10 M14.5 8 L12.5 6.5 M14.5 8 L12.5 9.5" />
  </svg>
);

const Tile = ({ n, label, loud }) => (
  <div className={`cline-tile${loud ? ' is-loud' : ''}`}>
    <b className="cline-tile-n">{n}</b>
    <span className="cline-tile-l label-data">{label}</span>
  </div>
);

// The seven stages in a row: each one's master by name, and where the line stands.
const Rail = ({ company, names }) => (
  <ol className="cline-rail" aria-label={`${company.name}: the founding line`}>
    {company.stages.map((s) => (
      <li key={s.id} className={`cline-stage is-${s.state}${s.gate ? ' is-gate' : ''}`}>
        <span className="cline-stage-n label-data">{s.name}</span>
        <span className="cline-stage-m label-data">{holderName(s.holder, names)}</span>
      </li>
    ))}
  </ol>
);

// The operator's own move on one line: hand on a stage they master, or answer an inspection.
const YourMove = ({ company, draft, busy, onDraft, onHandOn, onInspect }) => {
  const move = operatorMove(company);
  const stage = currentStage(company);
  const set = (field) => (e) => onDraft(company.id, field, e.target.value);
  if (move.kind === 'hand-on') {
    const ready = handOnReady(stage, draft);
    return (
      <div className="cline-move cham" data-company-move={company.id}>
        <div className="cline-move-in cham-in">
          <p className="cline-move-h label-data">{company.name} · {stage.name} — YOURS TO DO</p>
          <p className="cline-move-t">{stage.handsOn}</p>
          {stage.id === 'choose' ? (
            <>
              <p className="cline-co-line label-data">THE GAP SHAPED: {company.worksheets?.shape?.candidate ?? '—'}</p>
              <WorksheetView stageId="shape" worksheet={company.worksheets?.shape} />
              <textarea className="cline-input" rows={2} aria-label="Why this gap is ours" placeholder="Why this gap is ours"
                value={draft.why ?? ''} disabled={busy} onChange={set('why')} />
              <textarea className="cline-input" rows={2} aria-label="We stop if" placeholder="We stop if … (one condition per line)"
                value={draft.kill ?? ''} disabled={busy} onChange={set('kill')} />
            </>
          ) : stage.worksheet ? (
            <textarea className="cline-input label-data" rows={6} aria-label="The worksheet as JSON" placeholder="The worksheet, as JSON — its shape is in the plan, every claim with its source"
              value={draft.json ?? ''} disabled={busy} onChange={set('json')} />
          ) : (
            <input className="cline-input" aria-label="Where the work lies" placeholder="Where the work lies — a path, a link, or what was filed"
              value={draft.artifact ?? ''} disabled={busy} onChange={set('artifact')} />
          )}
          <textarea className="cline-input" rows={2} aria-label="A note for the inspector" placeholder="A note for the inspector (optional)"
            value={draft.note ?? ''} disabled={busy} onChange={set('note')} />
          <div className="cline-actions">
            <button type="button" className="sec-scan label-data" disabled={busy || !ready} onClick={() => onHandOn(company)}>HAND ON</button>
          </div>
        </div>
      </div>
    );
  }
  const flaw = (draft.flaw ?? '').trim();
  return (
    <div className="cline-move cham" data-company-move={company.id}>
      <div className="cline-move-in cham-in">
        <p className="cline-move-h label-data">{company.name} · {stage.name} — {move.counsel ? 'RECORD COUNSEL\'S ANSWER' : 'YOUR INSPECTION'}</p>
        <p className="cline-move-t">THE WORK: {company.handed.artifact}{company.handed.note ? ` — "${company.handed.note}"` : ''}</p>
        <WorksheetView stageId={stage.id} worksheet={company.worksheets?.[stage.id]} />
        <textarea className="cline-input" rows={2} aria-label="The flaw, if it goes back" placeholder="The flaw — what is wrong, if it goes back or the gap ends here"
          value={draft.flaw ?? ''} disabled={busy} onChange={set('flaw')} />
        <div className="cline-actions">
          <button type="button" className="sec-scan label-data" disabled={busy} onClick={() => onInspect(company, 'accept')}>ACCEPT</button>
          <button type="button" className="sec-scan label-data" disabled={busy || !flaw} onClick={() => onInspect(company, 'return')}>RETURN</button>
          {move.stoppable ? (
            <button type="button" className="sec-scan cline-danger label-data" disabled={busy || !flaw} onClick={() => onInspect(company, 'stop')}>END THE GAP</button>
          ) : null}
        </div>
      </div>
    </div>
  );
};

// One act only a person can do: what, why, the honest estimate, the deadline,
// the link with its site shown plainly, and the answer the house asked for.
const HandsCard = ({ item, names, draft, busy, onDraft, onAnswer }) => {
  const ask = ANSWER_ASKS[item.answer];
  const text = (draft.text ?? '').trim();
  const stage = item.unblocks ? item.company.stages.find((s) => s.id === item.unblocks) : null;
  return (
    <div className="cline-move cham" data-hands-id={item.id}>
      <div className="cline-move-in cham-in">
        <p className="cline-move-h label-data">{item.company.name} — ONLY YOU CAN DO THIS · ASKED BY {holderName(item.raisedBy, names)}</p>
        <p className="cline-hands-what">{item.what}</p>
        <p className="cline-move-t">{item.why}</p>
        <p className="cline-co-line label-data">
          {stage ? `HOLDS ${stage.name}` : 'HOLDS NO STAGE'}{item.cost ? ` · ESTIMATE: ${item.cost}` : ''}{item.by ? ` · BY ${item.by}` : ''}
        </p>
        <p className="cline-co-line label-data">
          DO IT AT {domainOf(item.where)} — <a className="cline-link" href={item.where} target="_blank" rel="noopener noreferrer">{item.where}</a>
        </p>
        <input className="cline-input" aria-label={ask ?? 'Why it will not be done'} disabled={busy} value={draft.text ?? ''}
          placeholder={ask ? `${ask} (or why it will not be done)` : 'Why it will not be done (only if you decline)'}
          onChange={(e) => onDraft(item.id, 'text', e.target.value)} />
        <div className="cline-actions">
          <button type="button" className="sec-scan label-data" disabled={busy || (ask && !text)} onClick={() => onAnswer(item, 'done')}>DONE</button>
          <button type="button" className="sec-scan cline-danger label-data" disabled={busy || !text} onClick={() => onAnswer(item, 'declined')}>WON&apos;T DO</button>
        </div>
      </div>
    </div>
  );
};

const CompanyCard = ({ company, names }) => (
  <article className="cline-co" data-company-line={company.id}>
    <header className="cline-co-head">
      <span className="cline-co-name">{company.name}</span>
      <span className="cline-co-meta label-data">{MODE_WORDS[company.mode] ?? company.mode} · ROUND {company.round}</span>
    </header>
    <Rail company={company} names={names} />
    <p className="cline-co-line label-data">{statusWords(company)} — UP: {upWords(company, names)}</p>
    {stepWords(company) ? <p className="cline-co-line label-data">{stepWords(company)}</p> : null}
    {company.status === 'returned' && company.flaw ? <p className="cline-co-flaw">CAME BACK: “{company.flaw}”</p> : null}
    {company.stopped.length ? (
      <ul className="cline-stopped">
        {company.stopped.map((s) => (
          <li key={`${s.round}:${s.at}`} className="label-data">ROUND {s.round} ENDED AT {String(s.stage).toUpperCase()} — {s.flaw}</li>
        ))}
      </ul>
    ) : null}
  </article>
);

const OpenForm = ({ draft, busy, onDraft, onOpen }) => (
  <section className="cline-sec" aria-label="open a company">
    <p className="cline-h label-data">OPEN A COMPANY — ITS LINE STARTS AT SURVEY, WITH THE SPECULATOR</p>
    <div className="cline-open">
      <input className="cline-input" aria-label="Working name" placeholder="Working name" value={draft.name ?? ''} disabled={busy}
        onChange={(e) => onDraft('_open', 'name', e.target.value)} />
      <div className="cline-modes" role="radiogroup" aria-label="Where the gap comes from">
        {Object.entries(MODE_WORDS).map(([mode, words]) => (
          <button key={mode} type="button" role="radio" aria-checked={draft.mode === mode} disabled={busy}
            className={`cline-mode label-data${draft.mode === mode ? ' is-on' : ''}`} onClick={() => onDraft('_open', 'mode', mode)}>{words}</button>
        ))}
      </div>
      <button type="button" className="sec-scan label-data" disabled={busy || !(draft.name ?? '').trim() || !draft.mode} onClick={onOpen}>OPEN</button>
    </div>
  </section>
);

export const CompanyLineBody = ({
  board, names, error, loading, busy, drafts, onDraft, onRefresh, onOpen, onHandOn, onInspect, onAnswer, onCharter,
  sales = null, onSales = null,
}) => {
  const view = lineOverview(board);
  const mine = (board?.companies ?? []).filter((c) => operatorMove(c));
  const hands = openHands(board);
  return (
    <div className="sec cline">
      <header className="sec-head">
        <span className="sec-head-label label-data">COMPANY LINE</span>
        <span className="sec-head-seat label-data">ONE STAGE, ONE MASTER</span>
        <button type="button" className="sec-scan label-data" onClick={onRefresh} disabled={loading}>{loading ? 'READING…' : 'READ NOW'}</button>
      </header>
      {error ? <p className="sec-error label-data" role="alert">{error}</p> : null}
      {!board ? <EmptyState title={loading ? 'READING THE LINE…' : 'THE COMPANY LINE COULD NOT BE READ'} /> : (
        <>
          <section className="cline-tiles" aria-label="the line at a glance">
            <Tile n={view.owed} label="WAITING ON YOU" loud={view.owed > 0} />
            <Tile n={view.founding} label="BEING FOUNDED" />
            <Tile n={view.standing} label="STANDING" />
          </section>
          <section className="cline-sec" aria-label="your moves">
            <p className="cline-h label-data">YOUR MOVES</p>
            {mine.length === 0 ? <EmptyState title="NOTHING ON THE LINE WAITS ON YOU" /> : mine.map((c) => (
              <YourMove key={c.id} company={c} draft={drafts[c.id] ?? {}} busy={busy} onDraft={onDraft} onHandOn={onHandOn} onInspect={onInspect} />
            ))}
          </section>
          <section className="cline-sec" aria-label="your hands">
            <p className="cline-h label-data">YOUR HANDS — WHAT ONLY A PERSON CAN DO. NEVER TYPE A SECRET HERE: SAY WHERE IT IS KEPT.</p>
            {hands.length === 0 ? <EmptyState title="THE HOUSE ASKS NOTHING OF YOUR HANDS" /> : hands.map((item) => (
              <HandsCard key={item.id} item={item} names={names} draft={drafts[item.id] ?? {}} busy={busy} onDraft={onDraft} onAnswer={onAnswer} />
            ))}
          </section>
          <section className="cline-sec cline-dial" aria-label="the involvement dial">
            <p className="cline-h label-data">YOUR DIAL — {board.dial.stop}</p>
            <p className="cline-dial-says">{board.dial.says}</p>
            <details className="cline-floor">
              <summary className="label-data">THE FLOOR — WHAT EVERY STOP STILL BRINGS TO YOU</summary>
              <ul>{board.dial.floor.map((f) => <li key={f}>{f}</li>)}</ul>
            </details>
            <button type="button" className="sec-scan label-data" onClick={onCharter}>SET IT IN THE CHARTER</button>
          </section>
          <section className="cline-sec" aria-label="the companies">
            <p className="cline-h label-data">THE COMPANIES</p>
            {board.companies.length === 0 ? <EmptyState title="NO COMPANY ON THE LINE YET" /> : board.companies.map((c) => (
              <CompanyCard key={c.id} company={c} names={names} />
            ))}
          </section>
          {onSales ? <SalesSection sales={sales} names={names} busy={busy} {...onSales} /> : null}
          <OpenForm draft={drafts._open ?? {}} busy={busy} onDraft={onDraft} onOpen={onOpen} />
        </>
      )}
    </div>
  );
};
