// WakeSections — the operator's vision of the house waking itself: NOW (who
// is awake, and what waits and why), the LEDGER (every wake, newest first,
// filtered and paged) and the ASKS (what a wake could not do without the
// operator). Pure rendering; the display law lives in house-clock-view.js and
// the IO in HouseClockApp.jsx. No sound imports: renderable under node.

import { EmptyState } from '../empty-state.jsx';
import { Select } from '../Select.jsx';
import { runningRows, queueRows, ledgerRow, askRow, OUTCOMES, outcomeWords } from './house-clock-view.js';

const OpenSitting = ({ seat, name, sessionId, onOpenSitting, label = 'OPEN SITTING' }) => (sessionId ? (
  <button type="button" className="hclock-btn label-data" onClick={() => onOpenSitting({ seat, name, sessionId })}>{label}</button>
) : null);

/** NOW — who is awake this moment, and the queue with each item's reason to wait. */
export const NowSection = ({ queue, names, onOpenSitting }) => {
  const running = runningRows(queue, names);
  const waiting = queueRows(queue, names);
  return (
    <section className="hclock-sec">
      <p className="hclock-sec-head label-data">AWAKE NOW</p>
      {running.length === 0 ? <p className="hclock-muted">No seat is awake.</p> : (
        <ul className="hclock-rows">
          {running.map((r) => (
            <li key={r.key} className={r.waitingForLine ? 'hclock-row' : 'hclock-row is-live'}>
              <span className="hclock-row-who">{r.name}</span>
              <span className="hclock-row-what">{`${r.reason}${r.ref ? ` [${r.ref}]` : ''} — ${r.waitingForLine ? 'waiting for the model line since' : 'since'} ${r.started}`}</span>
              <OpenSitting seat={r.seat} name={r.name} sessionId={r.sessionId} onOpenSitting={onOpenSitting} label="WATCH IT" />
            </li>
          ))}
        </ul>
      )}
      <p className="hclock-sec-head label-data">WAITING</p>
      {waiting.length === 0 ? <p className="hclock-muted">Nothing waits.</p> : (
        <ul className="hclock-rows">
          {waiting.map((w) => (
            <li key={w.key} className={`hclock-row is-${w.wait.key}`}>
              <span className="hclock-row-who">{w.name}</span>
              <span className="hclock-row-what">{`${w.reason}${w.ref ? ` [${w.ref}]` : ''} — queued ${w.queued}`}</span>
              <span className="hclock-row-why label-data">{w.wait.words}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="hclock-muted">
        {`Today: ${Object.entries(queue?.today ?? {}).map(([seat, n]) => `${names[seat] || seat} ${n}`).join(' · ') || 'no wakes yet'}. `}
        The clock looks every minute; held work runs once it may.
      </p>
    </section>
  );
};

/** LEDGER — every wake, newest first: why, when, how it ended, the acts it took. */
export const LedgerSection = ({ ledger, filter, names, seats, page, pageSize, onFilter, onPage, onOpenSitting }) => {
  const rows = (ledger?.rows ?? []).map((r) => ledgerRow(r, names));
  const total = ledger?.total ?? 0;
  const last = Math.max(0, Math.ceil(total / pageSize) - 1);
  return (
    <section className="hclock-sec">
      <div className="hclock-filters">
        <Select ariaLabel="Filter by seat" value={filter.seat} onChange={(v) => onFilter({ ...filter, seat: v })}
          options={[{ value: '', label: 'EVERY SEAT' }, ...seats.map((s) => ({ value: s, label: names[s] || s }))]} />
        <Select ariaLabel="Filter by outcome" value={filter.outcome} onChange={(v) => onFilter({ ...filter, outcome: v })}
          options={[{ value: '', label: 'EVERY OUTCOME' }, ...OUTCOMES.map((o) => ({ value: o, label: outcomeWords(o).words }))]} />
        <span className="hclock-muted label-data">{`${total} WAKE${total === 1 ? '' : 'S'}`}</span>
      </div>
      {rows.length === 0 ? <EmptyState title="NO WAKES ON THE LEDGER YET" /> : (
        <ul className="hclock-rows">
          {rows.map((r) => (
            <li key={r.key} className="hclock-wake">
              <div className="hclock-wake-head">
                <span className="hclock-row-who">{r.name}</span>
                <span className={`hclock-outcome label-data is-${r.outcome.register}`}>{r.outcome.words}</span>
                <OpenSitting seat={r.seat} name={r.name} sessionId={r.sessionId} onOpenSitting={onOpenSitting} />
              </div>
              <p className="hclock-row-what">{`Woke for: ${r.reasons.join('; ')}`}</p>
              <p className="hclock-muted">{`${r.started}${r.ended ? ` → ${r.ended}` : ''}`}</p>
              {r.acts.length ? <p className="hclock-acts label-data">{`ACTS: ${r.acts.join(' · ')}`}</p> : <p className="hclock-muted">No governed acts.</p>}
              {r.escalations ? <p className="hclock-row-why label-data">{`${r.escalations} SENT TO YOU — SEE ASKS`}</p> : null}
              {r.note ? <p className="hclock-muted">{r.note}</p> : null}
            </li>
          ))}
        </ul>
      )}
      {total > pageSize ? (
        <div className="hclock-actions">
          <button type="button" className="hclock-btn label-data" disabled={page <= 0} onClick={() => onPage(page - 1)}>NEWER</button>
          <span className="hclock-muted label-data">{`PAGE ${page + 1} OF ${last + 1}`}</span>
          <button type="button" className="hclock-btn label-data" disabled={page >= last} onClick={() => onPage(page + 1)}>OLDER</button>
        </div>
      ) : null}
    </section>
  );
};

/**
 * ASKS — what a wake could not do and sent to the operator. Closing one says
 * "seen, dealt with": nothing runs; answering the seat happens in its sitting.
 */
export const AsksSection = ({ asks, names, busy, onClose, onOpenSitting }) => {
  const rows = (asks ?? []).map((a) => askRow(a, names));
  return (
    <section className="hclock-sec">
      <p className="hclock-muted">
        A wake never waits for you: what it could not do was refused in the turn and filed here.
        To have it done, tell the seat in its sitting. Closing an ask only marks it dealt with — nothing runs.
      </p>
      {rows.length === 0 ? <EmptyState title="NOTHING HAS BEEN SENT TO YOU" /> : (
        <ul className="hclock-rows">
          {rows.map((a) => (
            <li key={a.key} className={`hclock-wake${a.open ? ' is-open' : ''}`}>
              <div className="hclock-wake-head">
                <span className="hclock-row-who">{a.name}</span>
                <span className="hclock-row-what label-data">{a.what}</span>
                <OpenSitting seat={a.seat} name={a.name} sessionId={a.sessionId} onOpenSitting={onOpenSitting} />
                {a.open ? <button type="button" className="hclock-btn label-data" disabled={busy} onClick={() => onClose(a.key)}>CLOSE</button> : null}
              </div>
              <p className="hclock-row-what">{`Why it came to you: ${a.why}`}</p>
              {a.scope ? <p className="hclock-muted">{`Reached for: ${a.scope}`}</p> : null}
              <p className="hclock-muted">{a.closed || `OPEN SINCE ${a.at}`}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
