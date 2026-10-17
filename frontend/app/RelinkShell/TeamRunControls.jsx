// TeamRunControls — the operator's hands on a team that is working: STOP the
// whole run, or STOP one member. Shared by the chat's team chip and the
// WORKFLOW window, so the two can never disagree about what a stop does.
//
// A stop is a deliberate gesture (Design note, 2026-10-05: the first press arms it
// and says what will happen, the second sends it, anything else lets it go.
// The stop reaches the member's decode on the server (team-run-live.js); the
// board and the done frame report what it actually did — nothing here
// pretends the run stopped before the server says so.

import { useState } from 'react';
import { stopTeamRun } from './team-client.js';
import { playSound } from '../../services/sound-engine.js';

// impure — one armed-then-sent stop. `label` names the act; `stepId` null
// stops the run.
const StopButton = ({ runId, stepId = null, label, armedLabel }) => {
  const [stage, setStage] = useState('idle'); // idle | armed | sending | sent | failed
  const [error, setError] = useState('');
  const send = async () => {
    setStage('sending');
    const outcome = await stopTeamRun(runId, stepId);
    if (outcome.ok) {
      playSound('confirm');
      setStage('sent');
    } else {
      setError(outcome.error);
      setStage('failed');
    }
  };
  if (stage === 'sent') return <span className="teamrun-stop is-sent label-data">STOPPING…</span>;
  if (stage === 'armed' || stage === 'sending') {
    return (
      <span className="teamrun-stop is-armed">
        <button type="button" className="teamrun-stop-confirm label-data" disabled={stage === 'sending'} onClick={send}>
          {armedLabel}
        </button>
        <button type="button" className="teamrun-stop-keep label-data" disabled={stage === 'sending'} onClick={() => setStage('idle')}>
          KEEP WORKING
        </button>
      </span>
    );
  }
  return (
    <span className="teamrun-stop">
      <button type="button" className="teamrun-stop-arm label-data" onClick={() => setStage('armed')}>{label}</button>
      {stage === 'failed' ? <span className="teamrun-stop-error label-data">{error}</span> : null}
    </span>
  );
};

/** STOP THE RUN — every member stops, nothing further starts. */
export const StopRunButton = ({ runId }) => (
  <StopButton runId={runId} label="STOP THE RUN" armedLabel="CONFIRM — STOP EVERY MEMBER" />
);

/** STOP one working member — its part fails; parts that depend on it never start. */
export const StopMemberButton = ({ runId, stepId }) => (
  <StopButton runId={runId} stepId={stepId} label="STOP" armedLabel="CONFIRM STOP" />
);
