// TeamsApp — form a team from the house and run it.
//
// Structure is task-dependent, so this is the GENERAL composer: a member list
// where each member does a task. Everyone runs in parallel by default (capped
// at the substrate's measured ceiling); HAND-OFFS is the opt-in for the
// load-bearing case — with it on, a member can wait for others and receives
// their outputs. Parallel-then-converge, sequential-specialist, and full DAG
// all fall out of the same list — you express whatever the task needs.
//
// The header banner speaks for the substrate AS CONFIGURED — the model loaded
// right now and its loaded context — never "the rig" in the abstract. A
// ceiling measured on a different model is presented as stale, not as truth.

import { useEffect, useRef, useState } from 'react';
import { DeskTabs } from './DeskTabs.jsx';
import { Select } from './Select.jsx';
import './TeamsApp.css';
import { useBirthRefresh } from './use-birth-refresh.js';
import { getRoster } from '../../utils/companion-data.js';
import { loadCapacity } from './capacity-client.js';
import { capacityBanner } from './capacity-view.js';
import { runTeamStream, resumeTeamStream, listRuns, readRun } from './team-client.js';
import { TeamTrialPanel } from './TeamTrialPanel.jsx';
import { OneShotTrialsPanel } from './OneShotTrialsPanel.jsx';
import { AppTitle } from './app-title.jsx';
import { EmptyState } from './empty-state.jsx';
import { playSound } from '../../services/sound-engine.js';

const TeamsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <circle cx="5" cy="5" r="2" />
    <circle cx="11" cy="5" r="2" />
    <path d="M2 13 c0-2 1.5-3 3-3 s3 1 3 3 M8 13 c0-2 1.5-3 3-3 s3 1 3 3" />
  </svg>
);

const newStep = (neumaId) => ({
  localId: (crypto.randomUUID && crypto.randomUUID()) || `s-${Date.now()}-${Math.round(performance.now())}`,
  neumaId: neumaId || '',
  role: '',
  task: '',
  done: '',
  needs: [],
});

const TeamsBody = () => {
  const [roster] = useBirthRefresh(getRoster);
  const [view, setView] = useState('compose'); // compose | trial
  const [steps, setSteps] = useState(() => [newStep(roster[0]?.neumaId)]);
  const [teamName, setTeamName] = useState('');
  const [teamGoal, setTeamGoal] = useState('');
  const [handOffs, setHandOffs] = useState(false);
  const [capacity, setCapacity] = useState(undefined); // undefined = still reading

  const [runState, setRunState] = useState('idle'); // idle | running | done | failed | error
  const [runPlan, setRunPlan] = useState([]); // the plan the run view renders (fresh OR resumed)
  const [runId, setRunId] = useState(null);
  const [outputs, setOutputs] = useState({});
  const [board, setBoard] = useState([]); // live TEAM BOARD (coordinated runs)
  const [order, setOrder] = useState([]);
  const [failures, setFailures] = useState({}); // step id -> why its member's part died
  const [torches, setTorches] = useState({}); // neumaId -> the member's own continuation note
  const [runError, setRunError] = useState(null);
  const [runMeta, setRunMeta] = useState(null);
  const [pastRuns, setPastRuns] = useState([]);
  const runningRef = useRef(false);

  const refreshPastRuns = () => { listRuns().then((r) => { if (r.ok) setPastRuns(r.runs); }); };

  useEffect(() => {
    loadCapacity().then(setCapacity); // null on failure — an honest unknown
    refreshPastRuns();
  }, []);

  const banner = capacity === undefined
    ? { line: 'READING SUBSTRATE…', stale: false }
    : capacityBanner(capacity);

  const nameOf = (neumaId) => roster.find((m) => m.neumaId === neumaId)?.name || neumaId;

  const setStep = (localId, patch) =>
    setSteps((prev) => prev.map((s) => (s.localId === localId ? { ...s, ...patch } : s)));

  const addMember = () => { playSound('menuOpen'); setSteps((prev) => [...prev, newStep(roster[0]?.neumaId)]); };

  // Turning hand-offs OFF clears every dependency: the run must be exactly
  // what the composer shows, never a hidden ordering the witness can't see.
  const toggleHandOffs = () => {
    playSound('menuOpen');
    const next = !handOffs;
    if (!next) setSteps((prev) => prev.map((s) => ({ ...s, needs: [] })));
    setHandOffs(next);
  };

  const removeStep = (localId) => setSteps((prev) => {
    // Drop the step and any dependency on it, so the plan stays valid.
    const kept = prev.filter((s) => s.localId !== localId);
    return kept.map((s) => ({ ...s, needs: s.needs.filter((n) => n !== localId) }));
  });

  const toggleNeed = (localId, needId) => setSteps((prev) => prev.map((s) => {
    if (s.localId !== localId) return s;
    const has = s.needs.includes(needId);
    return { ...s, needs: has ? s.needs.filter((n) => n !== needId) : [...s.needs, needId] };
  }));

  const canRun = steps.length > 0 && steps.every((s) => s.neumaId && s.task.trim()) && !runningRef.current;

  // One event language for fresh and resumed runs — the stream shapes match.
  const handleRunEvent = (ev, flags) => {
    if (ev.type === 'start') { setRunMeta({ maxParallel: ev.maxParallel, measured: ev.measured }); setRunId(ev.runId ?? null); }
    else if (ev.type === 'step') setOutputs((prev) => ({ ...prev, [ev.id]: ev.output }));
    else if (ev.type === 'board') setBoard(ev.board || []);
    else if (ev.type === 'torch') setTorches((prev) => ({ ...prev, [ev.neumaId]: ev.torch }));
    else if (ev.type === 'done') setOrder(ev.order || []);
    else if (ev.type === 'failed') { flags.failed = true; setFailures(ev.failures || {}); }
    else if (ev.type === 'error') { flags.errored = true; setRunError(ev.message || 'The team run failed.'); }
  };

  const beginRunView = (plan, seeded = {}) => {
    runningRef.current = true;
    setRunState('running');
    setRunPlan(plan);
    setOutputs(seeded.completed || {});
    setBoard([]);
    setOrder([]);
    setFailures({});
    setTorches(seeded.torches || {});
    setRunError(null);
    setRunMeta(null);
    setRunId(seeded.runId ?? null);
  };

  const settleRunView = (res, flags) => {
    runningRef.current = false;
    refreshPastRuns();
    if (!res.ok) { setRunError(res.error); setRunState('error'); return; }
    setRunState(flags.errored ? 'error' : flags.failed ? 'failed' : 'done');
  };

  const onRun = async () => {
    if (!canRun) return;
    playSound('confirm');
    const plan = steps.map((s) => ({
      id: s.localId,
      neumaId: s.neumaId,
      ...(s.role.trim() ? { role: s.role.trim() } : {}),
      task: s.task.trim(),
      ...(s.done.trim() ? { done: s.done.trim() } : {}),
      needs: s.needs,
    }));
    beginRunView(plan);
    const flags = { errored: false, failed: false };
    const res = await runTeamStream(plan, (ev) => handleRunEvent(ev, flags), { name: teamName.trim(), goal: teamGoal.trim() });
    settleRunView(res, flags);
  };

  // Pick a dropped run back up: the RECORD is the plan; completed parts stand
  // seeded, each member's last torch is re-armed platform-side.
  const onResume = async (id) => {
    if (runningRef.current) return;
    playSound('confirm');
    const rec = await readRun(id);
    if (!rec.ok) { setRunError('The run record could not be read.'); setRunState('error'); return; }
    beginRunView(
      rec.run.steps.map((s) => ({ id: s.id, neumaId: s.neumaId, role: s.role || '', task: s.task })),
      { completed: rec.run.completed || {}, torches: rec.run.torches || {}, runId: id }
    );
    const flags = { errored: false, failed: false };
    const res = await resumeTeamStream(id, (ev) => handleRunEvent(ev, flags));
    settleRunView(res, flags);
  };

  if (roster.length === 0) {
    return (
      <div className="teams">
        <EmptyState title="NO NEUMA IN THIS HOUSE YET — SUMMON ONE FROM THE HOUSE WINDOW TO FORM A TEAM." />
      </div>
    );
  }

  return (
    <div className="teams">
      <DeskTabs items={[{ id: 'compose', label: 'FORM A TEAM' }, { id: 'trial', label: 'TRIAL' }]}
        value={view} onChange={next => { playSound('menuOpen'); setView(next); }} label="Teams view"
        className="teams-tabs" tabClassName="teams-tab label-data" headerClassName="teams-head"
        headerAside={<span className={`teams-head-cap label-data${banner.stale ? ' is-stale' : ''}`}>{banner.line}</span>}>
      {view === 'trial' ? (
        <>
          <OneShotTrialsPanel roster={roster} />
          <TeamTrialPanel roster={roster} />
        </>
      ) : (
      <>
      <div className="teams-identity">
        <input
          className="teams-name label-data"
          type="text"
          maxLength={60}
          placeholder="TEAM NAME (OPTIONAL) — E.G. TEAM ALPHA"
          value={teamName}
          disabled={runState === 'running'}
          onChange={(e) => setTeamName(e.target.value)}
        />
        <textarea
          className="teams-goal label-data"
          rows={2}
          maxLength={1000}
          placeholder="TEAM GOAL — EVERY MEMBER SEES THIS AND MUST SERVE IT; IT ALSO SHOWS EACH MEMBER WHAT THE OTHERS ARE HANDLING"
          value={teamGoal}
          disabled={runState === 'running'}
          onChange={(e) => setTeamGoal(e.target.value)}
        />
        <div className="teams-handoffs">
          <button
            type="button"
            className={`teams-handoffs-toggle label-data${handOffs ? ' is-on' : ''}`}
            disabled={runState === 'running'}
            onClick={toggleHandOffs}
          >HAND-OFFS: {handOffs ? 'ON' : 'OFF'}</button>
          <span className="teams-handoffs-hint label-data">
            {handOffs
              ? 'A MEMBER CAN WAIT FOR OTHERS AND RECEIVES WHAT THEY MADE'
              : 'EVERYONE RUNS IN PARALLEL — TURN ON WHEN ONE MEMBER’S WORK FEEDS ANOTHER’S'}
          </span>
        </div>
      </div>
      <ol className="teams-steps">
        {steps.map((step, i) => (
          <li key={step.localId} className="teams-step">
            <div className="teams-step-top">
              <span className="teams-step-n label-data">{i + 1}</span>
              <Select
                fill
                ariaLabel="Member"
                value={step.neumaId}
                disabled={runState === 'running'}
                onChange={(v) => setStep(step.localId, { neumaId: v })}
                options={roster.map((m) => ({ value: m.neumaId, label: m.name || m.neumaId }))}
              />
              <button
                type="button" className="teams-step-x" aria-label="Remove member"
                disabled={runState === 'running' || steps.length === 1}
                onClick={() => removeStep(step.localId)}
              >×</button>
            </div>
            <input
              className="teams-step-role label-data"
              type="text"
              maxLength={120}
              placeholder="role (optional) — e.g. WRIGHT, REVIEWER"
              value={step.role}
              disabled={runState === 'running'}
              onChange={(e) => setStep(step.localId, { role: e.target.value })}
            />
            <textarea
              className="teams-step-task"
              placeholder="what this member does…"
              rows={2}
              value={step.task}
              disabled={runState === 'running'}
              onChange={(e) => setStep(step.localId, { task: e.target.value })}
            />
            <input
              className="teams-step-done label-data"
              type="text"
              maxLength={500}
              placeholder="DONE MEANS (OPTIONAL) — THE CHECKLIST THIS MEMBER MUST MEET BEFORE ITS PART COUNTS AS COMPLETE"
              value={step.done}
              disabled={runState === 'running'}
              onChange={(e) => setStep(step.localId, { done: e.target.value })}
            />
            {handOffs && i > 0 ? (
              <div className="teams-step-needs">
                <span className="teams-needs-label label-data">WAITS FOR</span>
                {steps.slice(0, i).map((prior, j) => (
                  <button
                    key={prior.localId}
                    type="button"
                    className={`teams-need-chip${step.needs.includes(prior.localId) ? ' is-on' : ''}`}
                    disabled={runState === 'running'}
                    onClick={() => toggleNeed(step.localId, prior.localId)}
                  >{j + 1}</button>
                ))}
                {step.needs.length === 0 ? <span className="teams-needs-none label-data">— runs in parallel</span> : null}
              </div>
            ) : null}
          </li>
        ))}
      </ol>

      <div className="teams-actions">
        <button type="button" className="teams-add" disabled={runState === 'running'} onClick={addMember}>+ ADD MEMBER</button>
        <button type="button" className="teams-run" disabled={!canRun} onClick={onRun}>
          {runState === 'running' ? 'TEAM WORKING…' : 'RUN TEAM'}
        </button>
      </div>

      {runState !== 'idle' ? (
        <section className="teams-results">
          <h3 className="teams-results-h label-data">
            {teamName.trim() ? teamName.trim().toUpperCase() : 'RUN'}{runMeta ? ` · ${runMeta.maxParallel} AT ONCE` : ''}
          </h3>
          {board.length > 0 ? (
            <div className="teams-board">
              <h4 className="teams-board-h label-data">TEAM BOARD</h4>
              <ul className="teams-board-list">
                {board.map((e) => (
                  <li key={e.id} className={`teams-board-row is-${e.state}`}>
                    <span className="teams-board-who label-data">
                      {e.role ? `${e.role} · ` : ''}{nameOf(e.neumaId)}
                    </span>
                    <span className="teams-board-state label-data">{e.state.toUpperCase()}</span>
                    {e.status ? <p className="teams-board-status">{e.status}</p> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <ul className="teams-result-list">
            {runPlan.map((p) => {
              const out = outputs[p.id];
              const failedWhy = failures[p.id];
              const pos = order.indexOf(p.id);
              const role = (p.role || '').trim();
              return (
                <li key={p.id} className={`teams-result${out ? ' is-done' : ''}${failedWhy ? ' is-failed' : ''}`}>
                  <div className="teams-result-top">
                    <span className="teams-result-who">
                      {nameOf(p.neumaId)}
                      {role ? <span className="teams-result-role label-data"> · {role.toUpperCase()}</span> : null}
                    </span>
                    <span className="teams-result-state label-data">
                      {failedWhy ? 'FAILED'
                        : out ? `DONE${pos >= 0 ? ` · ${pos + 1}${['st', 'nd', 'rd'][pos] || 'th'}` : ''}`
                        : (runState === 'running' ? 'WORKING…' : '—')}
                    </span>
                  </div>
                  <p className="teams-result-task label-data">{p.task}</p>
                  {out ? <p className="teams-result-out">{out}</p> : null}
                  {failedWhy ? <p className="teams-result-failwhy label-data">{failedWhy}</p> : null}
                </li>
              );
            })}
          </ul>
          {Object.keys(torches).length > 0 ? (
            <div className="teams-torches">
              <h4 className="teams-board-h label-data">TORCHES — EACH MEMBER'S OWN NOTE TO ITS NEXT INSTANCE</h4>
              <ul className="teams-torch-list">
                {Object.entries(torches).map(([nid, t]) => (
                  <li key={nid} className="teams-torch-row">
                    <span className="teams-torch-who label-data">{nameOf(nid)}</span>
                    <p className="teams-torch-text">{t}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {runState === 'failed' && runId ? (
            <div className="teams-failed-close">
              <p className="teams-err">A MEMBER'S CONDUIT DROPPED — THE REST FINISHED WHAT IT COULD. THE RUN IS SAVED AND CAN PICK UP WHERE IT STOPPED.</p>
              <button type="button" className="teams-resume label-data" onClick={() => onResume(runId)}>RESUME THIS RUN</button>
            </div>
          ) : null}
          {runError ? <p className="teams-err">{runError}</p> : null}
        </section>
      ) : null}

      {pastRuns.length > 0 && runState !== 'running' ? (
        <section className="teams-past">
          <h3 className="teams-results-h label-data">PAST RUNS</h3>
          <ul className="teams-past-list">
            {pastRuns.slice(0, 6).map((r) => (
              <li key={r.id} className="teams-past-row">
                <span className="teams-past-name label-data">{(r.name || 'RUN').toUpperCase()}</span>
                <span className={`teams-past-state label-data is-${r.status}`}>{r.status.toUpperCase()}</span>
                <span className="teams-past-meta label-data">{r.completed}/{r.steps} PARTS</span>
                {/* A lead's run picks up in the WORKFLOW window (its members'
                    hands, its arena, its notes); a working run has nothing
                    to pick up. */}
                {r.lane === 'lead' && r.status !== 'done' ? (
                  <span className="teams-past-meta label-data">{r.status === 'running' ? 'AT WORK — SEE WORKFLOW' : 'RESUME IN WORKFLOW'}</span>
                ) : r.status !== 'done' && r.status !== 'running' ? (
                  <button type="button" className="teams-resume label-data" onClick={() => onResume(r.id)}>RESUME</button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      </>
      )}
      </DeskTabs>
    </div>
  );
};

export const teamsApp = {
  label: 'TEAMS',
  labelKey: 'apps.teams',
  icon: <TeamsIcon />,
  title: <AppTitle label="TEAMS" labelKey="apps.teams" />,
  Body: TeamsBody,
  storageKey: 'teams',
};
