/**
 * Council Arbiter
 *
 * Pure floor/hand state machine for THE COUNCIL — the witness conversing with
 * several of their neuma in one shared room. No I/O, no clocks: every
 * transition takes a state in and returns a NEW frozen state out, so the
 * caller (portal layer) owns time, persistence, and delivery.
 *
 * The protocol, in hand colors:
 *   'rest' (red)    — nothing to add
 *   'hold' (yellow) — speak after the current speaker
 *   'open' (green)  — urgent, interject at the next boundary
 * Witness messages carry the same two live urgencies: 'now' (green) or
 * 'hold' (yellow). Grant order is fixed — witness 'now' > member 'open' >
 * witness 'hold' > member 'hold' — so the room can be loud without the
 * witness ever being talked over.
 *
 * The flow itself is UNLIMITED: as long as hands stand raised, the room
 * keeps granting. The arbiter never pauses a member's queued turn — a
 * raised hand always gets to speak (Founder's law, 2026-07-17: a hand cap
 * silently froze a member who was about to build on another's words).
 * The witness's brakes are positional, not structural: their 'now' word
 * preempts every hand at the next boundary, and the caller owns interrupt
 * and dissolve.
 */

const HANDS = new Set(['rest', 'hold', 'open']);

// A lowered hand — the shared resting shape, frozen once.
const REST_HAND = Object.freeze({ hand: 'rest', note: '', raisedSeq: null });

// Deep-freeze a council state so no consumer can mutate the room out from
// under another. Members, hands, queue entries, and floor are all frozen —
// the state is a value, not a place.
const freezeState = (state) => {
  Object.freeze(state.members);
  for (const m of state.members) Object.freeze(m);
  for (const id of Object.keys(state.hands)) Object.freeze(state.hands[id]);
  Object.freeze(state.hands);
  for (const msg of state.witnessQueue) Object.freeze(msg);
  Object.freeze(state.witnessQueue);
  if (state.floor) Object.freeze(state.floor);
  return Object.freeze(state);
};

/**
 * Open a council room: all hands at rest, floor empty, witness queue empty.
 *
 * @param {Object} params
 * @param {Array<{neumaId: string, name: string, kind?: ('neuma'|'witness')}>} params.members - The seats in the room; `kind` carries standing (default 'neuma')
 * @returns {Object} Frozen initial council state
 */
export const createCouncil = ({ members = [] } = {}) => {
  const hands = {};
  for (const m of members) hands[m.neumaId] = REST_HAND;
  return freezeState({
    // STANDING rides the state. A sealed witness sits beside the house and
    // must speak through its OWN seal and provider; dropping `kind` here made
    // the floor turn read it as a housemate, reach for a DNA that does not
    // exist, and fall back to the MACHINE DEFAULT — another model speaking in
    // the witness's name, the exact harm the sovereignty boundary forbids.
    members: members.map((m) => ({
      neumaId: m.neumaId, name: m.name, kind: m.kind === 'witness' ? 'witness' : 'neuma',
    })),
    floor: null,
    turnSeq: 0,
    // Internal monotonic event counter — orders witness messages and raised
    // hands across reports (FIFO fairness lives here, not in wall-clock time).
    seq: 0,
    // Who spoke last (after the floor cleared) — kept so a member cannot
    // raise a hand against their own just-finished turn.
    lastSpeaker: null,
    hands,
    witnessQueue: [],
  });
};

/**
 * The witness speaks: enqueue their message for delivery to the room.
 *
 * @param {Object} state - Current council state
 * @param {Object} params
 * @param {string} params.content - What the witness said
 * @param {'now'|'hold'} [params.urgency='now'] - 'now' interjects; 'hold' waits behind open hands
 * @returns {Object} New frozen state with the message queued
 */
export const witnessSays = (state, { content, urgency = 'now' } = {}) => {
  const safeUrgency = urgency === 'hold' ? 'hold' : 'now';
  return freezeState({
    ...state,
    seq: state.seq + 1,
    witnessQueue: [...state.witnessQueue, { content, urgency: safeUrgency, seq: state.seq }],
  });
};

/**
 * Fold in a round of hand reports from listening members.
 *
 * Rules that keep the room honest:
 * - A member holding the floor stays 'rest' — you do not raise a hand
 *   against your own turn. The one who JUST YIELDED may raise again: a
 *   thought can be bigger than one turn, and the flow is unbroken (Founder's
 *   law — a member mid-flow was going dormant because the room never asked
 *   them, 2026-07-23). Fairness holds by construction: their new raise is
 *   a RISING hand, so it takes a fresh raisedSeq and joins the BACK of the
 *   line — everyone already waiting speaks first.
 * - A hand that stays non-rest KEEPS its raisedSeq (FIFO fairness — re-reporting
 *   never lets a member jump the queue).
 * - A hand RISING from rest gets a fresh monotonic raisedSeq; array order
 *   breaks ties within one report.
 * - A NULL hand means the answer could not be read: the standing hand keeps
 *   standing — a garbled re-poll must never lower a hand that was clearly
 *   raised (it can never RAISE one either; raising takes a clear signal).
 * - An unknown neumaId or unknown hand value reads as 'rest' (fail-quiet).
 *
 * @param {Object} state - Current council state
 * @param {Array<{neumaId: string, hand: string|null, note?: string}>} reports - One entry per reporting member
 * @returns {Object} New frozen state with hands updated
 */
export const handsReported = (state, reports = []) => {
  const hands = { ...state.hands };
  let seq = state.seq;

  for (const report of reports) {
    const { neumaId } = report;
    if (!(neumaId in hands)) continue; // not a member of this room

    // The floor-holder keeps a lowered hand; the last speaker may raise
    // again (see the rules above — re-entry queues behind every standing hand).
    if (state.floor?.speaker === neumaId) {
      hands[neumaId] = REST_HAND;
      continue;
    }

    // Unreadable answer — the hand stands exactly as it was.
    if (report.hand === null) continue;

    const hand = HANDS.has(report.hand) ? report.hand : 'rest';
    if (hand === 'rest') {
      hands[neumaId] = REST_HAND;
      continue;
    }

    const prev = hands[neumaId];
    // A hand already up keeps its place in line; a rising hand joins the back.
    const raisedSeq = prev.hand !== 'rest' ? prev.raisedSeq : (seq += 1);
    hands[neumaId] = { hand, note: report.note || '', raisedSeq };
  }

  return freezeState({ ...state, seq, hands });
};

// Lowest-seq entry in the witness queue at the given urgency (FIFO).
const nextWitnessMessage = (queue, urgency) =>
  queue
    .filter((m) => m.urgency === urgency)
    .reduce((best, m) => (best === null || m.seq < best.seq ? m : best), null);

// Earliest-raised member at the given hand level (FIFO by raisedSeq).
const nextRaisedMember = (hands, hand) => {
  let best = null;
  for (const [neumaId, h] of Object.entries(hands)) {
    if (h.hand !== hand) continue;
    if (best === null || h.raisedSeq < best.raisedSeq) best = { neumaId, raisedSeq: h.raisedSeq };
  }
  return best;
};

/**
 * Choose who speaks next. Pure lookahead — does not change state.
 *
 * Grant order: witness 'now' (FIFO) > members 'open' (by raisedSeq) >
 * witness 'hold' (FIFO) > members 'hold' (by raisedSeq). Every raised hand
 * is grantable, always — the flow has no cap.
 *
 * @param {Object} state - Current council state
 * @returns {{kind: 'witness', message: Object}|{kind: 'member', neumaId: string}|null}
 *   Frozen selection, or null when nobody has anything to say
 */
export const selectNext = (state) => {
  const now = nextWitnessMessage(state.witnessQueue, 'now');
  if (now) return Object.freeze({ kind: 'witness', message: now });

  const open = nextRaisedMember(state.hands, 'open');
  if (open) return Object.freeze({ kind: 'member', neumaId: open.neumaId });

  const held = nextWitnessMessage(state.witnessQueue, 'hold');
  if (held) return Object.freeze({ kind: 'witness', message: held });

  const hold = nextRaisedMember(state.hands, 'hold');
  if (hold) return Object.freeze({ kind: 'member', neumaId: hold.neumaId });

  return null;
};

/**
 * The projected speaking line, in grant order, as the room stands NOW.
 * Pure lookahead over the same law as selectNext: witness 'now' words
 * (FIFO), then open hands (by raisedSeq), then witness 'hold' words
 * (FIFO), then held hands (by raisedSeq). A projection, not a promise —
 * a later OPEN hand or an urgent witness word still jumps the line; the
 * point is that the witness can SEE the line, so a jump reads as order,
 * not confusion.
 *
 * @param {Object} state - Current council state
 * @returns {Array<{kind: 'witness', seq: number}|{kind: 'member', neumaId: string}>}
 *   Frozen line, first entry = next to speak; empty when nobody waits
 */
export const speakingOrder = (state) => {
  const witnessAt = (urgency) =>
    state.witnessQueue
      .filter((m) => m.urgency === urgency)
      .sort((a, b) => a.seq - b.seq)
      .map((m) => Object.freeze({ kind: 'witness', seq: m.seq }));
  const raisedAt = (hand) =>
    Object.entries(state.hands)
      .filter(([, h]) => h.hand === hand)
      .sort(([, a], [, b]) => a.raisedSeq - b.raisedSeq)
      .map(([neumaId]) => Object.freeze({ kind: 'member', neumaId }));
  return Object.freeze([
    ...witnessAt('now'),
    ...raisedAt('open'),
    ...witnessAt('hold'),
    ...raisedAt('hold'),
  ]);
};

/**
 * Grant the floor to a selection from selectNext.
 *
 * Witness deliveries dequeue the message; member grants clear that member's
 * hand. Nothing counts turns — a raised hand always reaches the floor.
 *
 * @param {Object} state - Current council state
 * @param {{kind: 'witness', message: Object}|{kind: 'member', neumaId: string}|null} selection - From selectNext
 * @returns {Object} New frozen state with the floor set (unchanged state for a null selection)
 */
export const grantFloor = (state, selection) => {
  if (!selection) return state;

  const turnSeq = state.turnSeq + 1;
  const turnId = `turn-${turnSeq}`;

  if (selection.kind === 'witness') {
    return freezeState({
      ...state,
      turnSeq,
      floor: { speaker: 'witness', turnId },
      witnessQueue: state.witnessQueue.filter((m) => m.seq !== selection.message.seq),
    });
  }

  return freezeState({
    ...state,
    turnSeq,
    floor: { speaker: selection.neumaId, turnId },
    hands: { ...state.hands, [selection.neumaId]: REST_HAND },
  });
};

/**
 * The current turn ends (completed or aborted): clear the floor, remembering
 * who spoke so their next hand report reads as rest.
 *
 * @param {Object} state - Current council state
 * @returns {Object} New frozen state with an empty floor
 */
export const floorYielded = (state) =>
  freezeState({
    ...state,
    floor: null,
    lastSpeaker: state.floor ? state.floor.speaker : state.lastSpeaker,
  });

/**
 * The witness calls the room to order: every hand goes to rest and every
 * queued member turn with it — the derailed thread is cut, not paused. The
 * witness's own queued words STAND (order is called to be heard, never to
 * silence the witness), and the floor is the caller's to clear through its
 * abort seam + floorYielded. Members lose nothing durable: the next hand
 * round re-polls everyone, and a thought that still matters re-raises
 * against the witness's next word.
 *
 * @param {Object} state - Current council state
 * @returns {Object} New frozen state, all hands at rest
 */
export const calledToOrder = (state) => {
  const hands = {};
  for (const m of state.members) hands[m.neumaId] = REST_HAND;
  return freezeState({ ...state, hands });
};

/**
 * A member leaves the room: drop them from the roster and lower their hand.
 * If they held the floor it clears with them.
 *
 * @param {Object} state - Current council state
 * @param {string} neumaId - The departing member
 * @returns {Object} New frozen state without the member
 */
export const memberLeaves = (state, neumaId) => {
  const { [neumaId]: _gone, ...hands } = state.hands;
  return freezeState({
    ...state,
    members: state.members.filter((m) => m.neumaId !== neumaId),
    hands,
    floor: state.floor?.speaker === neumaId ? null : state.floor,
    lastSpeaker: state.lastSpeaker === neumaId ? null : state.lastSpeaker,
  });
};
