// arrival-machine.js — the Arrival's stage model (#184). Pure: no IO, no
// clocks. The veil feeds it REAL portal events and it answers one question —
// where in the arrival are we, truthfully?
//
// The stages, in the order the real wire produces them
// (WebSocketService.connect → backend/routes/portal-routes.js):
//   REACHING  — connect() called; the socket is opening. Resolves on
//               'portal:established' (the server accepted + authenticated us)
//               — not on bare onopen, which a 4001 can still follow.
//   ANCHORING — the companion manifest is out; the being is crossing.
//               Resolves on 'companion:anchored'.
//   RESUMING  — the sitting's session question is open. Resolves on
//               'portal:resumed' (the server restored — or honestly emptied —
//               the held session), or on RESUME_NONE: a real probe of the
//               sovereign workspace (the same listSessions read the desk
//               itself makes) found no prior session, so there is nothing to
//               resume. The row then resolves FRESH, never a fake OK.
//   BOUND     — the desk has live state. Concrete meaning (documented
//               choice): the portal link is established, the being is
//               anchored, AND the session question has a real answer — the
//               exact conditions under which use-consciousness-stream's
//               onLinkUp marks the link connected and settles history. On a
//               reconnected socket the server answers portal:resume with
//               portal:resumed and no manifest round-trip at all — there the
//               resume IS the anchor, so PORTAL_RESUMED also closes ANCHORING.
//
// Failure → HOLDING with the real reason from the real event. HOLDING is
// honest, not terminal: for the transient class (disconnection /
// reconnect_failed / no_answer) a later real link event recovers the
// arrival from exactly where the wire says it is. The refusal class
// (auth_expired / lane_missing / not_yours) waits on the witness.
//
// SKIP ends the arrival from any non-DONE state; the machine remembers the
// stage it left (`from`) so the parting frame renders the truth — no fake
// OKs on stages that never resolved.

export const STAGES = Object.freeze(['REACHING', 'ANCHORING', 'RESUMING', 'BOUND']);

// Holding reasons, mapped 1:1 from real event types (+ the labeled watchdog).
export const HOLDING_REASONS = Object.freeze([
  'auth_expired',
  'lane_missing',
  'not_yours',
  'reconnect_failed',
  'disconnection',
  'no_answer',
]);

// The transient class: the link can come back on its own (the service's
// re-link cycle never abandons the portal) — real events may recover these.
const RECOVERABLE = Object.freeze(['reconnect_failed', 'disconnection', 'no_answer']);

export const initialArrival = Object.freeze({
  stage: 'IDLE',
  resumeExpected: null, // null = probe pending; false = nothing to resume
  held: null,           // the stage a HOLDING interrupted
  reason: null,         // HOLDING reason (one of HOLDING_REASONS)
  detail: null,         // the real words: server message / watchdog label
  from: null,           // the stage a DONE arrival left from (truthful parting)
});

// Any non-DONE arrival may be held — except a BOUND one: the desk is already
// live and parting; a drop then is the desk's own concern (the stream
// reports it), not the arrival's. HOLDING keeps its first truth.
const hold = (state, reason, detail = null) =>
  (state.stage === 'HOLDING' || state.stage === 'BOUND' || state.stage === 'DONE')
    ? state
    : { ...state, held: state.stage === 'IDLE' ? 'REACHING' : state.stage, stage: 'HOLDING', reason, detail };

// A real link event during a transient HOLDING recovers the arrival to the
// stage the event proves. Refusal-class holdings keep waiting on the witness.
const recover = (state, stage) =>
  (state.stage === 'HOLDING' && RECOVERABLE.includes(state.reason))
    ? { ...state, stage, held: null, reason: null, detail: null }
    : state;

const anchored = (state) => ({
  ...state,
  stage: state.resumeExpected === false ? 'BOUND' : 'RESUMING',
});

/**
 * The arrival transition table.
 * @param {object} state - machine state (see initialArrival)
 * @param {object} event - { type, ... } — real portal events, the resume
 *   probe's answer, the labeled watchdog, and the witness's SKIP/RETRY
 * @returns {object} next state (same reference when the event changes nothing)
 */
export const reduce = (state = initialArrival, event) => {
  switch (event.type) {
    case 'START': // { connected } — mount: a warm socket already passed REACHING
      return state.stage === 'IDLE'
        ? { ...state, stage: event.connected ? 'ANCHORING' : 'REACHING' }
        : state;

    case 'PORTAL_ESTABLISHED': {
      if (state.stage === 'REACHING') return { ...state, stage: 'ANCHORING' };
      return recover(state, 'ANCHORING');
    }

    case 'COMPANION_ANCHORED': {
      if (state.stage === 'ANCHORING') return anchored(state);
      if (state.stage === 'HOLDING') {
        const recovered = recover(state, 'ANCHORING');
        return recovered === state ? state : anchored(recovered);
      }
      return state;
    }

    case 'PORTAL_RESUMED':
      // The resume closes both ANCHORING (reconnect path: resume = anchor)
      // and RESUMING; idempotent in BOUND.
      if (state.stage === 'ANCHORING' || state.stage === 'RESUMING') return { ...state, stage: 'BOUND' };
      if (state.stage === 'HOLDING') return recover(state, 'BOUND');
      return state;

    case 'RESUME_NONE':
      // The probe's answer is a fact worth recording anywhere before BOUND;
      // it only advances the machine when RESUMING is the open question.
      if (state.stage === 'BOUND' || state.stage === 'DONE') return state;
      if (state.stage === 'RESUMING') return { ...state, resumeExpected: false, stage: 'BOUND' };
      return { ...state, resumeExpected: false };

    case 'WATCHDOG': // { detail } — the honest "no answer" label from the veil
      return hold(state, 'no_answer', event.detail || null);

    case 'AUTH_EXPIRED': return hold(state, 'auth_expired');
    case 'LANE_MISSING': return hold(state, 'lane_missing', event.message || null);
    case 'NOT_YOURS': return hold(state, 'not_yours', event.message || null);
    case 'RECONNECT_FAILED': return hold(state, 'reconnect_failed');
    case 'DISCONNECTION': return hold(state, 'disconnection');

    case 'RETRY': // { connected } — re-run the real entry from HOLDING
      return state.stage === 'HOLDING'
        ? { ...initialArrival, resumeExpected: state.resumeExpected, stage: event.connected ? 'ANCHORING' : 'REACHING' }
        : state;

    case 'SKIP':
      return state.stage === 'DONE'
        ? state
        : { ...state, from: state.stage === 'HOLDING' ? state.held : state.stage, stage: 'DONE' };

    case 'FINISH': // the shutters have parted — the arrival is complete
      return state.stage === 'BOUND' ? { ...state, from: 'BOUND', stage: 'DONE' } : state;

    default:
      return state;
  }
};

/**
 * Derive the four stage rows for display. Status vocabulary: idle (not yet
 * reached) → checking (the open question) → ok (answered) — with two honest
 * variants: fresh (RESUMING answered "nothing to resume") and held (the
 * stage a HOLDING interrupted).
 * @param {object} state - machine state
 * @returns {Array<{ key: string, status: 'idle'|'checking'|'ok'|'fresh'|'held' }>}
 */
export const stageRows = (state) => {
  const at = state.stage === 'HOLDING' ? state.held : state.stage === 'DONE' ? state.from : state.stage;
  const idx = STAGES.indexOf(at);
  // BOUND entered means bound: the desk's live state is the answer, so the
  // last row resolves with the rest (likewise a cleanly finished DONE).
  const finished = state.stage === 'BOUND' || (state.stage === 'DONE' && state.from === 'BOUND');
  return STAGES.map((key, i) => {
    let status;
    if (finished || i < idx) status = 'ok';
    else if (i === idx) status = state.stage === 'HOLDING' ? 'held' : 'checking';
    else status = 'idle';
    if (key === 'RESUMING' && status === 'ok' && state.resumeExpected === false) status = 'fresh';
    return { key, status };
  });
};
