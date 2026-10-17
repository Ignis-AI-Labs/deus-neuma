// WorkflowTune — the operator's hand on what GOVERNS a working run (#577): how
// many parts work at once, and how long the run — or one part — may work.
//
// Design note, 2026-10-13: the deadline […]; the concurrency cap […]. The same change
// the house's Optio and the run's lead make with team/tune — every desk is
// told who changed what. The window shows the server's own words for every
// clock (team-clock.js governsOf); it never re-derives a rule.

import { useEffect, useState } from 'react';
import { tuneTeamRun } from './team-client.js';
import './WorkflowTune.css';

/** How often a working part's clock line moves. */
export const CLOCK_TICK_MS = 15_000;
/** The check-in cadences the window offers, in minutes (0 = none). */
export const CHECK_IN_CHOICES = Object.freeze([0, 30, 60, 120, 240]);

// pure — a span of time as the window says it: "45m", "2h", "1h 30m".
export const spanOf = (ms) => {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  return h ? `${h}h` : `${m}m`;
};

const PASSED_DID = Object.freeze({
  notify: 'YOU WERE TOLD; IT KEEPS WORKING',
  'wrap-up': 'HANDING IN WHAT IT HAS',
  stop: 'STOPPED — RESUME THE RUN TO CONTINUE IT',
});

/**
 * Where one part's clock stands, in one line — null when it has no clock and
 * has not worked yet. Pure.
 * @param {Object} args
 * @param {?{words: string, limitMs: ?number, dueMs: ?number}} args.partClock - governsOf's view of its clock
 * @param {number} [args.worked] - working ms so far
 * @param {?number} [args.since] - epoch ms its current working stretch began
 * @param {?{clock: string, then: string}} [args.passed] - what its clock did
 * @param {number} [args.now]
 * @returns {?string}
 */
export const clockLineOf = ({ partClock = null, worked = 0, since = null, passed = null, now = Date.now() }) => {
  const total = worked + (since ? Math.max(0, now - since) : 0);
  const done = `WORKED ${spanOf(total)}`;
  if (passed) return `${done} · ITS CLOCK PASSED (${passed.clock}) — ${PASSED_DID[passed.then] || 'IT ACTED'}`;
  if (!partClock?.limitMs && !partClock?.dueMs) return total ? `${done} · NO CLOCK` : null;
  const left = [
    partClock.limitMs ? `${spanOf(partClock.limitMs - total)} OF WORK LEFT` : null,
    partClock.dueMs ? (partClock.dueMs > now ? `DUE IN ${spanOf(partClock.dueMs - now)}` : 'PAST DUE') : null,
  ].filter(Boolean);
  return `${done} · CLOCK: ${partClock.words} · ${left.join(' · ')}`;
};

// impure — the time, moving every `everyMs` while there is something to move.
const useNow = (everyMs) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!everyMs) return undefined;
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
};

/**
 * The form a clock is set with: working time ("2h", "90m"), or a calendar
 * due, and what happens when it passes. A part may also go back to the
 * run's clock.
 */
const ClockEditor = ({ runId, stepId = null, current = null, onClose }) => {
  const [work, setWork] = useState(current?.work ? `${current.work}m` : '');
  const [dueDate, setDueDate] = useState(current?.dueDate || '');
  const [dueTime, setDueTime] = useState(current?.dueTime || '');
  const [then, setThen] = useState(current?.then || 'wrap-up');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const send = async (clock) => {
    setBusy(true);
    setError('');
    const outcome = await tuneTeamRun(runId, { clock, ...(stepId ? { stepId } : {}) });
    setBusy(false);
    if (outcome.ok) onClose();
    else setError(outcome.error);
  };
  const set = () => send({
    ...(work.trim() ? { work: work.trim() } : {}),
    ...(dueDate ? { dueDate } : {}),
    ...(dueDate && dueTime ? { dueTime } : {}),
    then,
  });
  return (
    <div className="workflow-clock-editor">
      <label className="workflow-clock-field label-data">
        WORKING TIME
        <input className="workflow-clock-input" value={work} placeholder="2h, 90m" onChange={(e) => setWork(e.target.value)} />
      </label>
      <label className="workflow-clock-field label-data">
        OR DUE
        <input className="workflow-clock-input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        <input className="workflow-clock-input" type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
      </label>
      <label className="workflow-clock-field label-data">
        THEN
        <select className="workflow-clock-input" value={then} onChange={(e) => setThen(e.target.value)}>
          <option value="wrap-up">WRAP UP — HAND IN WHAT IT HAS</option>
          <option value="notify">NOTIFY — TELL ME, KEEP WORKING</option>
          <option value="stop">STOP — RESUMABLE</option>
        </select>
      </label>
      <div className="workflow-clock-actions">
        <button type="button" className="workflow-tune-btn label-data" disabled={busy || (!work.trim() && !dueDate)} onClick={set}>SET CLOCK</button>
        <button type="button" className="workflow-tune-btn label-data" disabled={busy} onClick={() => send('none')}>NO CLOCK</button>
        {stepId ? <button type="button" className="workflow-tune-btn label-data" disabled={busy} onClick={() => send(null)}>USE THE RUN&apos;S CLOCK</button> : null}
        <button type="button" className="workflow-tune-btn label-data" onClick={onClose}>CANCEL</button>
      </div>
      {error ? <span className="workflow-steer-error label-data">{error}</span> : null}
    </div>
  );
};

/**
 * The run's width and clock, under its header — and, while it works, the
 * operator's hands on both.
 * @param {{run: Object, live: boolean}} props
 */
export const RunGovern = ({ run, live }) => {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const width = run.concurrency ?? null;
  const tune = async (change) => {
    setBusy(true);
    setError('');
    const outcome = await tuneTeamRun(run.id, change);
    setBusy(false);
    if (!outcome.ok) setError(outcome.error);
  };
  const widen = (n) => tune({ concurrency: n });
  const cadence = run.checkIn ?? 60;
  const choices = CHECK_IN_CHOICES.includes(cadence) ? CHECK_IN_CHOICES : [...CHECK_IN_CHOICES, cadence].sort((a, b) => a - b);
  return (
    <section className="workflow-govern">
      <span className="workflow-govern-label label-data">AT ONCE</span>
      {live && width ? (
        <button type="button" className="workflow-tune-btn label-data" aria-label="fewer parts at once" disabled={busy || width <= 1} onClick={() => widen(width - 1)}>−</button>
      ) : null}
      <span className="workflow-govern-value label-data">{width ?? 'AS THE RIG ALLOWS'}{width && run.ceiling ? ` OF ${run.ceiling}` : ''}</span>
      {live && width ? (
        <button type="button" className="workflow-tune-btn label-data" aria-label="more parts at once" disabled={busy || (run.ceiling != null && width >= run.ceiling)} onClick={() => widen(width + 1)}>+</button>
      ) : null}
      <span className="workflow-govern-label label-data">CLOCK</span>
      <span className="workflow-govern-clock">{run.clockWords || 'no clock — works until done or stopped'}</span>
      {live ? (
        <button type="button" className="workflow-tune-btn label-data" onClick={() => setEditing(!editing)}>{editing ? 'CLOSE' : 'SET THE RUN\'S CLOCK'}</button>
      ) : null}
      <span className="workflow-govern-label label-data">CHECK-INS</span>
      {live ? (
        <select className="workflow-clock-input" aria-label="check-in cadence" value={cadence} disabled={busy} onChange={(e) => tune({ checkIn: Number(e.target.value) })}>
          {choices.map((m) => <option key={m} value={m}>{m ? `EVERY ${spanOf(m * 60_000)}` : 'NONE'}</option>)}
        </select>
      ) : <span className="workflow-govern-clock">{cadence ? `every ${spanOf(cadence * 60_000)}` : 'none'}</span>}
      {run.tunedBy ? <span className="workflow-hint label-data">LAST CHANGED BY {String(run.tunedBy.by).toUpperCase()}</span> : null}
      {error ? <span className="workflow-steer-error label-data">{error}</span> : null}
      {editing ? <ClockEditor runId={run.id} current={run.clock} onClose={() => setEditing(false)} /> : null}
    </section>
  );
};

/**
 * One part's clock: its working time, what is left, what its clock did — and,
 * while the part is not settled, the operator's hand on its own clock.
 */
export const MemberClock = ({ runId, stepId, live, open, partClock = null, own = null, worked = 0, since = null, passed = null }) => {
  const now = useNow(since ? CLOCK_TICK_MS : null);
  const [editing, setEditing] = useState(false);
  const line = clockLineOf({ partClock, worked, since, passed, now });
  if (!line && !(live && open)) return null;
  return (
    <div className="workflow-clock">
      {line ? <p className={`workflow-clock-line label-data${passed ? ' is-passed' : ''}`}>{line}</p> : null}
      {live && open ? (
        <button type="button" className="workflow-tune-btn label-data" onClick={() => setEditing(!editing)}>{editing ? 'CLOSE' : 'SET ITS CLOCK'}</button>
      ) : null}
      {editing ? (
        <ClockEditor runId={runId} stepId={stepId} current={own && own !== 'none' ? own : null} onClose={() => setEditing(false)} />
      ) : null}
    </div>
  );
};
