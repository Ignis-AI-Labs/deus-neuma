// WorkflowMember — one member of a team run, opened up in the WORKFLOW window:
// its reasoning, its words and every tool it reaches for (HANDS) AS THEY
// ARRIVE while it works, then its
// finished part (the work product, check-in and torch stripped), or why it
// failed — and where it stands: waiting its turn for the model, or stopped
// short with the run about to continue it. OPEN LOG opens the member alone,
// its whole log (WorkflowMemberLog.jsx). Reads the desk's team-run store
// (team-runs-reducer.js). Display only — the STOP beside it is
// TeamRunControls'.
//
// Memoized on its own slice of the run: members stream several frames a
// second, and one member's words must not repaint every other panel.

import { memo, useState } from 'react';
import { StopMemberButton } from './TeamRunControls.jsx';
import { WorkflowSteer } from './WorkflowSteer.jsx';
import { MemberClock } from './WorkflowTune.jsx';

const STATE_GLYPHS = Object.freeze({ done: '■', working: '▸', waiting: '□', failed: '×', interrupted: '×' });

/** How much of a live reasoning tail the panel shows at once (the store keeps more). */
const THOUGHT_VIEW_CHARS = 4000;

const NO_STREAM = Object.freeze({ text: '', thought: '' });
const NONE = Object.freeze([]);
// The states that open a member by themselves: the work happening, what went
// wrong, or where it stopped.
const OPENS = Object.freeze(new Set(['working', 'failed', 'interrupted']));

// pure — where a working member stands, in one line: waiting its turn for
// the model, or stopped short with the run about to continue it. Null when
// it is simply working.
export const standingOf = (line, retry) => {
  if (retry?.kind === 'unfinished') return `SENT BACK TO FINISH — ${retry.why}`;
  if (retry) return `STOPPED SHORT — ${retry.why}. THE RUN CONTINUES IT${retry.inMs ? ` IN ${Math.round(retry.inMs / 1000)}s` : ''}, WHERE IT STOPPED.`;
  if (line?.state === 'waiting') {
    const ahead = line.ahead?.length ? ` — BEHIND ${line.ahead.join(', ')}` : '';
    return `WAITING ITS TURN FOR THE MODEL${line.position ? ` (${line.position} IN LINE)` : ''}${ahead}`;
  }
  // Held by its run's own width (#577) — not by the model.
  if (line?.state === 'held') {
    return `HELD — THE RUN WORKS ${line.of ?? '?'} AT A TIME${line.position ? ` · ${line.position} IN ITS LINE` : ''}`;
  }
  return null;
};

// pure — the line a member with nothing to show yet reads, honest to whether
// the run is still going and why a part never began.
const hintOf = (state, live, skipped) => {
  if (skipped) return 'NEVER STARTED — A PART IT NEEDED DID NOT FINISH.';
  if (state === 'waiting') return live ? 'WAITING ON ITS TURN.' : 'NEVER STARTED.';
  if (state === 'interrupted') return 'INTERRUPTED BEFORE IT ANSWERED.';
  return 'NOTHING YET.';
};

/**
 * @param {Object} props
 * @param {Object} props.entry - the board entry ({ id, member, state, status })
 * @param {string} props.runId
 * @param {boolean} props.live - the run is working
 * @param {?Object} [props.stream] - { text, thought } live tails
 * @param {?string} [props.part] - the finished part
 * @param {?string} [props.failure] - why the part failed
 * @param {?Array} [props.tools] - tool events
 * @param {?Array} [props.notes] - the operator's guidance ({ note, at })
 * @param {boolean} [props.skipped] - never started: a part it needed did not finish
 * @param {?Object} [props.line] - its place in the model's line ({ state, position, ahead })
 * @param {?Object} [props.retry] - the run's response to it stopping short ({ kind, why, inMs })
 * @param {?Function} [props.onOpenLog] - open this member alone, its whole log (stepId)
 * @param {?Object} [props.partClock] - its clock as the server words it ({ words, limitMs, dueMs })
 * @param {*} [props.ownClock] - its own clock setting, 'none', or nothing (it inherits the run's)
 * @param {number} [props.worked] - its working ms so far
 * @param {?number} [props.since] - when its current working stretch began
 * @param {?Object} [props.passed] - what its clock did once it passed ({ clock, then, by })
 */
const WorkflowMemberRow = ({
  entry, runId, live, stream = NO_STREAM, part = null, failure = null, tools = NONE, notes = NONE, skipped = false,
  line = null, retry = null, onOpenLog = null,
  partClock = null, ownClock = null, worked = 0, since = null, passed = null,
}) => {
  // A member a settled run left mid-part failed (the run says why) or was
  // interrupted (its backend stopped) — it is not working.
  const state = !live && entry.state === 'working' ? (failure ? 'failed' : 'interrupted') : entry.state;
  // A working, failed or interrupted member opens by itself — the work
  // happening, what went wrong, where it stopped — and stays open once its
  // part lands, so the words being watched never snap shut; once the
  // operator toggles, theirs rules.
  const [toggled, setToggled] = useState(null);
  const [shown, setShown] = useState(false);
  if (!shown && OPENS.has(state)) setShown(true);
  const open = toggled ?? (shown || OPENS.has(state));
  const thought = stream.thought.length > THOUGHT_VIEW_CHARS
    ? `…${stream.thought.slice(-THOUGHT_VIEW_CHARS)}`
    : stream.thought;
  const standing = live && state === 'working' ? standingOf(line, retry) : null;
  return (
    <li className={`workflow-row is-${state}${open ? ' is-open' : ''}`}>
      <button type="button" className="workflow-row-head" onClick={() => setToggled(!open)} aria-expanded={open}>
        <span className="workflow-glyph">{STATE_GLYPHS[state] || '□'}</span>
        <span className="workflow-step label-data">{entry.id}</span>
        <span className="workflow-member">{entry.member}</span>
        <span className="workflow-rowstate label-data">{String(state || '').toUpperCase()}</span>
        {entry.status ? <span className="workflow-status">{entry.status}</span> : null}
      </button>
      {live && state === 'working' ? <StopMemberButton runId={runId} stepId={entry.id} /> : null}
      {onOpenLog && state !== 'waiting' ? (
        <button type="button" className="workflow-open-log label-data" onClick={() => onOpenLog(entry.id)}>OPEN LOG</button>
      ) : null}
      {standing ? <p className={`workflow-standing label-data${retry ? ' is-retry' : ''}`}>{standing}</p> : null}
      <MemberClock
        runId={runId} stepId={entry.id} live={live} open={state === 'working' || state === 'waiting'}
        partClock={partClock} own={ownClock} worked={worked || 0} since={since} passed={passed}
      />
      {open ? (
        <div className="workflow-member-panel">
          {thought ? (
            <section className="workflow-member-thought">
              <h4 className="workflow-h label-data">THINKING</h4>
              <pre className="workflow-member-text">{thought}</pre>
            </section>
          ) : null}
          {tools.length > 0 ? (
            <section className="workflow-member-tools">
              <h4 className="workflow-h label-data">HANDS</h4>
              <ol className="workflow-member-tool-list">
                {tools.map((t, i) => (
                  <li key={i} className={`workflow-member-tool is-${String(t.status).toLowerCase()}`}>
                    <span className="label-data">{t.tool}</span> <span className="label-data">{String(t.status).toUpperCase()}</span>
                    {t.summary ? <span className="workflow-member-tool-summary"> {t.summary}</span> : null}
                    {/* An act that went wrong says why — "web_fetch — failed" alone told the operator nothing. */}
                    {t.detail && t.status !== 'ok' && t.status !== 'executing'
                      ? <span className="workflow-member-tool-why"> — {t.detail}</span>
                      : null}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          {part != null ? (
            <section className="workflow-member-part">
              <h4 className="workflow-h label-data">THE PART</h4>
              <pre className="workflow-member-text">{part}</pre>
            </section>
          ) : stream.text ? (
            <section className="workflow-member-words">
              <h4 className="workflow-h label-data">{state === 'working' ? 'WRITING' : 'WORDS'}</h4>
              <pre className="workflow-member-text">{stream.text}</pre>
            </section>
          ) : null}
          {failure ? <p className="workflow-member-failure label-data">FAILED — {failure}</p> : null}
          {live && (state === 'working' || state === 'waiting')
            ? <WorkflowSteer runId={runId} entry={entry} notes={notes} />
            : null}
          {!live && notes.length ? (
            <p className="workflow-hint label-data">YOUR GUIDANCE: {notes.map((n) => n.note).join(' · ')}</p>
          ) : null}
          {!thought && !stream.text && !tools.length && part == null && !failure ? (
            <p className="workflow-hint label-data">{hintOf(state, live, skipped)}</p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
};

export const WorkflowMember = memo(WorkflowMemberRow);
