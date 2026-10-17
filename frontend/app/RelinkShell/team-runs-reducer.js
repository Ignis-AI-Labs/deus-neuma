// team-runs-reducer.js — every team run this desk has seen, by run id. Pure.
//
// The chat's team chip lives inside one stream's messages, so the WORKFLOW
// window used to see only the anchor tab's newest run, and nothing after a
// reload. This store sits at the desk (beside the council's): every run
// frame the operator's portal carries lands here — whatever tab or lead
// filed it — and a fresh desk SEEDS from the server's live list, so a run
// that started before the window opened (or before a reload) is whole.
//
// A run: { id, name, goal, lead, laneId, board, torches, parts, streams, tools, sessions, notes,
//   lines, retries, channel, phase: 'live'|'settled', status, failures, skipped, record, delivery, seenAt }
// `channel` = the team channel's posts, oldest first ({ n, at, from, fromStep, to, toStep, text }).
// `lines[stepId]` = its place in the model's line ({ state: 'waiting'|'running',
// position, ahead }); `retries[stepId]` = the run's response to it stopping
// short ({ kind: 'failed'|'unfinished', why, inMs, at }) until it works again.
// status, once settled: 'done' | 'error' | 'stopped' | 'lost' (its backend
// stopped while it worked — the record says how it really stands).
// `streams[stepId]` = { text, thought } — the member's live words and
// reasoning (tails, capped like the server's).
// What GOVERNS it (#577, team-clock.js governsOf): `concurrency` of `ceiling`
// parts at once, the run's `clock` (`clockWords`), each part's own `clocks`
// and `partClocks[stepId]` = { own, words, limitMs, dueMs }, `checkIn` = minutes
// between the eye's check-ins (0 = none); and where each
// part's clock stands: `worked[stepId]` ms, `workingSince[stepId]` (epoch ms
// while it works) and `clockState[stepId]` once its clock acted.

export const STREAM_TAIL_CHARS = 12000;
export const STEP_TOOLS_MAX = 60;
/** How many team channel posts the desk keeps for a run, like the server. */
export const CHANNEL_KEEP = 300;

export const initialTeamRuns = Object.freeze({ runs: Object.freeze({}), order: Object.freeze([]), resumable: Object.freeze([]) });

/** The statuses a lead run can be picked up from. */
const RESUMABLE = Object.freeze(new Set(['lost', 'failed', 'stopped']));

const tail = (text) => (text.length > STREAM_TAIL_CHARS ? text.slice(-STREAM_TAIL_CHARS) : text);

// pure — a run as the store holds it, from a start frame or a live snapshot.
const freshRun = (r) => ({
  id: r.id,
  name: r.name || '',
  goal: r.goal || '',
  lead: r.lead || '',
  laneId: r.laneId || null,
  board: r.board || [],
  torches: r.torches || [],
  parts: r.parts || {},
  streams: r.streams || {},
  tools: r.tools || {},
  sessions: r.sessions || {},
  notes: r.notes || {},
  lines: r.lines || {},
  retries: r.retries || {},
  channel: r.channel || [],
  concurrency: r.concurrency ?? null,
  ceiling: r.ceiling ?? null,
  clock: r.clock ?? null,
  clockWords: r.clockWords || '',
  clocks: r.clocks || {},
  partClocks: r.partClocks || {},
  checkIn: r.checkIn ?? null,
  worked: r.worked || {},
  workingSince: r.workingSince || {},
  clockState: r.clockState || {},
  tunedBy: null,
  phase: 'live',
  status: null,
  failures: null,
  skipped: null,
  record: null,
  delivery: null,
  stopping: r.stopping === true,
  // When this desk learned of the run (the hook's clock) — a live list asked
  // for before then cannot speak for it.
  seenAt: Number.isFinite(r.seenAt) ? r.seenAt : 0,
});

// The record's word for a run that ended, in the store's words.
const SETTLED_AS = Object.freeze({ done: 'done', failed: 'error', stopped: 'stopped', lost: 'lost' });

const put = (state, run) => ({
  ...state,
  runs: { ...state.runs, [run.id]: run },
  order: state.order.includes(run.id) ? state.order : [...state.order, run.id],
});

// pure — apply fn to a known run; an unknown id is a no-op, never a crash.
const update = (state, id, fn) => (state.runs[id] ? put(state, fn(state.runs[id])) : state);

// pure — a map without one key (the same map when it never held it).
const without = (map, key) => {
  if (!map || !(key in map)) return map || {};
  const { [key]: _gone, ...rest } = map;
  return rest;
};

// pure — the member is working again: the run's last response to it is past.
const working = (r, stepId) => (r.retries?.[stepId] ? { ...r, retries: without(r.retries, stepId) } : r);

const handlers = Object.freeze({
  // The server's live list (asked at `asOf`): runs it holds that this desk
  // has not seen are added whole. A run this desk holds as working that the
  // list does not carry is not working — its backend restarted, or its end
  // was missed while the link was down — and settles as LOST until the
  // record says more.
  SEED: (state, { runs, asOf }) => {
    const listed = new Set((runs || []).map((r) => r.id));
    const gone = Object.values(state.runs).filter((r) => r.phase === 'live' && !listed.has(r.id)
      && Number.isFinite(asOf) && r.seenAt <= asOf);
    const settled = gone.reduce((acc, r) => put(acc, { ...r, phase: 'settled', status: 'lost' }), state);
    // A listed run this desk follows live keeps its own (newer) state; one it
    // holds as settled was picked up elsewhere while the link was down — the
    // server's snapshot is the run now.
    return (runs || []).reduce(
      (acc, r) => (acc.runs[r.id]?.phase === 'live' ? acc : put(acc, freshRun({ ...r, seenAt: asOf }))),
      settled,
    );
  },
  // A RESUMED run reuses its id: its start replaces the settled entry (and
  // leaves the pick-up list) — finished parts ride the frame.
  START: (state, a) => (state.runs[a.id] && !a.resumed
    ? state
    : { ...put(state, freshRun(a)), resumable: (state.resumable || []).filter((r) => r.id !== a.id) }),
  // The operator's runs a crash, a failure or a stop left waiting — lead
  // runs only (GET /api/v1/team/runs), never one that is working now. The
  // record is also the truth about a run whose end this desk never heard: a
  // run the store settled as LOST takes the record's own ending.
  RESUMABLE: (state, a) => {
    const told = (a.runs || []).reduce((acc, r) => {
      const held = acc.runs[r.id];
      const ending = SETTLED_AS[r.status];
      return held?.phase === 'settled' && held.status === 'lost' && ending && ending !== 'lost'
        ? put(acc, { ...held, status: ending })
        : acc;
    }, state);
    return {
      ...told,
      resumable: (a.runs || []).filter((r) => r.lane === 'lead' && RESUMABLE.has(r.status)
        && told.runs[r.id]?.phase !== 'live'),
    };
  },
  BOARD: (state, a) => update(state, a.id, (r) => ({ ...r, board: a.board || r.board })),
  TORCH: (state, a) => update(state, a.id, (r) => ({
    ...r, torches: [...r.torches, { stepId: a.stepId, member: a.member, torch: a.torch }],
  })),
  PART: (state, a) => update(state, a.id, (r) => ({
    ...r,
    parts: { ...r.parts, [a.stepId]: a.output },
    sessions: a.sessionId ? { ...r.sessions, [a.stepId]: a.sessionId } : r.sessions,
    lines: without(r.lines, a.stepId),
    retries: without(r.retries, a.stepId),
  })),
  // The member's place in the model's line — waiting behind others, working,
  // or HELD by its run's own width (`of` parts at once).
  LINE: (state, a) => update(state, a.id, (r) => ({
    ...working(r, a.stepId),
    lines: { ...(r.lines || {}), [a.stepId]: { state: a.state, position: a.position ?? null, ahead: a.ahead ?? null, ...(a.of != null ? { of: a.of } : {}) } },
  })),
  // A hand changed what governs the run — its width, its clock, one part's clock.
  TUNE: (state, a) => update(state, a.id, (r) => ({
    ...r,
    concurrency: a.concurrency ?? r.concurrency,
    ceiling: a.ceiling ?? r.ceiling,
    clock: a.clock ?? null,
    clockWords: a.clockWords || r.clockWords,
    clocks: a.clocks || r.clocks,
    partClocks: a.partClocks || r.partClocks,
    checkIn: a.checkIn ?? r.checkIn,
    clockState: a.clockState || r.clockState,
    tunedBy: a.by ? { by: a.by, stepId: a.stepId ?? null } : r.tunedBy,
  })),
  // Where one part's clock stands: its working time, the stretch it works now, what its clock did.
  CLOCK: (state, a) => update(state, a.id, (r) => ({
    ...r,
    worked: { ...(r.worked || {}), [a.stepId]: a.worked || 0 },
    workingSince: a.since ? { ...(r.workingSince || {}), [a.stepId]: a.since } : without(r.workingSince, a.stepId),
    clockState: a.passed ? { ...(r.clockState || {}), [a.stepId]: a.passed } : without(r.clockState, a.stepId),
  })),
  // A post in the team channel — a member's, the lead's, or the operator's own.
  CHANNEL: (state, a) => update(state, a.id, (r) => (r.channel.some((m) => m.n === a.n) ? r : {
    ...r,
    channel: [...r.channel, { n: a.n, at: a.at, from: a.from, fromStep: a.fromStep ?? null, to: a.to, toStep: a.toStep ?? null, text: a.text }].slice(-CHANNEL_KEEP),
  })),
  // The run answered a part that stopped short: it continues after inMs.
  RETRY: (state, a) => update(state, a.id, (r) => ({
    ...r,
    lines: without(r.lines, a.stepId),
    retries: { ...(r.retries || {}), [a.stepId]: { kind: a.kind, why: a.why, inMs: a.inMs, at: a.at } },
  })),
  // The operator's guidance to one member, as the server recorded it.
  NOTE: (state, a) => update(state, a.id, (r) => ({
    ...r, notes: { ...r.notes, [a.stepId]: [...(r.notes[a.stepId] || []), { note: a.note, at: a.at }] },
  })),
  // A member reached for a tool — newest STEP_TOOLS_MAX kept, like the server.
  TOOL: (state, a) => update(state, a.id, (r) => ({
    ...working(r, a.stepId),
    tools: {
      ...r.tools,
      [a.stepId]: [...(r.tools[a.stepId] || []), {
        tool: a.tool, status: a.status, summary: a.summary ?? null, detail: a.detail ?? null,
      }].slice(-STEP_TOOLS_MAX),
    },
  })),
  STREAM: (state, a) => update(state, a.id, (r) => {
    const prior = r.streams[a.stepId] || { text: '', thought: '' };
    return {
      ...working(r, a.stepId),
      streams: {
        ...r.streams,
        [a.stepId]: {
          text: a.text ? tail(prior.text + a.text) : prior.text,
          thought: a.thought ? tail(prior.thought + a.thought) : prior.thought,
        },
      },
    };
  }),
  DONE: (state, a) => update(state, a.id, (r) => ({
    ...r,
    // A settled run has no member in line, none about to be continued, none working.
    lines: {},
    retries: {},
    workingSince: {},
    phase: 'settled',
    status: a.stopped ? 'stopped' : a.status,
    failures: a.failures || null,
    skipped: a.skipped || null,
    record: a.record || null,
    delivery: a.delivery || null,
  })),
});

/**
 * @param {Object} state
 * @param {{type: string}} action
 * @returns {Object}
 */
export const teamRunsReducer = (state, action) => {
  const handler = handlers[action?.type];
  return handler ? handler(state, action) : state;
};

/** The portal frames this store follows, and the action each becomes. */
export const TEAM_RUN_FRAMES = Object.freeze({
  'operator:team_start': 'START',
  'operator:team_board': 'BOARD',
  'operator:team_torch': 'TORCH',
  'operator:team_part': 'PART',
  'operator:team_tool': 'TOOL',
  'operator:team_note': 'NOTE',
  'operator:team_stream': 'STREAM',
  'operator:team_line': 'LINE',
  'operator:team_retry': 'RETRY',
  'operator:team_tune': 'TUNE',
  'operator:team_clock': 'CLOCK',
  'operator:team_message': 'CHANNEL',
  'operator:team_done': 'DONE',
});
