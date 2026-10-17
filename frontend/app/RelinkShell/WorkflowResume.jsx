// WorkflowResume — the runs a crash, a failure or a stop left waiting, each
// with its RESUME (Design note, 2026-10-12: […]). A resume reopens the same run in the same
// workspace: its finished parts stand, only what was left runs.

import { useState } from 'react';
import { resumeTeamRun } from './team-client.js';
import { playSound } from '../../services/sound-engine.js';

const WHY = Object.freeze({
  lost: 'INTERRUPTED — THE BACKEND STOPPED',
  failed: 'A MEMBER FAILED',
  stopped: 'YOU STOPPED IT',
});

// impure — one waiting run and its RESUME.
const ResumeRow = ({ run }) => {
  const [stage, setStage] = useState('idle'); // idle | sending | failed
  const [error, setError] = useState('');
  const resume = async () => {
    setStage('sending');
    const outcome = await resumeTeamRun(run.id);
    if (outcome.ok) {
      playSound('confirm'); // the run's start frame takes over from here
    } else {
      setError(outcome.error);
      setStage('failed');
    }
  };
  return (
    <li className="workflow-resume-row">
      <span className="workflow-resume-name">{run.name || 'TEAM RUN'}</span>
      {run.lead?.name ? <span className="label-data">LED BY {run.lead.name.toUpperCase()}</span> : null}
      <span className="workflow-resume-why label-data">{WHY[run.status] || String(run.status).toUpperCase()}</span>
      <span className="label-data">{run.completed} OF {run.steps} PARTS DONE</span>
      <button type="button" className="workflow-resume-go label-data" disabled={stage === 'sending'} onClick={resume}>
        RESUME — FINISHED PARTS STAND
      </button>
      {stage === 'failed' ? <span className="workflow-steer-error label-data">{error}</span> : null}
    </li>
  );
};

/** @param {{runs: Array}} props - resumable run summaries (GET /api/v1/team/runs) */
export const WorkflowResume = ({ runs }) => (
  <section className="workflow-resume">
    <h3 className="workflow-h label-data">PICK UP WHERE IT STOPPED</h3>
    <ul className="workflow-resume-list">
      {runs.map((r) => <ResumeRow key={r.id} run={r} />)}
    </ul>
  </section>
);
