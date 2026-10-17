// WorkflowMemberLog — ONE member of a team, opened whole (Design note, 2026-10-12:
// […]). Reads the part's work log (team-part-log.js, through
// GET /api/v1/team/runs/:id/log/:stepId): every attempt and how it began,
// the member's reasoning, each act with what came back (and why it failed),
// its words, its waits for the model and the run's responses when it stopped
// short — in the order it happened. The log is the member's own record on
// disk, so it reads the same after a reload, a crash or the run's end. While
// the member works it is read on every few seconds, from where the window
// left off.

import { useEffect, useState } from 'react';
import { readPartLog } from './team-client.js';
import { StopMemberButton } from './TeamRunControls.jsx';
import { WorkflowSteer } from './WorkflowSteer.jsx';
import './WorkflowMemberLog.css';

/** How often a working member's log is read on. */
export const LOG_POLL_MS = 3000;

const HOW = Object.freeze({
  brief: 'BRIEFED',
  failed: 'CONTINUED — IT HAD STOPPED SHORT',
  unfinished: 'CONTINUED — SENT BACK TO FINISH',
  steered: 'CONTINUED — WITH YOUR GUIDANCE',
  resumed: 'CONTINUED — THE RUN WAS PICKED UP AGAIN',
  'wrap-up': 'HANDING IN — ITS CLOCK RAN OUT',
});
const ENDS = Object.freeze({
  answered: 'ANSWERED',
  failed: 'STOPPED SHORT',
  unfinished: 'ANSWERED — BUT DID NOT FINISH',
  steered: 'PAUSED FOR YOUR GUIDANCE',
  stopped: 'STOPPED',
  'wrap-up': 'CUT BY ITS CLOCK — TO HAND IN WHAT IT HAS',
});
// What a clock did when it passed (team-clock.js, #577).
const CLOCK_DID = Object.freeze({ notify: 'YOU WERE TOLD — IT KEPT WORKING', 'wrap-up': 'IT WAS ASKED TO HAND IN WHAT IT HAS', stop: 'IT WAS STOPPED — RESUME TO CONTINUE' });
const CLOCK_BY = Object.freeze({ work: 'ITS WORKING TIME RAN OUT', due: 'ITS DUE TIME CAME' });

const clock = (at) => (at ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '');
const head = (text, n = 120) => (text.length > n ? `${text.slice(0, n).trimEnd()}…` : text);

// pure — consecutive reasoning (or words) entries read as one block; each
// attempt is numbered where it opens.
const logBlocks = (entries) => {
  let attempt = 0;
  return entries.reduce((acc, e) => {
    const last = acc[acc.length - 1];
    if ((e.kind === 'thought' || e.kind === 'words') && last?.kind === e.kind) {
      acc[acc.length - 1] = { ...last, text: last.text + e.text };
      return acc;
    }
    if (e.kind === 'open') attempt += 1;
    acc.push(e.kind === 'open' ? { ...e, attempt } : e);
    return acc;
  }, []);
};

// One entry of the log, as the operator reads it.
const LogEntry = ({ e, latest }) => {
  const time = <span className="workflow-log-time">{clock(e.at)}</span>;
  if (e.kind === 'open') {
    return (
      <li className="workflow-log-open">
        <span className="label-data">ATTEMPT {e.attempt} · {HOW[e.how] || String(e.how).toUpperCase()}</span> {time}
        {e.why ? <span className="workflow-log-why"> — {e.why}</span> : null}
        <details className="workflow-log-fold">
          <summary className="label-data">{e.how === 'brief' ? 'THE BRIEF' : 'WHAT IT WAS TOLD'}</summary>
          <pre className="workflow-log-text">{e.text}</pre>
        </details>
      </li>
    );
  }
  if (e.kind === 'thought') {
    return (
      <li className="workflow-log-thought">
        <details className="workflow-log-fold" open={latest}>
          <summary><span className="label-data">THINKING</span> {time} <span className="workflow-log-gist">{head(e.text)}</span></summary>
          <pre className="workflow-log-text">{e.text}</pre>
        </details>
      </li>
    );
  }
  if (e.kind === 'words') {
    return (
      <li className="workflow-log-words">
        <span className="label-data">SAID</span> {time}
        <pre className="workflow-log-text">{e.text}</pre>
      </li>
    );
  }
  if (e.kind === 'act') {
    const settled = e.status !== 'executing';
    return (
      <li className={`workflow-log-act is-${String(e.status).toLowerCase()}`}>
        <span className="label-data">{settled ? '■' : '▸'} {e.tool} {String(e.status).toUpperCase()}</span> {time}
        {e.summary ? <span className="workflow-log-gist"> {e.summary}</span> : null}
        {e.detail ? (
          <details className="workflow-log-fold" open={settled && e.status !== 'ok'}>
            <summary className="label-data">{e.status === 'ok' ? 'WHAT CAME BACK' : 'WHY'}</summary>
            <pre className="workflow-log-text">{e.detail}</pre>
          </details>
        ) : null}
        {e.sources?.length ? (
          <ol className="workflow-log-sources">
            {e.sources.map((src, i) => (
              <li key={`${src.url}-${i}`}>
                <a href={src.url} target="_blank" rel="noopener noreferrer">{src.title || src.url}</a>
              </li>
            ))}
          </ol>
        ) : null}
      </li>
    );
  }
  if (e.kind === 'clock') {
    return (
      <li className="workflow-log-clock label-data">
        CLOCK PASSED — {CLOCK_BY[e.by] || 'ITS CLOCK RAN OUT'} ({e.clock}): {CLOCK_DID[e.then] || String(e.then).toUpperCase()} {time}
      </li>
    );
  }
  if (e.kind === 'line') {
    return (
      <li className="workflow-log-line label-data">
        {e.state === 'waiting'
          ? `WAITING ITS TURN FOR THE MODEL${e.position ? ` — ${e.position} IN LINE` : ''}${e.ahead?.length ? ` (BEHIND ${e.ahead.join(', ')})` : ''}`
          : 'HAS THE MODEL — WORKING'} {time}
      </li>
    );
  }
  if (e.kind === 'retry') {
    return (
      <li className="workflow-log-retry label-data">
        THE RUN WILL CONTINUE IT{e.inMs ? ` IN ${Math.round(e.inMs / 1000)}s` : ''} — {e.why} {time}
      </li>
    );
  }
  if (e.kind === 'end') {
    return (
      <li className={`workflow-log-end label-data is-${e.outcome}`}>
        {ENDS[e.outcome] || String(e.outcome).toUpperCase()}{e.why ? ` — ${e.why}` : ''} {time}
      </li>
    );
  }
  return null;
};

/**
 * The log, entry by entry, in the order it happened — the latest reasoning
 * left open while the member works.
 *
 * @param {{entries: Array, working: boolean}} props
 */
export const LogList = ({ entries, working }) => {
  const shown = logBlocks(entries);
  const lastThought = shown.map((e) => e.kind).lastIndexOf('thought');
  return (
    <ol className="workflow-log-list">
      {shown.map((e, i) => <LogEntry key={`${e.at}-${i}`} e={e} latest={i === lastThought && working} />)}
    </ol>
  );
};

/**
 * @param {Object} props
 * @param {Object} props.run - the run, as the desk's store holds it
 * @param {Object} props.entry - the member's board entry ({ id, member, state })
 * @param {Function} props.onBack - back to the whole team
 */
export const WorkflowMemberLog = ({ run, entry, onBack }) => {
  const live = run.phase === 'live';
  const [log, setLog] = useState({ entries: [], next: 0, task: '', error: '', loaded: false });

  useEffect(() => {
    let alive = true;
    let timer = null;
    let next = 0;
    // A fresh read (another member, or the run just settled) starts whole.
    setLog({ entries: [], next: 0, task: '', error: '', loaded: false });
    const read = async () => {
      // Read on until the log is whole, from where the window left off.
      for (;;) {
        const page = await readPartLog(run.id, entry.id, next);
        if (!alive) return;
        if (!page.ok) {
          setLog((prior) => ({ ...prior, error: page.error, loaded: true }));
          break;
        }
        next = page.next;
        setLog((prior) => ({
          entries: page.entries.length ? [...prior.entries, ...page.entries] : prior.entries,
          next: page.next, task: page.task || prior.task, error: '', loaded: true,
        }));
        if (page.next >= page.total || !page.entries.length) break;
      }
      if (alive && live) timer = setTimeout(read, LOG_POLL_MS);
    };
    read();
    return () => { alive = false; clearTimeout(timer); };
  }, [run.id, entry.id, live]);

  const working = live && (entry.state === 'working' || entry.state === 'waiting');
  return (
    <section className="workflow-log" aria-label={`${entry.member} — the whole log`}>
      <header className="workflow-log-head">
        <button type="button" className="workflow-log-back label-data" onClick={onBack}>← THE WHOLE TEAM</button>
        <span className="workflow-member">{entry.member}</span>
        <span className="workflow-step label-data">{entry.id}</span>
        <span className="workflow-rowstate label-data">{String(entry.state || '').toUpperCase()}</span>
        {live && entry.state === 'working' ? <StopMemberButton runId={run.id} stepId={entry.id} /> : null}
      </header>
      {log.task ? <p className="workflow-goal">{log.task}</p> : null}
      {log.error ? <p className="workflow-member-failure label-data">THE LOG COULD NOT BE READ — {log.error}</p> : null}
      {log.loaded && !log.error && !log.entries.length ? (
        <p className="workflow-hint label-data">
          {entry.state === 'waiting' ? 'NOT STARTED YET — ITS LOG BEGINS WHEN IT DOES.' : 'THIS PART KEPT NO LOG — IT RAN BEFORE PARTS WERE LOGGED.'}
        </p>
      ) : null}
      <LogList entries={log.entries} working={working} />
      {working ? <WorkflowSteer runId={run.id} entry={entry} notes={run.notes?.[entry.id] || []} /> : null}
    </section>
  );
};
