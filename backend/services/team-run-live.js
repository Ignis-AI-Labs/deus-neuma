// team-run-live.js — every team run that is working RIGHT NOW, and the
// operator's hands on it.
//
// A lead's team run used to live inside the lead's turn: the operator's chat
// was held for the whole run, the only stop was the composer's STOP (which
// ended the lead's turn too, and never reached a member's decode), and the
// run's frames went to the one socket that filed it. This registry is what a
// run stands on once it leaves the turn: one entry per run, keyed by its
// record id, carrying
//   - the run's abort controller and one per working member, so a STOP cuts
//     the decode itself, not just the listener;
//   - the latest board, torches, finished parts and each working member's
//     live words and reasoning (capped tails, sent in batches), so a window
//     that opens late (or after a reload) can paint the run as it stands;
//   - the owner's wallet, so frames reach EVERY desk the operator has open —
//     and only that operator's.
//
// impure — module state (the live map) and the injected frame sender.

import { createLogger } from './logger.js';
import { governsOf } from './team-clock.js';

const log = createLogger('TeamRunLive');

const live = new Map(); // runId -> entry
// Lanes whose run is being STARTED: claimed synchronously before a start's
// first await, so two starts (two desks' RESUME, the operator's RESUME racing
// the lead's own) can never both pass the check and run one record twice.
const starting = new Set(); // laneId

/** How much of one member's live words / reasoning a window can catch up on. */
export const STREAM_TAIL_CHARS = 12000;
/** Live deltas leave in batches, never per token — a 4-member run must not
 *  flood the operator's portal. */
export const STREAM_FLUSH_MS = 250;

const tail = (text) => (text.length > STREAM_TAIL_CHARS ? text.slice(-STREAM_TAIL_CHARS) : text);

// The sender is wired by routes/portal-send.js at load: services never import
// routes (the notification bus uses the same seam).
let sendFrame = null;
export const setRunFrameSender = (fn) => { sendFrame = typeof fn === 'function' ? fn : null; };

const sameWallet = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

// pure — the snapshot a window paints from.
const snapshotOf = (e) => Object.freeze({
  id: e.id,
  laneId: e.laneId,
  lead: e.lead,
  name: e.name,
  goal: e.goal,
  startedAt: e.startedAt,
  board: e.board,
  torches: [...e.torches],
  parts: { ...e.parts },
  tools: Object.fromEntries(Object.entries(e.tools).map(([k, v]) => [k, [...v]])),
  sessions: { ...e.sessions },
  notes: Object.fromEntries(Object.entries(e.notes).map(([k, v]) => [k, [...v]])),
  streams: Object.fromEntries([...e.streams].map(([stepId, st]) => [stepId, { ...st }])),
  lines: { ...e.lines },
  retries: { ...e.retries },
  channel: [...e.channel],
  stopping: e.controller.signal.aborted,
  // The run's width and clocks (#577): what governs it, and where each part stands.
  ...governsOf(e),
  worked: { ...e.worked },
  workingSince: { ...e.workingSince },
  clockState: { ...e.clockState },
});

/**
 * Register a run the moment it starts.
 *
 * @param {Object} args
 * @param {string} args.id - the run record id (also the portal id)
 * @param {string} args.wallet - the owning operator wallet
 * @param {string} args.laneId - the LEAD's lane
 * @param {string} args.lead - the lead's display name
 * @param {?string} args.name
 * @param {string} args.goal
 * @param {Array} args.board - the opening board
 * @param {Object} [args.notes] - the operator's notes a resumed run carries
 * @param {Array} [args.channel] - the team channel a resumed run carries (team-channel.js)
 * @param {?Object} [args.ws] - the filing socket, reached directly when no
 *   wallet fan-out is wired (it is skipped by the fan-out otherwise)
 * @param {Object} [args.governs] - the run's width and clocks (#577): { concurrency,
 *   ceiling, clock, clocks, worked, clockState } — a resume carries the last ones
 * @returns {Object} the entry
 */
export const registerRun = ({ id, wallet, laneId, lead, name = null, goal, board, ws = null, notes = {}, channel = [], governs = {} }) => {
  const entry = {
    id, wallet, laneId, lead, name, goal, board, ws,
    concurrency: governs.concurrency ?? null, // parts at work at once (team-run-gate.js); null = no cap of its own
    ceiling: governs.ceiling ?? null, // the rig's member slots — no hand widens past it
    clock: governs.clock ?? null, // every part's clock unless its own says otherwise (team-clock.js)
    clocks: { ...(governs.clocks || {}) }, // stepId -> its own clock, or 'none'
    worked: { ...(governs.worked || {}) }, // stepId -> working ms so far (team-part-clock.js)
    workingSince: {}, // stepId -> epoch ms its current working stretch began
    clockState: { ...(governs.clockState || {}) }, // stepId -> { passed, by, at, then, clock } once its clock acted
    clockWatch: new Map(), // stepId -> re-arm the working attempt's clock (a hand changed it)
    gate: null, // the run's own width gate (team-run-gate.js), set as it starts
    onTune: null, // the run record's keeper — a hand's change outlives this process
    checkIn: governs.checkIn ?? null, // minutes between the eye's check-ins; 0 = none (team-watch.js)
    lastActive: {}, // stepId -> epoch ms of its last word, thought or act — its last sign of life
    onClockPassed: null, // the eye (a clock acted): told to the operator and the CoS
    onPartGaveUp: null, // the eye (a part will not be continued on its own)
    rewatch: null, // the eye's cadence changed — restart its check-ins
    stopWatch: null, // the run left the live map — the eye closes
    torches: [],
    parts: {}, // stepId -> the finished work product
    tools: {}, // stepId -> [{ tool, status, summary }] — capped
    sessions: {}, // stepId -> the part's own sitting (its transcript; a continuation resumes it)
    lines: {}, // stepId -> its place in the substrate line ({ state, position?, ahead? })
    retries: {}, // stepId -> the run's last response to it stopping short ({ kind, why, inMs, at })
    notes: { ...notes }, // stepId -> [{ note, at }] — the operator's guidance (a resume carries it)
    onNote: null, // the run record's keeper — a note outlives this process
    channel: [...channel], // the team's posts, oldest first (team-channel.js)
    onChannel: null, // the run record's keeper — a post outlives this process
    room: null, // the team room's writer (<workspace>/.team/), when the team has a workspace
    streams: new Map(), // stepId -> { text, thought } tails
    pending: new Map(), // stepId -> { text, thought } not yet sent
    flushTimer: null,
    startedAt: new Date().toISOString(),
    controller: new AbortController(),
    steps: new Map(), // stepId -> AbortController
    stopped: new Set(), // stepIds the operator stopped — a steer never re-starts them
    answered: new Set(), // stepIds whose member has answered — a note can no longer reach the part
  };
  live.set(id, entry);
  return entry;
};

/**
 * Send one run frame to every open desk of the run's operator, and keep the
 * snapshot current. Never throws — a frame must never cost a run.
 *
 * @param {Object} entry
 * @param {Object} frame
 */
export const broadcastRun = (entry, frame) => {
  if (frame.type === 'operator:team_board') entry.board = frame.board;
  if (frame.type === 'operator:team_torch') entry.torches.push({ stepId: frame.stepId, member: frame.member, torch: frame.torch });
  if (frame.type === 'operator:team_part') entry.parts[frame.stepId] = frame.output;
  try {
    if (sendFrame) {
      sendFrame(entry.wallet, frame);
      return;
    }
    if (entry.ws?.readyState === entry.ws?.OPEN) entry.ws.send(JSON.stringify(frame));
  } catch (err) {
    log.debug('run frame dropped', { type: frame.type, error: err.message });
  }
};

/**
 * The signal one member step decodes under — aborted by STOP MEMBER or by
 * STOP RUN.
 *
 * @param {Object} entry
 * @param {string} stepId
 * @returns {AbortSignal}
 */
export const stepSignal = (entry, stepId) => {
  const controller = new AbortController();
  entry.steps.set(stepId, controller);
  return AbortSignal.any([entry.controller.signal, controller.signal]);
};

// impure — send every batched delta now.
const flushStreams = (entry) => {
  entry.flushTimer = null;
  for (const [stepId, delta] of entry.pending) {
    broadcastRun(entry, { type: 'operator:team_stream', id: entry.id, stepId, ...delta });
  }
  entry.pending.clear();
};

/**
 * A working member's words or reasoning, as they arrive. Kept as a capped
 * tail (a late window catches up from it) and sent in batches.
 *
 * @param {Object} entry
 * @param {string} stepId
 * @param {'text'|'thought'} kind
 * @param {string} delta
 */
export const appendStepStream = (entry, stepId, kind, delta) => {
  if (!delta) return;
  entry.lastActive[stepId] = Date.now();
  const st = entry.streams.get(stepId) || { text: '', thought: '' };
  st[kind] = tail(st[kind] + delta);
  entry.streams.set(stepId, st);
  const pend = entry.pending.get(stepId) || {};
  pend[kind] = (pend[kind] || '') + delta;
  entry.pending.set(stepId, pend);
  if (!entry.flushTimer) {
    entry.flushTimer = setTimeout(() => flushStreams(entry), STREAM_FLUSH_MS);
    entry.flushTimer.unref?.();
  }
};

/** Send any batched deltas at once — a step that just ended must not leave
 *  its last words behind its part frame. */
export const flushStepStreams = (entry) => {
  if (entry.flushTimer) clearTimeout(entry.flushTimer);
  flushStreams(entry);
};

/** How many tool events one member's panel keeps (newest). */
export const STEP_TOOLS_MAX = 60;

/**
 * A member reached for a tool — kept (newest STEP_TOOLS_MAX) and sent at once:
 * a tool call is an event the operator watches, not a token to batch.
 *
 * @param {Object} entry
 * @param {string} stepId
 * @param {{tool: string, status: string, summary: ?string}} event
 */
export const recordStepTool = (entry, stepId, event) => {
  const row = { tool: String(event?.tool ?? ''), status: String(event?.status ?? ''), summary: event?.summary ?? null };
  entry.lastActive[stepId] = Date.now();
  entry.tools[stepId] = [...(entry.tools[stepId] || []), row].slice(-STEP_TOOLS_MAX);
  broadcastRun(entry, { type: 'operator:team_tool', id: entry.id, stepId, ...row });
};

/**
 * A working member's place in the substrate line (substrate-line.js) —
 * waiting behind others, or running. Sent at once: the operator must tell a
 * member that is waiting its turn from one that is stuck.
 *
 * @param {Object} entry
 * @param {string} stepId
 * @param {{state: 'waiting'|'running'|'held', position?: number, ahead?: string[], of?: number}} line
 *   'held' — the run's own width holds it (team-run-gate.js): `of` parts work at once
 */
export const markStepLine = (entry, stepId, line) => {
  const state = ['waiting', 'held'].includes(line?.state) ? line.state : 'running';
  const row = { state, position: line?.position ?? null, ahead: line?.ahead ?? null, ...(state === 'held' ? { of: line?.of ?? null } : {}) };
  entry.lines[stepId] = row;
  broadcastRun(entry, { type: 'operator:team_line', id: entry.id, stepId, ...row });
};

/**
 * Where a part's clock stands (#577): its working time so far, the stretch it
 * is working now, and what its clock did once it passed. Sent when it starts
 * or stops working and when its clock acts; a window ticks the stretch itself.
 *
 * @param {Object} entry
 * @param {string} stepId
 */
export const markStepClock = (entry, stepId) => {
  broadcastRun(entry, {
    type: 'operator:team_clock',
    id: entry.id,
    stepId,
    worked: entry.worked[stepId] || 0,
    since: entry.workingSince[stepId] ?? null,
    passed: entry.clockState[stepId] ?? null,
  });
};

/**
 * The run answered a part that stopped short (team-part.js): it continues
 * after `inMs` (a failure), or at once (an answer that did not finish it).
 *
 * @param {Object} entry
 * @param {string} stepId
 * @param {{kind: 'failed'|'unfinished', why: string, inMs: number}} retry
 */
export const markStepRetry = (entry, stepId, retry) => {
  const row = { kind: retry.kind, why: String(retry.why ?? ''), inMs: Number(retry.inMs) || 0, at: new Date().toISOString() };
  entry.retries[stepId] = row;
  broadcastRun(entry, { type: 'operator:team_retry', id: entry.id, stepId, ...row });
};

/** The operator's guidance stays short — a note, not a new task. */
export const STEER_NOTE_MAX_CHARS = 2000;
/** A part carries at most this many of the operator's notes. */
export const STEER_MAX_PER_STEP = 5;

/** The abort reason a steer carries — the part continues with the note, it never fails. */
export const STEER_REASON = 'steered by the operator';
/** The reason a stopped member's part fails with. */
export const STOP_MEMBER_REASON = 'the operator stopped this member';

/**
 * The operator steers ONE member (Design note, 2026-10-10: […]). A member that is working is
 * paused and CONTINUES its part with the note (team-part.js — its sitting,
 * its acts and its files stand); a member still waiting reads it when it
 * starts. Owner-scoped.
 *
 * @param {{id: string, wallet: string, stepId: string, note: string}} args
 * @returns {{ok: boolean, reason?: string, cut?: boolean}}
 */
export const steerStep = ({ id, wallet, stepId, note }) => {
  const entry = live.get(id);
  if (!entry || !sameWallet(entry.wallet, wallet)) return { ok: false, reason: 'no such run is working' };
  const text = typeof note === 'string' ? note.trim() : '';
  if (!text) return { ok: false, reason: 'a note needs words' };
  if (text.length > STEER_NOTE_MAX_CHARS) return { ok: false, reason: `a note stays under ${STEER_NOTE_MAX_CHARS} characters` };
  const row = (entry.board || []).find((e) => e.id === stepId);
  if (!row) return { ok: false, reason: `the run has no step ${stepId}` };
  if (row.state === 'done' || row.state === 'failed') return { ok: false, reason: `step ${stepId} is ${row.state} — its part can no longer change` };
  if (entry.answered.has(stepId) || entry.stopped.has(stepId)) {
    return { ok: false, reason: `step ${stepId} has ${entry.stopped.has(stepId) ? 'been stopped' : 'just answered'} — its part can no longer change` };
  }
  const notes = entry.notes[stepId] || [];
  if (notes.length >= STEER_MAX_PER_STEP) return { ok: false, reason: `step ${stepId} already carries ${STEER_MAX_PER_STEP} notes` };
  const at = new Date().toISOString();
  entry.notes[stepId] = [...notes, { note: text, at }];
  entry.onNote?.(stepId, { note: text, at });
  broadcastRun(entry, { type: 'operator:team_note', id, stepId, note: text, at });
  const working = entry.steps.get(stepId);
  if (working) working.abort(new Error(STEER_REASON));
  return { ok: true, cut: Boolean(working) };
};

/** Forget a step's controller once it settled. */
export const releaseStep = (entry, stepId) => { entry.steps.delete(stepId); };

/** The run has settled; it leaves the live map. */
export const endRun = (id) => {
  const entry = live.get(id);
  if (entry?.flushTimer) clearTimeout(entry.flushTimer);
  entry?.stopWatch?.();
  live.delete(id);
};

/**
 * The working run a member's part belongs to. The member's connection names
 * it (connection._teamRun) — set only by the run itself, never by a caller.
 *
 * @param {string} id
 * @returns {?Object} the entry
 */
export const runForMember = (id) => live.get(id) ?? null;

/**
 * The working run this lane leads for this operator, if any.
 *
 * @param {string} laneId
 * @param {string} wallet
 * @returns {?Object} the entry
 */
export const runLedBy = (laneId, wallet) => [...live.values()].find((e) => e.laneId === laneId && sameWallet(e.wallet, wallet)) ?? null;

/**
 * A working run of this operator's, for the operator's own hands on it.
 *
 * @param {string} id
 * @param {string} wallet
 * @returns {?Object} the entry
 */
export const ownedRun = (id, wallet) => {
  const entry = live.get(id);
  return entry && sameWallet(entry.wallet, wallet) ? entry : null;
};

/** @returns {boolean} whether this lane leads a run that is working — or starting */
export const isLaneRunning = (laneId) => starting.has(laneId) || [...live.values()].some((e) => e.laneId === laneId);

/**
 * Claim a lane for a run about to start — synchronous, so it must be taken
 * before the start's first await. False when the lane already leads one.
 *
 * @param {string} laneId
 * @returns {boolean}
 */
export const claimLane = (laneId) => {
  if (isLaneRunning(laneId)) return false;
  starting.add(laneId);
  return true;
};

/** The start settled — registered (the live map holds the lane now) or refused. */
export const releaseLane = (laneId) => { starting.delete(laneId); };

/** @returns {Array} every live run this operator owns, as snapshots */
export const liveRunsFor = (wallet) => [...live.values()].filter((e) => sameWallet(e.wallet, wallet)).map(snapshotOf);

/**
 * The operator stops a whole run, or one member. Owner-scoped: someone
 * else's run reads as absent.
 *
 * @param {{id: string, wallet: string, stepId?: ?string}} args
 * @returns {{ok: boolean, reason?: string}}
 */
export const stopRun = ({ id, wallet, stepId = null }) => {
  const entry = live.get(id);
  if (!entry || !sameWallet(entry.wallet, wallet)) return { ok: false, reason: 'no such run is working' };
  if (stepId == null) {
    entry.controller.abort(new Error('the operator stopped the run'));
    log.info('run stopped by the operator', { runId: id });
    return { ok: true };
  }
  const step = entry.steps.get(stepId);
  // Between a steer's cut and its re-start the step holds no controller, yet
  // it is working: the stop still lands — the re-start reads it and fails.
  const working = (entry.board || []).some((e) => e.id === stepId && e.state === 'working');
  if (!step && !working) return { ok: false, reason: `step ${stepId} is not working right now` };
  entry.stopped.add(stepId);
  step?.abort(new Error(STOP_MEMBER_REASON));
  log.info('member stopped by the operator', { runId: id, stepId });
  return { ok: true };
};
