// AsksSection — what house work brought back to the operator, and their
// answers (Design note, 2026-10-16: […]). The Optio's REVIEW PACKET on top, in
// her order with the blocked asks marked; then the asks, filtered open /
// answered / dismissed, by kind, by seat, blocked only; each open ask with its
// answer: ALLOW ONCE / DENY an act, APPROVE / REVISE a plan, REPLY to a
// decision. CLOSE dismisses without answering. Rendering only — the display
// law lives in asks-view.js, the IO in use-house-clock.js. No sound imports:
// renderable under node.

import { useState } from 'react';
import { EmptyState } from '../empty-state.jsx';
import { Select } from '../Select.jsx';
import { OpenSitting } from './WakeSections.jsx';
import { ASK_KINDS, ASK_VIEWS, askRow, askSeats, filterAsks, packetView } from './asks-view.js';

const Packet = ({ pv }) => (pv ? (
  <div className="hclock-packet">
    <p className="hclock-sec-head label-data">{`REVIEW PACKET FROM ${pv.by} · ${pv.at} · ${pv.waiting} WAIT ON YOU${pv.blocked ? `, ${pv.blocked} BLOCKED` : ''}`}</p>
    <p className="hclock-packet-summary">{pv.summary}</p>
    <ol className="hclock-packet-items">
      {pv.items.map((it) => (
        <li key={it.key} className={`hclock-packet-item${it.standing === 'WAITS ON YOU' ? '' : ' is-settled'}`}>
          <span className="hclock-packet-n label-data">{it.n}</span>
          <span className="hclock-row-who">{it.name}</span>
          <span className="hclock-row-what">{it.what}</span>
          {it.blocked ? <span className="hclock-tag is-blocked label-data">BLOCKED</span> : null}
          <span className="hclock-row-why label-data">{it.standing}</span>
        </li>
      ))}
    </ol>
  </div>
) : (
  <p className="hclock-muted">
    No review packet yet. When things wait on you, the Optio brings them back as one packet: what needs you, why, and in what order.
  </p>
));

// One open ask's answer. Its words and chosen option are this row's own draft until it is sent.
const Answer = ({ row, busy, onAnswer }) => {
  const [text, setText] = useState('');
  const [option, setOption] = useState('');
  const words = text.trim();
  const send = (decision) => onAnswer(row.key, { decision, ...(words ? { text: words } : {}), ...(option ? { option } : {}) });
  if (row.controls === 'plan-legacy') {
    return <p className="hclock-muted">This plan was not recorded when it was filed: close it, and tell the lead in its sitting.</p>;
  }
  const label = { act: 'Your words to the seat (optional)', 'act-legacy': 'Your words to the seat (optional)', plan: 'What must change (needed to revise)', decision: 'Your reply' }[row.controls];
  return (
    <div className="hclock-answer">
      {row.controls === 'decision' && row.options.length ? (
        <div className="hclock-actions" role="group" aria-label={`Choices for ${row.name}`}>
          {row.options.map((o) => (
            <button key={o} type="button" aria-pressed={option === o} disabled={busy}
              className={`hclock-btn hclock-choice label-data${option === o ? ' is-on' : ''}`} onClick={() => setOption(option === o ? '' : o)}>
              {o}
            </button>
          ))}
        </div>
      ) : null}
      <textarea className="hclock-input" rows={2} value={text} disabled={busy} placeholder={label}
        aria-label={`${label} — ${row.name}`} onChange={(e) => setText(e.target.value)} />
      <div className="hclock-actions">
        {row.controls === 'act' ? (
          <button type="button" className="hclock-btn is-primary label-data" disabled={busy} onClick={() => send('allow')}
            title="Let exactly this act run once, and wake the seat to take it">ALLOW ONCE</button>
        ) : null}
        {row.controls === 'act' || row.controls === 'act-legacy' ? (
          <button type="button" className="hclock-btn is-danger label-data" disabled={busy} onClick={() => send('deny')}>DENY</button>
        ) : null}
        {row.controls === 'plan' ? (
          <>
            <button type="button" className="hclock-btn is-primary label-data" disabled={busy} onClick={() => send('approve')}
              title="Make it the lead's plan of record, and wake the lead to run it">APPROVE</button>
            <button type="button" className="hclock-btn label-data" disabled={busy || !words} onClick={() => send('revise')}>REVISE</button>
          </>
        ) : null}
        {row.controls === 'decision' ? (
          <button type="button" className="hclock-btn is-primary label-data" disabled={busy || (!words && !option)} onClick={() => send('reply')}>REPLY</button>
        ) : null}
      </div>
      {row.controls === 'act-legacy' ? <p className="hclock-muted">Filed before ALLOW ONCE existed: deny it, or close it and tell the seat in its sitting.</p> : null}
    </div>
  );
};

const AskItem = ({ row, busy, onAnswer, onClose, onOpenSitting }) => (
  <li className={`hclock-wake${row.open ? ' is-open' : ''}`} data-ask={row.key}>
    <div className="hclock-wake-head">
      <span className="hclock-row-who">{row.name}</span>
      <span className="hclock-tag label-data">{row.kind}</span>
      {row.blocked ? <span className="hclock-tag is-blocked label-data">BLOCKED</span> : null}
      <span className="hclock-row-what label-data">{row.what}</span>
      <OpenSitting seat={row.seat} name={row.name} sessionId={row.sessionId} onOpenSitting={onOpenSitting} />
      {row.open ? (
        <button type="button" className="hclock-btn label-data" disabled={busy} onClick={() => onClose(row.key)}
          title="Dismiss without answering — nothing runs, and the seat is not woken">CLOSE</button>
      ) : null}
    </div>
    {row.question ? <p className="hclock-ask-question">{row.question}</p> : <p className="hclock-row-what">{`Why it came to you: ${row.why}`}</p>}
    {row.scope ? <p className="hclock-muted">{`Reached for: ${row.scope}`}</p> : null}
    {row.where ? <p className="hclock-muted">{`From ${row.where}`}</p> : null}
    {row.open ? <Answer row={row} busy={busy} onAnswer={onAnswer} /> : null}
    {row.answered ? <p className="hclock-row-why label-data">{row.answered}</p> : null}
    {row.answerText ? <p className="hclock-ask-words">{row.answerText}</p> : null}
    <p className="hclock-muted">{row.closed || `FILED ${row.at}${row.waited ? ` · ${row.waited}` : ''}`}</p>
  </li>
);

/**
 * @param {Object} p - asks, packet, names, filter, notice, busy, now (when the asks were read) and the handlers (use-house-clock.js)
 */
export const AsksSection = ({ asks, packet, names, filter, notice, busy, now, onFilter, onAnswer, onClose, onOpenSitting }) => {
  const blocked = new Set(packet?.blocked ?? []);
  const rows = filterAsks(asks, filter, blocked).map((a) => askRow(a, names, blocked, now));
  return (
    <section className="hclock-sec">
      <Packet pv={packetView(packet, asks, names)} />
      <div className="hclock-filters">
        <Select ariaLabel="Filter asks by standing" value={filter.view} onChange={(v) => onFilter({ ...filter, view: v })} options={ASK_VIEWS} />
        <Select ariaLabel="Filter asks by kind" value={filter.kind} onChange={(v) => onFilter({ ...filter, kind: v })}
          options={[{ value: '', label: 'EVERY KIND' }, ...ASK_KINDS]} />
        <Select ariaLabel="Filter asks by seat" value={filter.seat} onChange={(v) => onFilter({ ...filter, seat: v })}
          options={[{ value: '', label: 'EVERY SEAT' }, ...askSeats(asks).map((s) => ({ value: s, label: names[s] || s }))]} />
        <label className="hclock-check">
          <input type="checkbox" checked={filter.blockedOnly} onChange={(e) => onFilter({ ...filter, blockedOnly: e.target.checked })} />
          <span className="label-data">BLOCKED ONLY</span>
        </label>
        <span className="hclock-muted label-data">{`${rows.length} SHOWN`}</span>
      </div>
      {notice ? <p className="hclock-row-why label-data" role="status">{notice}</p> : null}
      {rows.length === 0 ? <EmptyState title={filter.view === 'open' ? 'NOTHING WAITS ON YOU' : 'NOTHING HERE'} /> : (
        <ul className="hclock-rows">
          {rows.map((r) => <AskItem key={r.key} row={r} busy={busy} onAnswer={onAnswer} onClose={onClose} onOpenSitting={onOpenSitting} />)}
        </ul>
      )}
    </section>
  );
};
