// TeamTrialPanel — BRICKWORKS, the locked team benchmark, run from the desk.
//
// The user assigns each SEAT explicitly (HELM, WRIGHT, SMITH, WARDEN, and the
// LEAD who directs refinement waves — one being may hold several seats),
// can read the locked prompts before running, watches the roles work live,
// then gets the objective scorecard — and, when the team shipped a playable
// artifact, the game itself, sandboxed. Past scorecards list below so a
// witness can watch their rig/model improve across time; each card is a
// portable record fit for sharing.
//
// The game plays inside <iframe sandbox="allow-scripts"> via srcdoc: the
// artifact is model-written code, so it runs with NO same-origin access — it
// can render and play, never touch the desk's session.

import { useEffect, useRef, useState } from 'react';
import { Select } from './Select.jsx';
import { runTrialStream, listTrials, loadTrialSpec, readTrial } from './team-client.js';
import { CHECK_LABELS, TRIAL_SEATS, verdictTone, fmtMs, trialSummaryLine, defaultSeatPicks } from './trial-view.js';
import { playSound } from '../../services/sound-engine.js';

export const TeamTrialPanel = ({ roster }) => {
  const [picked, setPicked] = useState(() => defaultSeatPicks(roster));
  const [adjusting, setAdjusting] = useState(false); // seats fold open only on ask
  const [spec, setSpec] = useState(null); // the locked prompts, fetched on open
  const [specDown, setSpecDown] = useState(false);
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [loops, setLoops] = useState(1); // refinement waves after the first draft (0..3)
  const [waves, setWaves] = useState([]); // the run's arc, one entry per scored wave
  const [runState, setRunState] = useState('idle'); // idle | running | done | error
  const [outputs, setOutputs] = useState({});
  const [scorecard, setScorecard] = useState(null);
  const [runError, setRunError] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyDown, setHistoryDown] = useState(false); // platform didn't answer ≠ no trials yet
  const runningRef = useRef(false);

  const refreshHistory = () => {
    listTrials().then(({ ok, trials }) => { setHistory(trials); setHistoryDown(!ok); });
  };
  useEffect(refreshHistory, []);

  const nameOf = (neumaId) => roster.find((m) => m.neumaId === neumaId)?.name || neumaId;

  const setSeat = (i, neumaId) =>
    setPicked((prev) => prev.map((id, j) => (j === i ? neumaId : id)));

  // Reopen a past trial in full — the scorecard AND its game, one click.
  const openPast = async (id) => {
    if (runningRef.current) return;
    playSound('menuOpen');
    const { ok, trial } = await readTrial(id);
    // A run may have started while the card was in flight — the live run owns
    // the panel; the reopen yields rather than overwrite a streaming state.
    if (runningRef.current) return;
    if (!ok || !trial) { setRunError('THAT TRIAL COULD NOT BE OPENED — THE PLATFORM DID NOT ANSWER.'); return; }
    setRunError(null);
    setOutputs({}); // stale per-seat markers belong to the previous run, not this card
    setWaves(trial.waves || []);
    setScorecard(trial);
    setPlaying(false);
    setRunState('done');
  };

  const openPrompts = () => {
    playSound('menuOpen');
    setPromptsOpen((open) => !open);
    if (!spec && !specDown) {
      loadTrialSpec().then(({ ok, spec: s }) => { setSpec(s); setSpecDown(!ok); });
    }
  };

  const canRun = picked.every(Boolean) && !runningRef.current;

  const onRun = async () => {
    if (!canRun) return;
    playSound('confirm');
    runningRef.current = true;
    setRunState('running');
    setOutputs({});
    setWaves([]);
    setScorecard(null);
    setRunError(null);
    setPlaying(false);

    const res = await runTrialStream(picked, loops, (ev) => {
      if (ev.type === 'step') setOutputs((prev) => ({ ...prev, [ev.id]: ev.output }));
      else if (ev.type === 'wave') setWaves((prev) => [...prev, ev]);
      else if (ev.type === 'trial') setScorecard(ev.scorecard);
      else if (ev.type === 'error') setRunError(ev.message || 'The trial failed.');
    });

    runningRef.current = false;
    if (!res.ok) { setRunError(res.error); setRunState('error'); return; }
    setRunState('done');
    refreshHistory();
  };

  return (
    <div className="trial">
      {/* The same card language as the one-shot shelf: one glance, one START.
          Seats and prompts are the ADJUST fold — never setup, always optional
          (the trials law: one click from looking to watching). */}
      <div className="oneshot-bench trial-card-start">
        <div className="oneshot-bench-meta">
          <span className="oneshot-bench-title">BRICKWORKS — Playable Brick-Breaker</span>
          <span className="oneshot-bench-source label-data">
            THE LOCKED TEAM BENCHMARK · SAME TEST ON EVERY RIG, SCORES COMPARE ACROSS TIME · DELIVERABLE HTML
          </span>
        </div>
        <button type="button" className="trial-run" disabled={!canRun} onClick={onRun}>
          {runState === 'running' ? 'RUNNING…' : 'START'}
        </button>
      </div>

      <div className="trial-loops">
        <span className="trial-pick-label label-data">REFINEMENT LOOPS</span>
        {[0, 1, 2, 3].map((n) => (
          <button
            key={n}
            type="button"
            className={`trial-loop-chip${loops === n ? ' is-on' : ''} label-data`}
            disabled={runState === 'running'}
            onClick={() => setLoops(n)}
          >{n}</button>
        ))}
        <span className="trial-loops-hint label-data">
          {loops === 0 ? 'FIRST DRAFT ONLY — NO REFINEMENT THIS RUN' : `DRAFT + ${loops} REFINEMENT WAVE${loops > 1 ? 'S' : ''} (ON BY DEFAULT)`}
        </span>
      </div>

      <button
        type="button"
        className="trial-prompts-toggle label-data"
        onClick={() => { playSound('menuOpen'); setAdjusting((a) => !a); }}
      >
        {adjusting ? 'HIDE THE SEATS' : 'ADJUST THE SEATS'}
      </button>

      {/* The board is the ADJUST surface before a run and the WATCH surface
          during one — a live run always shows its team working. */}
      {adjusting || runState === 'running' ? (
        <ul className="trial-roles">
          {TRIAL_SEATS.map((role, i) => {
            const out = role === 'LEAD' ? outputs['lead-1'] : outputs[role.toLowerCase()];
            return (
              <li key={role} className={`trial-role${out ? ' is-done' : ''}`}>
                <span className="trial-role-name label-data">{role}</span>
                <Select
                  fill
                  ariaLabel={`${role} seat`}
                  value={picked[i] || ''}
                  disabled={runState === 'running'}
                  onChange={(v) => setSeat(i, v)}
                  options={roster.map((m) => ({ value: m.neumaId, label: m.name || m.neumaId }))}
                />
                <span className="trial-role-state label-data">
                  {role === 'LEAD'
                    ? (loops === 0 ? 'NO WAVES TO DIRECT' : out ? 'DIRECTING' : runState === 'running' ? 'READING…' : 'DIRECTS EACH WAVE')
                    : out ? 'DONE' : runState === 'running' ? 'WORKING…' : ''}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      <button type="button" className="trial-prompts-toggle label-data" onClick={openPrompts}>
        {promptsOpen ? 'HIDE THE PROMPTS' : 'READ THE PROMPTS'}
      </button>
      {promptsOpen ? (
        specDown ? <p className="teams-err">PROMPTS UNAVAILABLE — THE PLATFORM DID NOT ANSWER.</p>
        : !spec ? <p className="trial-blurb label-data">READING…</p>
        : (
          <div className="trial-prompts">
            <p className="trial-prompts-note label-data">
              LOCKED WORDING · v{spec.version} — ANY EDIT WOULD MAKE A CUSTOM RUN; SCORES ONLY
              COMPARE WHILE THE TEST HOLDS STILL. EVERY TASK ALSO CARRIES THE TORCH ASK BELOW.
            </p>
            {spec.roles.map((r) => (
              <details key={r.id} className="trial-prompt">
                <summary className="label-data">{r.role}{r.needs.length ? ` — WAITS FOR ${r.needs.join(', ').toUpperCase()}` : ''}</summary>
                <pre className="trial-prompt-text">{r.task}</pre>
              </details>
            ))}
            <details className="trial-prompt">
              <summary className="label-data">LEAD — DIRECTS EACH WAVE (SHAPE SHOWN WITH PLACEHOLDER RECORD)</summary>
              <pre className="trial-prompt-text">{spec.lead}</pre>
            </details>
            <details className="trial-prompt">
              <summary className="label-data">THE TORCH ASK — APPENDED TO EVERY TASK</summary>
              <pre className="trial-prompt-text">{spec.torchAsk}</pre>
            </details>
          </div>
        )
      ) : null}

      {waves.length > 0 ? (
        <ol className="trial-waves" aria-label="Wave arc">
          {waves.map((w) => (
            <li key={w.loop} className={`trial-wave is-${verdictTone(w.verdict)} label-data`}>
              {w.loop === 0 ? 'DRAFT' : `WAVE ${w.loop}`} · {w.verdict} {w.points}/8
              {w.lead?.ledger ? <span className="trial-wave-ledger">LEAD LEDGER: {w.lead.ledger}</span> : null}
            </li>
          ))}
          {runState === 'running' && waves.length <= loops ? (
            <li className="trial-wave is-live label-data">WAVE {waves.length} · WORKING…</li>
          ) : null}
        </ol>
      ) : null}

      {runError ? <p className="teams-err">{runError}</p> : null}

      {scorecard ? (
        <section className="trial-card">
          <header className="trial-card-head">
            <span className={`trial-verdict is-${verdictTone(scorecard.score.verdict)} label-data`}>
              {scorecard.score.verdict} · {scorecard.score.points}/{scorecard.score.max}
            </span>
            <span className="trial-card-meta label-data">
              {scorecard.substrate.model} · {fmtMs(scorecard.durationMs)} · v{scorecard.version}
            </span>
          </header>
          <ul className="trial-checks">
            {CHECK_LABELS.map(([key, label]) => (
              <li key={key} className={`trial-check${scorecard.checks[key] ? ' is-ok' : ''} label-data`}>
                <span className="trial-check-mark">{scorecard.checks[key] ? '■' : '□'}</span> {label}
              </li>
            ))}
          </ul>
          <ul className="trial-times">
            {scorecard.steps.map((s) => (
              <li key={s.id} className="trial-time label-data">
                {s.role} · {s.member} · {s.ms != null ? fmtMs(s.ms) : '—'}
              </li>
            ))}
          </ul>
          {scorecard.failure ? <p className="teams-err">RUN INCOMPLETE: {scorecard.failure}</p> : null}
          {scorecard.artifact ? (
            <button type="button" className="trial-play" onClick={() => { playSound('menuOpen'); setPlaying((p) => !p); }}>
              {playing ? 'CLOSE THE GAME' : 'PLAY WHAT THEY BUILT'}
            </button>
          ) : null}
          {playing && scorecard.artifact ? (
            <iframe
              className="trial-game"
              title="BRICKWORKS — the game the team built"
              sandbox="allow-scripts"
              srcDoc={scorecard.artifact}
            />
          ) : null}
        </section>
      ) : null}

      {historyDown ? (
        <p className="teams-err">PAST TRIALS UNAVAILABLE — THE PLATFORM DID NOT ANSWER.</p>
      ) : history.length > 0 ? (
        <section className="trial-history">
          <h3 className="teams-results-h label-data">PAST TRIALS</h3>
          <ul className="trial-history-list">
            {history.map((t) => (
              <li key={t.id} className={`trial-history-row is-${verdictTone(t.score?.verdict)}`}>
                <button
                  type="button"
                  className="trial-history-open label-data"
                  disabled={runState === 'running'}
                  onClick={() => openPast(t.id)}
                >{trialSummaryLine(t)} — OPEN</button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
};
