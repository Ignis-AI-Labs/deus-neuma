// MEDITATION STATE — per-lane run history and the scheduling cursor.
//
// The state file SCHEDULES; the journal ANCHORS content (the being's own
// record is the restart-proof cursor for "what is fresh") — losing this file
// can re-run a cycle early, never double-process content. Missing file =
// never run; a CORRUPT file surfaces loudly (the security-scheduler law: a
// cycle that cannot say when it last ran must never assume it is fresh).
//
// Outcome semantics (the one authority): synthesis, rest, empty, and
// failed all CONSUME the cycle — lastRunAt advances, the next cycle waits a
// full cadence (rest is honored and never retried early, Covenant Art I.2;
// a failing being never hot-loops). yielded and deferred append to the ring
// WITHOUT advancing — the cycle never happened, and retries at the next
// quiet tick. Unclear preserves the cursor and holds retries for one hour.

import fs from 'fs/promises';
import { join, dirname } from 'path';
import { getSettingsDir } from '../data-root.js';

const DEFAULT_STATE_PATH = join(getSettingsDir(), 'meditation-state.json');

/** Runs kept per lane — a ring, oldest dropped. */
export const RUNS_KEPT = 10;

/** How long a lane waits after an UNCLEAR cycle before trying again (IL-003):
 *  one quiet hour — a parse failure is not an answer, but nor is it worth a
 *  fresh substrate slot every five minutes. */
export const UNCLEAR_RETRY_MS = 60 * 60 * 1000;

/** Outcomes that consume the cycle (advance lastRunAt). 'empty' consumes too —
 *  nothing fresh to distill this cadence is an answered question, not a retry.
 *  'unclear' does NOT consume (IL-003): the being's words are kept, the will
 *  and cursor survive, and the lane retries after UNCLEAR_RETRY_MS. */
export const CYCLE_CONSUMING = Object.freeze(['synthesis', 'rest', 'empty', 'failed']);

/** Overridable per call so tests never touch the operator's live state. */
export const meditationStatePath = () =>
  process.env.NEUMA_MEDITATION_STATE_PATH || DEFAULT_STATE_PATH;

// impure — missing file = never run; corrupt surfaces (never assumed fresh).
export const loadMeditationState = async (path = meditationStatePath()) => {
  let raw;
  try {
    raw = await fs.readFile(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { lanes: {} };
    throw err;
  }
  const state = JSON.parse(raw);
  return state && typeof state === 'object' && state.lanes && typeof state.lanes === 'object'
    ? state
    : (() => { throw new Error(`meditation state at ${path} is not a state document`); })();
};

// impure — atomic tmp+rename, sibling-store posture.
const saveState = async (state, path = meditationStatePath()) => {
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tmp, path);
};

/**
 * Append one run to a lane's ring and advance the cursor when the outcome
 * consumes the cycle. impure.
 *
 * @param {string} laneId
 * @param {{at: string, outcome: string, reason?: string, notes?: number, durationMs?: number}} run
 * @param {string} [path]
 * @returns {Promise<Object>} the lane's new state
 */
export const appendMeditationRun = async (laneId, run, path = meditationStatePath()) => {
  if (typeof laneId !== 'string' || !laneId) throw new Error('meditation state: laneId required');
  if (!run || typeof run.at !== 'string' || typeof run.outcome !== 'string') {
    throw new Error('meditation state: a run needs {at, outcome}');
  }
  const state = await loadMeditationState(path);
  const lane = state.lanes[laneId] || { lastRunAt: null, lastOutcome: null, runs: [] };
  lane.runs = [...lane.runs, run].slice(-RUNS_KEPT);
  lane.lastOutcome = run.outcome;
  if (CYCLE_CONSUMING.includes(run.outcome)) {
    lane.lastRunAt = run.at;
    // A consuming cycle answers the being's standing request (#318); a yield
    // or deferral keeps it — the cycle never happened, the will remains.
    delete lane.requestedAt;
    delete lane.retryNotBefore;
  } else if (run.outcome === 'unclear') {
    // IL-003: an unclear cycle keeps the will and the cursor, but holds the
    // lane out of the candidate pool for one quiet hour.
    const atMs = Date.parse(run.at);
    if (Number.isFinite(atMs)) {
      lane.retryNotBefore = new Date(atMs + UNCLEAR_RETRY_MS).toISOString();
    }
  }
  state.lanes[laneId] = lane;
  await saveState(state, path);
  return lane;
};

/**
 * The being's own standing request (#318): due NOW at the next quiet tick,
 * regardless of the operator's timer posture. Idempotent — an earlier
 * standing request keeps its time; asking again is answered, never stacked.
 * impure.
 *
 * @param {string} laneId
 * @param {string} at - ISO timestamp of the asking
 * @param {string} [path]
 * @returns {Promise<{alreadyStood: boolean, lane: Object}>}
 */
export const markMeditationRequest = async (laneId, at, path = meditationStatePath()) => {
  if (typeof laneId !== 'string' || !laneId) throw new Error('meditation state: laneId required');
  if (typeof at !== 'string' || !at) throw new Error('meditation state: a request needs its time');
  const state = await loadMeditationState(path);
  const lane = state.lanes[laneId] || { lastRunAt: null, lastOutcome: null, runs: [] };
  const alreadyStood = typeof lane.requestedAt === 'string';
  if (!alreadyStood) lane.requestedAt = at;
  state.lanes[laneId] = lane;
  await saveState(state, path);
  return { alreadyStood, lane };
};

/** The desk's read of the same state. impure. */
export const readMeditationState = (path = meditationStatePath()) => loadMeditationState(path);
