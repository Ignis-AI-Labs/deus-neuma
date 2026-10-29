// model-bar-view — what the door's model bar shows: one line of state and the one act it offers.
// Design note, 2026-10-23: […] The state is the one-truth mind check (GET /api/v1/preflight/mind) and the
// setup job; everything technical waits behind the bar's details.
//
// pure — no IO.
import { STEP_TEXT } from './setup-words.js';
import { timeLeftLabel } from './setup-progress.js';

export const NOT_RUNNING = 'No model is running on this computer';

/**
 * @param {{mind: {state: string}, plan: object|null, job: object|null, error: string, readyModel: string|null}} input
 * @returns {{view: 'checking'|'none'|'setting'|'ready'|'error', line: string|null,
 *   act: 'setup'|'reading'|'stop'|'retry'|'reread'|null, note?: string}}
 *   `line` null while setting up (settingLine draws it from the progress)
 */
export const barView = ({ mind, plan, job, error, readyModel }) => {
  if (mind?.state === 'ready') return { view: 'ready', line: readyModel ? `Model ready · ${readyModel}` : 'Model ready', act: null };
  if (job?.state === 'running') return { view: 'setting', line: null, act: 'stop' };
  if (mind?.state === 'checking') return { view: 'checking', line: 'Checking the model…', act: null };
  // the backend's own sentence (plain words, ending in the act); its technical cause waits in details
  if (job?.state === 'failed') return { view: 'error', line: job.error || 'The setup stopped before it finished.', act: 'retry' };
  if (job?.state === 'cancelled') return { view: 'error', line: 'The setup was stopped.', act: 'retry' };
  if (error && plan) return { view: 'error', line: error, act: 'retry' };
  if (error) return { view: 'none', line: NOT_RUNNING, act: 'reread', note: 'The setup plan could not be read.' };
  if (!plan) return { view: 'none', line: NOT_RUNNING, act: 'reading' };
  if (!plan.supported) return { view: 'none', line: NOT_RUNNING, act: null, note: 'This computer cannot set one up by itself.' };
  if (!plan.enoughDisk) return { view: 'none', line: NOT_RUNNING, act: 'setup', note: 'Not enough free disk space.' };
  return { view: 'none', line: NOT_RUNNING, act: 'setup' };
};

/**
 * The line while the setup runs: the step, the whole job's percent, the time left.
 * @param {{step?: string}|null} job
 * @param {{pct: number|null, seconds: number|null}} progress
 * @returns {string}
 */
export const settingLine = (job, progress) => [
  STEP_TEXT[job?.step] || 'Working',
  progress.pct != null ? `${progress.pct}%` : null,
  timeLeftLabel(progress.seconds),
].filter(Boolean).join(' · ');
