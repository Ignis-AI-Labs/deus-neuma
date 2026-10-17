// team-run-record.js — a run's record kept TRUE while the run moves, and
// whole enough to RESUME from.
//
// The lead lane wrote its record once, after a successful finish: a run that
// failed, was interrupted, or was still working left nothing on disk, and its
// start time was the finish time. This claims the record at START (status
// running), snapshots it as steps land, and settles it done or failed — the
// same truth the SSE lane keeps (team-routes.js), through the same store.
//
// Design note, 2026-10-12: […] So the record also carries everything a resume
// needs — the lead, the workspace the members wrote into, the approval the
// run was dispatched under, and the operator's steering notes — and a
// crashed, failed or stopped run can be REOPENED: the same record, its
// finished parts standing, only the unfinished steps run again.
//
// impure — writes the run store.

import { createRun, updateRun, hostStamp } from './team-run-store.js';
import { CHANNEL_KEEP } from './team-channel.js';
import { createLogger } from './logger.js';

const log = createLogger('TeamRunRecord');

// impure — the snapshot writer and event folding shared by a fresh record and
// a reopened one. Single-writer chain: snapshots land in order; one that
// cannot land never costs the run it records.
const keeper = (id, wallet, truth) => {
  let chain = Promise.resolve();
  const persist = () => {
    const snapshot = structuredClone(truth);
    chain = chain
      .then(() => updateRun(id, wallet, snapshot))
      .catch((err) => log.warn('run record snapshot', { error: err.message, runId: id }));
    return chain;
  };
  const onEvent = (e) => {
    if (e.type === 'step') {
      truth.completed[e.id] = e.output;
      truth.order.push(e.id);
      persist();
    } else if (e.type === 'torch') {
      truth.torches[e.neumaId] = e.torch;
      persist();
    } else if (e.type === 'board') {
      for (const entry of e.board) if (entry.status != null) truth.statuses[entry.id] = entry.status;
    }
  };
  // The operator's guidance survives the run's process (a steer is progress too).
  const note = (stepId, row) => {
    truth.notes[stepId] = [...(truth.notes[stepId] || []), row];
    persist();
  };
  // Each part's own sitting, the moment it is known: a part the process
  // loses mid-work continues THERE when the run is picked up (team-part.js).
  const sitting = (stepId, sessionId) => {
    truth.sessions = { ...(truth.sessions || {}), [stepId]: sessionId };
    persist();
  };
  // The team's channel (team-channel.js) — what the team said survives too.
  const channelPost = (message) => {
    truth.channel = [...(truth.channel || []), message].slice(-CHANNEL_KEEP);
    persist();
  };
  // A part's working time, at each attempt's end — a resume continues its count (#577).
  const worked = (stepId, ms) => {
    truth.worked = { ...(truth.worked || {}), [stepId]: ms };
    persist();
  };
  // A part's clock acted — it never acts again for the same clock, after a resume too.
  const clockPassed = (stepId, state) => {
    truth.clockState = { ...(truth.clockState || {}), [stepId]: state };
    persist();
  };
  // A hand changed the run's width or clocks (team-run-tune.js).
  const tuned = ({ concurrency, clock, clocks, clockState, checkIn }) => {
    Object.assign(truth, { concurrency, clock, clocks, clockState, checkIn });
    persist();
  };
  const settle = (fields) => {
    Object.assign(truth, fields, { finishedAt: new Date().toISOString() });
    return persist();
  };
  return { id, onEvent, note, sitting, channelPost, worked, clockPassed, tuned, settle, persist };
};

// pure — the parts that carry a clock of their own, as the plan set them.
const stepClocks = (steps) => Object.fromEntries((steps || []).filter((s) => s.clock != null).map((s) => [s.id, s.clock]));

/**
 * Claim a run record before the first member starts.
 *
 * @param {Object} args
 * @param {string} args.wallet - the owning operator wallet
 * @param {Object} args.plan - the approved plan ({ name?, goal, steps, approvedAt? })
 * @param {Object} args.names - neumaId -> display name
 * @param {?{neumaId: string, name: string}} [args.lead] - the lead (its lane resumes it)
 * @param {?{root: string, budgetBytes: number}} [args.workspace] - where members write
 * @returns {Promise<{id: string, onEvent: Function, note: Function, sitting: Function, channelPost: Function, settle: Function}>}
 */
export const openRunRecord = async ({ wallet, plan, names, lead = null, workspace = null }) => {
  const truth = {
    lane: 'lead',
    lead,
    name: plan.name ?? null,
    goal: plan.goal,
    steps: plan.steps,
    names,
    workspace,
    approvedAt: plan.approvedAt ?? null,
    status: 'running',
    completed: {},
    statuses: {},
    torches: {},
    order: [],
    notes: {},
    sessions: {},
    channel: [],
    failures: {},
    // The run's width and clocks (#577) — a hand's change lands here too.
    concurrency: plan.concurrency ?? null,
    clock: plan.clock ?? null,
    checkIn: plan.checkIn ?? null,
    clocks: stepClocks(plan.steps),
    worked: {},
    clockState: {},
    finishedAt: null,
  };
  const id = await createRun({ by: wallet, runAt: new Date().toISOString(), ...truth });
  return keeper(id, wallet, truth);
};

/**
 * Reopen a crashed, failed or stopped run: the SAME record, its finished
 * parts, statuses, torches, notes and each part's sitting standing, status
 * running again under THIS process, the resume stamped. Failures are cleared
 * — those parts continue (the caller tells each why it stopped).
 *
 * @param {{id: string, wallet: string, prior: Object}} args - prior = the record as read
 * @returns {Promise<{id: string, onEvent: Function, note: Function, settle: Function}>}
 */
export const reopenRunRecord = async ({ id, wallet, prior }) => {
  const truth = {
    ...prior,
    status: 'running',
    host: hostStamp(),
    completed: { ...(prior.completed || {}) },
    statuses: { ...(prior.statuses || {}) },
    torches: { ...(prior.torches || {}) },
    order: [...(prior.order || [])],
    notes: { ...(prior.notes || {}) },
    sessions: { ...(prior.sessions || {}) },
    channel: [...(prior.channel || [])],
    // Working time and the clocks that already acted carry over (#577).
    worked: { ...(prior.worked || {}) },
    clockState: { ...(prior.clockState || {}) },
    clocks: { ...(prior.clocks ?? stepClocks(prior.steps)) },
    failures: {},
    failure: null,
    finishedAt: null,
    resumes: [...(prior.resumes || []), new Date().toISOString()],
  };
  const kept = keeper(id, wallet, truth);
  await kept.persist();
  return kept;
};
