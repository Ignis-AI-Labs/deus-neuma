// WorkflowApp — the WORKFLOW window: watch the team work in ITS OWN window.
//
// Multi-stream law (ruling, 2026-07-15): agents working in a shared space get a
// substream the operator can open and WATCH without interrupting the main
// stream. Design note, 2026-10-10: […]. The window reads the desk's TEAM-RUN STORE (use-team-runs.js) —
// every run the operator's portal carries, whatever tab or lead filed it,
// seeded from the server on every link up so a reload loses nothing. Per
// run: the live board, each member opened up (its reasoning and words as
// they arrive, then its finished part), every torch pass, and — once the
// run settles — the work history and the delivery desk.
//
// Never a gate: plan approval stays in the chat stream where it was asked.
// The window carries the operator's STOP for a background run — the whole
// run, or one working member (TeamRunControls.jsx). OPEN LOG on a member
// opens that member alone — its whole log, live (WorkflowMemberLog.jsx). The
// TEAM CHANNEL shows what the team tells each other, and carries the
// operator's own word to them (WorkflowChannel.jsx). What GOVERNS the run —
// how many parts work at once, its clock and each part's — sits under its
// head, the operator's hands on both while it works (WorkflowTune.jsx, #577).

import { useEffect, useState } from 'react';
import { useTeamRunsStore } from './team-runs-context.js';
import { AppTitle } from './app-title.jsx';
import { EmptyState } from './empty-state.jsx';
import { DeliveryDesk, WorkHistory } from './TeamRunChip.jsx';
import { StopRunButton } from './TeamRunControls.jsx';
import { WorkflowMember } from './WorkflowMember.jsx';
import { WorkflowMemberLog } from './WorkflowMemberLog.jsx';
import { WorkflowChannel } from './WorkflowChannel.jsx';
import { WorkflowResume } from './WorkflowResume.jsx';
import { RunGovern } from './WorkflowTune.jsx';
import { onCardLanding, takeCardLanding } from './card-landing.js';
import './WorkflowApp.css';

const PHASE_LABELS = Object.freeze({
  done: 'TEAM FINISHED',
  error: 'RUN FAILED',
  stopped: 'RUN STOPPED',
  lost: 'RUN INTERRUPTED',
});

// pure — the runs newest first, every working run ahead of every settled one.
const runList = ({ runs, order }) => {
  const all = [...order].reverse().map((id) => runs[id]);
  return [...all.filter((r) => r.phase === 'live'), ...all.filter((r) => r.phase !== 'live')];
};

// pure — one line naming a run in the picker.
const runLabel = (r) => [r.name || 'TEAM RUN', r.lead, r.phase === 'live' ? 'AT WORK' : (PHASE_LABELS[r.status] || 'SETTLED')]
  .filter(Boolean).join(' · ');

const RunView = ({ run }) => {
  const live = run.phase === 'live';
  // One member opened alone, or the whole team.
  const [focus, setFocus] = useState(null);
  const focused = focus ? (run.board || []).find((e) => e.id === focus) : null;
  if (focused) return <WorkflowMemberLog run={run} entry={focused} onBack={() => setFocus(null)} />;
  return (
    <>
      <header className="workflow-head">
        <span className={`workflow-state label-data ${live ? 'is-live' : run.status === 'done' ? 'is-ok' : 'is-bad'}`}>
          {live ? 'TEAM AT WORK' : PHASE_LABELS[run.status] || 'SETTLED'}
        </span>
        {run.name ? <span className="workflow-name">{run.name}</span> : null}
        {run.lead ? <span className="workflow-lead label-data">LED BY {run.lead.toUpperCase()}</span> : null}
        {live ? <StopRunButton runId={run.id} /> : null}
      </header>
      {run.goal ? <p className="workflow-goal">{run.goal}</p> : null}
      <RunGovern run={run} live={live} />

      <ul className="workflow-board">
        {(run.board || []).map((e) => (
          <WorkflowMember
            key={e.id}
            entry={e}
            runId={run.id}
            live={live}
            stream={run.streams?.[e.id]}
            part={run.parts?.[e.id]}
            failure={run.failures?.[e.id]}
            tools={run.tools?.[e.id]}
            notes={run.notes?.[e.id]}
            skipped={Boolean(run.skipped?.includes(e.id))}
            line={run.lines?.[e.id]}
            retry={run.retries?.[e.id]}
            partClock={run.partClocks?.[e.id]}
            ownClock={run.clocks?.[e.id]}
            worked={run.worked?.[e.id]}
            since={run.workingSince?.[e.id]}
            passed={run.clockState?.[e.id]}
            onOpenLog={setFocus}
          />
        ))}
      </ul>

      <WorkflowChannel runId={run.id} channel={run.channel || []} board={run.board || []} live={live} />

      {(run.torches || []).length > 0 ? (
        <section className="workflow-torches">
          <h3 className="workflow-h label-data">TORCH PASSES — THE WORK, IN THEIR OWN WORDS</h3>
          <ol className="workflow-torch-list">
            {run.torches.map((t, i) => (
              <li key={`${t.stepId}-${i}`} className="workflow-torch">
                <span className="workflow-torch-head label-data">{t.stepId} · {t.member}</span>
                <pre className="workflow-torch-text">{t.torch}</pre>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {!live && run.record ? <WorkHistory record={run.record} /> : null}
      {!live && run.status === 'done' && run.delivery ? <DeliveryDesk delivery={run.delivery} /> : null}
    </>
  );
};

const WorkflowBody = () => {
  const store = useTeamRunsStore();
  const runs = store ? runList(store) : [];
  // A tray card picks its run (card-landing.js): latched for a window it opens, announced to an open one.
  const [picked, setPicked] = useState(() => takeCardLanding('workflow')?.runId ?? null);
  useEffect(() => onCardLanding('workflow', (item) => { if (item?.runId) setPicked(item.runId); }), []);
  const run = runs.find((r) => r.id === picked) || runs[0] || null;
  const waiting = store?.resumable || [];
  const pickUp = waiting.length ? <WorkflowResume runs={waiting} /> : null;

  if (!run) {
    return (
      <div className="workflow">
        {pickUp}
        {pickUp ? null : <EmptyState title="NO TEAM AT WORK YET — WHEN A PLAN IS APPROVED AND THE TEAM RUNS, EVERY MEMBER'S WORK APPEARS HERE LIVE, WITHOUT TOUCHING YOUR CHAT." />}
      </div>
    );
  }
  return (
    <div className="workflow">
      {pickUp}
      {runs.length > 1 ? (
        <nav className="workflow-runs" aria-label="team runs">
          {runs.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`workflow-run-pick label-data${r.id === run.id ? ' is-picked' : ''}${r.phase === 'live' ? ' is-live' : ''}`}
              onClick={() => setPicked(r.id)}
            >
              {runLabel(r)}
            </button>
          ))}
        </nav>
      ) : null}
      <RunView key={run.id} run={run} />
    </div>
  );
};

const WorkflowIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <path d="M2 3.5 H14 M2 8 H14 M2 12.5 H14" />
    <circle cx="4.5" cy="3.5" r="1.4" />
    <circle cx="9" cy="8" r="1.4" />
    <circle cx="12" cy="12.5" r="1.4" />
  </svg>
);

export const workflowApp = {
  label: 'WORKFLOW',
  labelKey: 'apps.workflow',
  icon: <WorkflowIcon />,
  title: <AppTitle label="WORKFLOW" labelKey="apps.workflow" />,
  Body: WorkflowBody,
  storageKey: 'workflow',
};
