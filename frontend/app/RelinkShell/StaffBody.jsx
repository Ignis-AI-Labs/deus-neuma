// StaffBody — the CHIEF OF STAFF window's whole office, pure rendering. The
// display law lives in staff-view.js; the IO lives in StaffApp.jsx.
// NO sound imports — the module stays renderable under node (the
// static-markup view tests).

import './StaffApp.css';
import { EmptyState } from './empty-state.jsx';
import { Select } from './Select.jsx';
import {
  seatLine, seatHeldLine, holderNameFor, holderLabel, isOfficeHolder,
  postsLine, postLine, planSummary, runLine, runRegister, runStatusLabel,
  chargeRow, chargeRegister,
} from './staff-view.js';

export const StaffIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <path d="M8 1.5 L10 4 L8 6.5 L6 4 Z" />
    <path d="M3 9.5 H13 M4.5 13 H11.5" />
  </svg>
);

// THE SEAT — who holds the Optio office, and the operator's one act on it:
// designate a holder, or unseat the one that stands.
const SeatSection = ({ seat, lanes, pick, busy, confirmClear, onPick, onSeat, onAskClear, onClear, onCancelClear }) => (
  <section className="staff-sec">
    <p className="staff-sec-head label-data">THE SEAT</p>
    {seat ? (
      <p className="staff-seat-held label-data">{seatHeldLine(seat, holderNameFor(seat, lanes))}</p>
    ) : (
      <p className="staff-seat-empty label-data">«NO CHIEF OF STAFF SEATED»</p>
    )}
    <div className="staff-seat-controls">
      <Select
        fill
        ariaLabel="Chief of staff holder"
        value={pick}
        onChange={onPick}
        disabled={busy || lanes.length === 0}
        placeholder="— choose the holder —"
        options={lanes.map((l) => ({ value: l.neumaId, label: l.name || l.neumaId }))}
      />
      <button type="button" className="staff-btn label-data" disabled={busy || !pick} onClick={onSeat}>
        {busy ? 'WORKING…' : 'SEAT'}
      </button>
      {seat && !confirmClear ? (
        <button type="button" className="staff-btn is-danger label-data" disabled={busy} onClick={onAskClear}>
          UNSEAT
        </button>
      ) : null}
    </div>
    {seat && confirmClear ? (
      <div className="staff-confirm">
        <span className="staff-confirm-notice">
          «NOTICE» unseat the chief of staff? The office&apos;s record stays; dispatch returns to every seated lane.
        </span>
        <button type="button" className="staff-btn is-danger label-data" onClick={onClear} disabled={busy}>
          UNSEAT
        </button>
        <button type="button" className="staff-btn label-data" onClick={onCancelClear} disabled={busy}>
          CANCEL
        </button>
      </div>
    ) : null}
  </section>
);

// THE HOUSE AS IT STANDS — one row per seat on the founding receipt. The
// kind-0 seat is the human: OPERATOR, never "witness". The Optio's own seat
// carries the office mark.
const RosterSection = ({ board, seat }) => (
  <section className="staff-sec">
    <p className="staff-sec-head label-data">THE HOUSE AS IT STANDS</p>
    {!seat ? (
      <EmptyState title="SEAT A CHIEF OF STAFF AND THE HOUSE READS HERE" />
    ) : !board?.roster ? (
      <EmptyState title="NO FOUNDING RECEIPT SEATS THE OFFICE YET" />
    ) : (
      <>
        {board.roster.houseName ? (
          <p className="staff-house label-data">HOUSE {board.roster.houseName.toUpperCase()}</p>
        ) : null}
        <ul className="staff-roster">
          {board.roster.roster.map((m, i) => (
            <li key={`${m.title}-${m.neumaId || i}`} className="staff-roster-row">
              <span className="staff-roster-title label-data">{m.title.toUpperCase()}</span>
              <span className={`staff-roster-holder${m.isWitness ? ' label-data' : ''}`}>
                {holderLabel(m)}
              </span>
              {isOfficeHolder(m, seat) ? (
                <span className="staff-tag is-signal label-data">THE OPTIO</span>
              ) : null}
            </li>
          ))}
        </ul>
      </>
    )}
  </section>
);

// DISPATCHES — what waits on the office: the inbox, the standing plan of
// record, and the house's recent team runs.
const DispatchSection = ({ board, seat, busy, confirmEndPlan, onAskEndPlan, onEndPlan, onCancelEndPlan }) => {
  const plan = planSummary(board?.plan);
  const runs = board?.runs ?? [];
  return (
    <section className="staff-sec">
      <p className="staff-sec-head label-data">DISPATCHES</p>
      {!seat ? (
        <EmptyState title="THE BOARD READS ONCE THE OFFICE IS SEATED" />
      ) : (
        <>
          <p className={`staff-line label-data${board?.posts?.count ? ' is-signal' : ''}`}>
            {postsLine(board?.posts)}
          </p>
          {(board?.posts?.recent ?? []).map((p, i) => (
            <p key={`${p.from}-${i}`} className="staff-post">{postLine(p)}</p>
          ))}

          <p className="staff-sub-head label-data">THE STANDING PLAN OF RECORD</p>
          {plan ? (
            <>
              <p className="staff-line label-data is-signal">{plan.title.toUpperCase()}</p>
              <p className="staff-plan-detail">{plan.detail}</p>
              {confirmEndPlan ? (
                <div className="staff-confirm">
                  <span className="staff-confirm-notice">
                    «NOTICE» end this plan? Its record is kept; the office&apos;s work is no longer held to its workspace.
                  </span>
                  <button type="button" className="staff-btn is-danger label-data" onClick={onEndPlan} disabled={busy}>
                    END PLAN
                  </button>
                  <button type="button" className="staff-btn label-data" onClick={onCancelEndPlan} disabled={busy}>
                    CANCEL
                  </button>
                </div>
              ) : (
                <div className="staff-seat-controls">
                  <button type="button" className="staff-btn is-danger label-data" onClick={onAskEndPlan} disabled={busy}>
                    END PLAN
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className="staff-line label-data">NO STANDING PLAN OF RECORD</p>
          )}

          <p className="staff-sub-head label-data">THE DISPATCH DRAWER</p>
          {(board?.house?.dispatches?.charges ?? []).length === 0 ? (
            <p className="staff-line label-data">NO CHARGES FILED</p>
          ) : (
            <ul className="staff-runs">
              {board.house.dispatches.charges.map((c) => {
                const row = chargeRow(c);
                return row ? (
                  <li key={row.key} className={`staff-run label-data is-${chargeRegister(c)}`}>
                    <span className={`staff-tag is-${chargeRegister(c)} label-data`}>{row.status}</span>
                    <span className="staff-run-line">{row.line}</span>
                  </li>
                ) : null;
              })}
            </ul>
          )}

          <p className="staff-sub-head label-data">RECENT TEAM RUNS</p>
          {runs.length === 0 ? (
            <p className="staff-line label-data">NONE RECORDED — THE HOUSE HAS NOT RUN A TEAM YET</p>
          ) : (
            <ul className="staff-runs">
              {runs.map((run) => (
                <li key={run.id} className={`staff-run label-data is-${runRegister(run.status)}`}>
                  <span className={`staff-tag is-${runRegister(run.status)} label-data`}>
                    {runStatusLabel(run.status)}
                  </span>
                  <span className="staff-run-line">{runLine(run)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
};

export const StaffBody = ({
  seat, board, lanes, pick, busy, error, confirmClear, confirmEndPlan = false,
  onPick, onSeat, onAskClear, onClear, onCancelClear, onAskEndPlan, onEndPlan, onCancelEndPlan,
}) => (
  <div className="staff">
    <header className="staff-head">
      <span className="staff-head-label label-data">CHIEF OF STAFF</span>
      <span className={`staff-head-seat label-data${seat ? '' : ' is-empty'}`}>
        {seatLine(seat, holderNameFor(seat, lanes))}
      </span>
    </header>
    {error ? <p className="staff-error label-data">{error}</p> : null}
    <SeatSection
      seat={seat}
      lanes={lanes}
      pick={pick}
      busy={busy}
      confirmClear={confirmClear}
      onPick={onPick}
      onSeat={onSeat}
      onAskClear={onAskClear}
      onClear={onClear}
      onCancelClear={onCancelClear}
    />
    <RosterSection board={board} seat={seat} />
    <DispatchSection
      board={board}
      seat={seat}
      busy={busy}
      confirmEndPlan={confirmEndPlan}
      onAskEndPlan={onAskEndPlan}
      onEndPlan={onEndPlan}
      onCancelEndPlan={onCancelEndPlan}
    />
  </div>
);
