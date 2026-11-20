// WalletEarnings — what a house member's LIQUIDITY wallet has made, how it runs
// round the clock, and the rewards it works toward (Design note, 2026-11-13: members
// earn rewards […]). Three cards under the LP panel:
//
//   EARNED          the book: earned, value now, what you gave it, its last acts
//   ROUND THE CLOCK its portfolio round's pace, and whether the charter lets it wake
//   GOALS           each goal with its progress; a request's APPROVE / DECLINE
//
// Figures: lp-figures.js. Backend: umbrae-lp/lp-book.js, lp-watch.js, lp-rewards.js.

import { useState } from 'react';
import { signedUsd, earnedBack, goalRows, usd, nameCase } from './lp-figures.js';
import { useWindows } from '../windowing/use-windows.js';
import { requestHouseClockTab } from './house-clock/house-clock-focus.js';
import { uiSound } from '../../services/ui-sound.js';

const PACES = Object.freeze([[30, 'every 30 min'], [60, 'every hour'], [120, 'every 2 hours'], [240, 'every 4 hours'], [480, 'every 8 hours'], [0, 'off']]);

/** The book: what it earned, what it is worth, what it was given. */
export const EarningsCard = ({ book }) => {
  if (!book) return <section className="lpw-card"><span className="lpw-k">EARNED</span><p className="lpw-sub">Not read yet: Base or Umbrae&apos;s pool list did not answer.</p></section>;
  const day = earnedBack(book.days, book.earnedUsd, 1);
  const week = earnedBack(book.days, book.earnedUsd, 7);
  const tone = book.earnedUsd < 0 ? 'is-down' : 'is-up';
  return (
    <section className="lpw-card lpw-earned" aria-label="Earned">
      <div className="lpw-row">
        <span className="lpw-k">EARNED</span>
        <span className="lpw-sub">{day === null ? '' : `since yesterday ${signedUsd(day)}`}{week === null ? '' : ` · 7 days ${signedUsd(week)}`}</span>
      </div>
      <span className={`lpw-amount lpw-earn ${tone}`}>{signedUsd(book.earnedUsd)}</span>
      <dl className="lpw-facts">
        <div><dt>Worth now</dt><dd>{usd(book.valueUsd)}</dd></div>
        <div><dt>You gave it</dt><dd>{usd(book.fundedUsd)}</dd></div>
        <div><dt>Sent to the house</dt><dd>{usd(book.returnedUsd)}</dd></div>
        <div><dt>Free for rewards</dt><dd>{usd(book.freeUsd)}</dd></div>
      </dl>
      {book.journal?.length ? (
        <details className="lpw-rules">
          <summary>Last acts ({book.journal.length})</summary>
          <ul className="lpw-journal">
            {book.journal.map((j) => (
              <li key={`${j.at}-${j.act}`}>
                <span className="lpw-id">{new Date(j.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span> {j.what}
                {j.why ? <span className="lpw-why"> Why: {j.why}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : <p className="lpw-sub">No acts yet. Earned counts gas, fees, trades and price moves.</p>}
    </section>
  );
};

/** Its portfolio round, and whether the house charter lets it wake for it. */
export const ClockCard = ({ clock, name, onPace }) => {
  const windows = useWindows();
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  if (!clock) return null;
  const charter = () => {
    uiSound('open');
    windows?.dispatch({ type: 'OPEN', id: 'houseclock' });
    requestHouseClockTab('charter');
  };
  const pick = async (e) => {
    setSaving(true);
    setErr(await onPace(Number(e.target.value)));
    setSaving(false);
  };
  const live = clock.seated && clock.standing === 'active';
  return (
    <section className={`lpw-card ${live ? '' : 'lpw-wait'}`} aria-label="Round the clock">
      <div className="lpw-row">
        <span className="lpw-k">ROUND THE CLOCK</span>
        <span className={`lpw-chip ${live ? 'is-in' : 'is-out'}`}>{live ? 'ON' : 'CANNOT WAKE'}</span>
      </div>
      <label className="lpw-form">
        <span className="lpw-sub">Portfolio round</span>
        <select className="lpw-in" value={clock.pace} onChange={pick} disabled={saving} aria-label="Portfolio round">
          {PACES.map(([m, label]) => <option key={m} value={m}>{label}</option>)}
        </select>
      </label>
      <p className="lpw-sub">
        It also wakes when money arrives, a position leaves its range, or a price spread opens between two pools.
        {clock.seated ? ` Up to ${clock.dailyCap} wakes a day${clock.quietHours ? `; quiet ${clock.quietHours.start}–${clock.quietHours.end} (wakes wait)` : ''}.` : ''}
      </p>
      {!clock.seated ? (
        <div className="lpw-door" role="status">
          <span className="lpw-door-dot" aria-hidden="true" />
          <span className="lpw-door-text">Not seated in the house charter yet: {nameCase(name)} can seat itself, or you can</span>
          <button type="button" className="lpw-btn is-primary" onClick={charter}>OPEN CHARTER →</button>
        </div>
      ) : clock.standing !== 'active' ? (
        <div className="lpw-door" role="status">
          <span className="lpw-door-dot" aria-hidden="true" />
          <span className="lpw-door-text">The charter is {clock.standing}: its wakes wait until you {clock.standing === 'paused' ? 'resume' : 'approve'} it</span>
          <button type="button" className="lpw-btn is-primary" onClick={charter}>OPEN CHARTER →</button>
        </div>
      ) : null}
      {err ? <p className="wal-err label-data">{err}</p> : null}
    </section>
  );
};

// The goal's state as a tag; a goal still worked toward shows none until it is earned.
const STATE = Object.freeze({ requested: 'ASKS FOR IT', paying: 'PAYING', paid: 'PAID · GET IT', delivered: 'DELIVERED' });

/** One goal: its progress, and for a request, the operator's answer. */
const GoalCard = ({ goal, busy, onAnswer }) => {
  const [note, setNote] = useState('');
  const answer = (verdict) => { uiSound('activate'); onAnswer(goal.id, verdict, note); };
  return (
    <li className={`lpw-card lpw-goal ${goal.status === 'requested' ? 'lpw-wait' : ''}`}>
      <div className="lpw-row">
        <span className="lpw-step">{goal.what}</span>
        <span className="lpw-amount lpw-cost">{usd(goal.costUsd)}</span>
      </div>
      {STATE[goal.status] || goal.pct >= 100 ? <span className={`lpw-chip lpw-goal-state ${goal.status === 'requested' ? 'is-ask' : 'is-in'}`}>{STATE[goal.status] ?? 'EARNED'}</span> : null}
      {goal.status === 'working' || goal.status === 'requested' ? (
        <div className="lpw-bar" role="img" aria-label={`${goal.pct}% earned`}><div className="lpw-bar-used" style={{ width: `${goal.pct}%` }} /></div>
      ) : null}
      <p className="lpw-sub">Why: {goal.why}</p>
      {goal.status === 'working' ? <p className="lpw-sub">{goal.pct}% earned{goal.note ? ` · your last answer: "${goal.note}"` : ''}</p> : null}
      {goal.status === 'requested' ? (
        <>
          <input className="lpw-in" placeholder="A word to it (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="A word with your answer" maxLength={500} />
          <div className="lpw-acts">
            <button type="button" className="lpw-btn is-primary" disabled={busy} onClick={() => answer('approve')}>APPROVE · PAYS YOU {usd(goal.costUsd)} USDC</button>
            <button type="button" className="lpw-btn" disabled={busy} onClick={() => answer('decline')}>DECLINE</button>
          </div>
        </>
      ) : null}
      {goal.status === 'paying' ? <p className="lpw-sub">Paying on Base…</p> : null}
      {goal.status === 'paid' ? (
        <div className="lpw-acts">
          <span className="lpw-sub">Paid to you. Get it, then:</span>
          <button type="button" className="lpw-btn" disabled={busy} onClick={() => answer('delivered')}>MARK DELIVERED</button>
        </div>
      ) : null}
      {goal.status === 'delivered' ? <p className="lpw-sub">Delivered. It stays on its record.</p> : null}
    </li>
  );
};

/** The rewards it works toward. */
export const GoalsCard = ({ goals, freeUsd, name, busy, onAnswer }) => {
  const rows = goalRows(goals, freeUsd);
  return (
    <section aria-label="Goals">
      <h3 className="lpw-h">GOALS <span className="lpw-count">{rows.length}</span></h3>
      {rows.length ? (
        <ul className="lpw-list">{rows.map((g) => <GoalCard key={g.id} goal={g} busy={busy} onAnswer={onAnswer} />)}</ul>
      ) : <p className="lpw-sub">None yet. {nameCase(name)} names what it wants to earn (a GPU, its own server…) from its own seat; you answer when it has earned it.</p>}
    </section>
  );
};
