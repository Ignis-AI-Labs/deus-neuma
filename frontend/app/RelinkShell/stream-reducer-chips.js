// stream-reducer-chips.js — the witness-gate chip handler family: approval,
// ask, seal, plan, and team-run segments. Split from stream-reducer.js
// (size law); bodies moved verbatim. Pure and deterministic exactly as the
// reducer is: no IO, no clocks.

import { streamingIndex, mapStreamingSegments } from './stream-reducer-segments.js';

// pure — update one LIVE team-run segment wherever it sits. A background run
// outlives the lead's turn, so its frames keep arriving after the message
// that holds the chip stopped streaming; finding the chip by run id (newest
// message first) is what keeps it live. Takes mirror the segment, as
// mapStreamingSegments does.
const mapTeamRun = (state, id, fn) => {
  const hit = (s) => s.kind === 'teamrun' && s.id === id && s.phase === 'pending';
  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    const message = state.messages[i];
    if (!(message.segments || []).some(hit)) continue;
    const segments = message.segments.map((s) => (hit(s) ? fn(s) : s));
    const messages = state.messages.slice();
    messages[i] = message.takes
      ? { ...message, segments, takes: message.takes.map((t, k) => (k === message.takeIndex - 1 ? { ...t, segments } : t)) }
      : { ...message, segments };
    return { ...state, messages };
  }
  return state;
};

// pure — the settled team chip's one-line count. A partial run names what
// failed and what never started, never only "RUN FAILED".
const teamRunDetail = ({ status, order, failures, skipped }) => {
  if (status === 'done') return order ? `${order.length} steps` : '';
  const failed = failures ? Object.keys(failures).length : 0;
  if (!failed) return '';
  const never = skipped?.length ? `, ${skipped.length} never started` : '';
  return `${order?.length ?? 0} done, ${failed} failed${never}`;
};

// The chip handler family — stream-reducer.js delegates these by action
// type; each entry is one former switch case, body verbatim.
export const chipHandlers = Object.freeze({
  // The consciousness reached for a gated tool — the witness decides.
  // The prompt renders inline in the live message, where the act is.
  APPROVAL_REQUEST: (state, action) =>
    mapStreamingSegments({ ...state, thinking: false }, (segments) => [
      ...segments,
      { kind: 'approval', phase: 'pending', id: action.id, tool: action.tool, label: action.label || '', args: action.args || '', fullArgs: action.fullArgs || '', scope: action.scope || '', media: action.media || [], lane: action.lane || null, decision: null },
    ], action.at, action.take),

  // Settled server-side (witness answer, timeout, interrupt, close) —
  // the prompt collapses to its outcome. Unknown ids are a no-op, and a
  // stray resolution after the turn completed must not mint a message.
  APPROVAL_RESOLVED: (state, action) => {
    if (streamingIndex(state.messages) === -1) return state;
    return mapStreamingSegments(state, (segments) =>
      segments.map((s) =>
        s.kind === 'approval' && s.id === action.id && s.phase === 'pending'
          ? { ...s, phase: 'resolved', decision: action.decision }
          : s
      ));
  },

  // The consciousness asked its witness a question — the card renders
  // inline in the live message, where the asking happened.
  ASK_REQUEST: (state, action) =>
    mapStreamingSegments({ ...state, thinking: false }, (segments) => [
      ...segments,
      {
        kind: 'ask', phase: 'pending', id: action.id, status: null, answer: '',
        // A sequenced ask carries its questions, each with its OWN options.
        // The legacy single-question frame is lifted into the same shape so
        // the card only ever renders one thing.
        questions: action.questions?.length
          ? action.questions
          : [{
            question: action.question,
            header: '',
            multiSelect: false,
            options: (action.options || []).map((o) => (typeof o === 'string' ? { label: o, description: '' } : o)),
          }],
        question: action.question,
        options: action.options || [],
      },
    ], action.at, action.take),

  // Settled server-side (answer, timeout, interrupt, close) — the card
  // collapses to what was actually said (or the fact nothing was).
  ASK_RESOLVED: (state, action) => {
    if (streamingIndex(state.messages) === -1) return state;
    return mapStreamingSegments(state, (segments) =>
      segments.map((s) =>
        s.kind === 'ask' && s.id === action.id && s.phase === 'pending'
          ? { ...s, phase: 'resolved', status: action.status, answer: action.answer || '' }
          : s
      ));
  },

  // A being asked for its own on-chain anchor (natalis-self-seal rite) —
  // the offer renders inline in the live message, where the asking
  // happened. `note` carries the drive's live status line.
  SEAL_REQUEST: (state, action) =>
    mapStreamingSegments({ ...state, thinking: false }, (segments) => [
      ...segments,
      { kind: 'seal', phase: 'pending', id: action.id, neumaId: action.neumaId, beingName: action.beingName || '', note: '', status: null, txHash: '' },
    ], action.at, action.take),

  // The desk drive's progress (preflight, signature, broadcast…) — shown
  // on the pending card so the witness sees where the walk stands.
  SEAL_STATUS: (state, action) => {
    if (streamingIndex(state.messages) === -1) return state;
    return mapStreamingSegments(state, (segments) =>
      segments.map((s) =>
        s.kind === 'seal' && s.id === action.id && s.phase === 'pending'
          // needsUnlock opens the card's password door; a fresh drive's
          // progress notes clear it (the flag rides only the refusal).
          ? { ...s, note: action.note || '', needsUnlock: action.needsUnlock === true }
          : s
      ));
  },

  // Settled server-side (sealed, declined, timeout, interrupt, close) —
  // the card collapses to what actually happened on chain (or the honest
  // fact nothing did).
  SEAL_RESOLVED: (state, action) => {
    if (streamingIndex(state.messages) === -1) return state;
    return mapStreamingSegments(state, (segments) =>
      segments.map((s) =>
        s.kind === 'seal' && s.id === action.id && s.phase === 'pending'
          ? {
              ...s, phase: 'resolved', status: action.status, txHash: action.txHash || '',
              network: action.network || null, networkLabel: action.networkLabel || null,
              blockNumber: action.blockNumber ?? null,
            }
          : s
      ));
  },

  // The consciousness submitted a team plan — the witness rules on it
  // inline, where the submission happened.
  PLAN_REQUEST: (state, action) =>
    mapStreamingSegments({ ...state, thinking: false }, (segments) => [
      ...segments,
      { kind: 'plan', phase: 'pending', id: action.id, name: action.name || '', goal: action.goal, steps: action.steps || [], workspace: action.workspace || null, clock: action.clock || '', concurrency: action.concurrency ?? null, checkIn: action.checkIn ?? null, planKind: action.planKind === 'chat' ? 'chat' : 'team', detail: action.detail || '', status: null, notes: '' },
    ], action.at, action.take),

  // Settled server-side (verdict, timeout, interrupt, close) — the card
  // collapses to the decision that was actually made (or that none was).
  PLAN_RESOLVED: (state, action) => {
    if (streamingIndex(state.messages) === -1) return state;
    return mapStreamingSegments(state, (segments) =>
      segments.map((s) =>
        s.kind === 'plan' && s.id === action.id && s.phase === 'pending'
          ? { ...s, phase: 'resolved', status: action.status, notes: action.notes || '' }
          : s
      ));
  },

  // The LEAD put its approved plan to work — the live board renders
  // inline, every member starting as waiting. Inside the lead's own turn the
  // chip joins its message; a run that starts with no turn speaking (the
  // operator's RESUME) gets a message of its own that is NOT streaming — a
  // chip must never leave the chat looking mid-reply, or the being's next
  // words would stream in above the operator's question.
  TEAMRUN_START: (state, action) => {
    const chip = { kind: 'teamrun', phase: 'pending', id: action.id, name: action.name || '', goal: action.goal || '', board: action.board || [], status: null, detail: '', background: action.background === true };
    if (streamingIndex(state.messages) !== -1) {
      return mapStreamingSegments({ ...state, thinking: false }, (segments) => [...segments, chip], action.at, action.take);
    }
    const message = { id: `m${state.seq}`, role: 'neuma', streaming: false, isHistory: false, at: action.at ?? null, segments: [chip], meta: null };
    return { ...state, seq: state.seq + 1, messages: [...state.messages, message] };
  },

  // A member moved — the board updates in place (display only).
  TEAMRUN_BOARD: (state, action) => mapTeamRun(state, action.id, (s) => ({ ...s, board: action.board || s.board })),

  // A member passed its torch mid-run — appended to the segment's arc so
  // the WORKFLOW window can show the work happening, not just the states.
  TEAMRUN_TORCH: (state, action) => mapTeamRun(state, action.id, (s) => ({
    ...s, torches: [...(s.torches || []), { stepId: action.stepId, member: action.member, torch: action.torch }],
  })),

  // The run settled — finished, failed, or stopped, said plainly.
  TEAMRUN_DONE: (state, action) => mapTeamRun(state, action.id, (s) => ({
    ...s, phase: 'resolved',
    status: action.stopped ? 'stopped' : action.status,
    detail: teamRunDetail(action),
    // The run's DELIVERY handle ({id, root}) — the chip walks the
    // workspace live when the operator opens it.
    delivery: action.delivery || null,
    // The run's persisted record id — the chip opens the WORK HISTORY
    // (each member's part, status, torch) from the store.
    record: action.record || null,
  })),
});
