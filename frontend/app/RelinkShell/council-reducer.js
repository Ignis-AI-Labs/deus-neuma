// council-reducer.js — the display model for THE COUNCIL.
//
// Pure and deterministic (no IO, no clocks): several neuma share one room
// with their operator, and the transcript accumulates speaker-keyed turns.
// A member's streaming turn is matched by (speaker, turnId) — never "the
// tail" — so chunks for a new turn arriving while an older one settles
// land on the right message, and a chunk that straggles in after its turn
// settled is dropped; late act results can still correct provisional chips.
//
// Hands arrive as the server's array and are held as a map keyed by
// neumaId: 'rest' (quiet), 'hold' (waiting its turn), 'open' (asking for
// the floor now), each optionally carrying the member's own note and its
// place in the speaking line (order, 1 = next to speak).
//
// A message is a list of SEGMENTS — the same shape as the one-on-one
// stream (stream-reducer.js): speech segments and tool segments
// interleaved in arrival order INSIDE the turn, so an act renders in the
// flow exactly where it happened, not as a clump after the words. A tool
// segment is born 'acting' (the block streamed / the server announced the
// run) and resolves in place when the act settles.

export const initialState = Object.freeze({
  councilId: null,
  members: [],
  // The house's shared ground for this sitting (null = unset — tools dark).
  houseWorkspace: null,
  // EACH SEAT's own ground, keyed by lane id. A housemate works the house
  // ground; an external seat works only the cross-house ground raised for it,
  // and null means it has none yet — never a quiet fall back to the house
  // (Founder's law, 2026-07-26).
  hands: {},
  floor: null,
  witnessQueue: 0,
  // The operator's own place in the speaking line (null = no queued word).
  witnessOrder: null,
  // Members weighing a hand right now — thinking made visible.
  considering: [],
  error: null,
  messages: [],
  // The shelf of this wallet's past councils (council:list) — it belongs
  // to the operator, not to any one sitting, so CLOSED keeps it.
  past: [],
});

/** The server's hands array as a neumaId-keyed map. Pure. */
const handsMap = (hands) =>
  (Array.isArray(hands) ? hands : []).reduce(
    (acc, h) =>
      h && h.neumaId
        ? {
            ...acc,
            [h.neumaId]: {
              hand: h.hand || 'rest',
              note: h.note || '',
              order: Number.isInteger(h.order) && h.order > 0 ? h.order : null,
            },
          }
        : acc,
    {}
  );

/** A member's name from the opened roster; the id when unknown. */
const memberName = (members, neumaId) =>
  members.find((m) => m.neumaId === neumaId)?.name || neumaId;

/** Index of the message carrying this speaker's turn, or -1. */
const turnIndex = (messages, speaker, turnId) =>
  messages.findIndex((m) => m.speaker === speaker && m.turnId === turnId);

/** One speech segment holding the whole text — settled records and the
 *  operator's own utterances arrive complete. */
const speechSegments = (text) => (text ? [{ kind: 'speech', text }] : []);

/** Apply fn to the turn's segments. A missing turn is minted live first
 *  (a tool block can open before any word streams); a settled turn is
 *  never reopened. Result frames may correct its act segments. */
const mapTurnSegments = (state, action, fn, { allowSettled = false } = {}) => {
  const i = turnIndex(state.messages, action.neumaId, action.turnId);
  if (i === -1) {
    return {
      ...state,
      messages: [
        ...state.messages,
        {
          speaker: action.neumaId,
          name: memberName(state.members, action.neumaId),
          turnId: action.turnId,
          at: action.at ?? null,
          segments: fn([]),
          live: true,
        },
      ],
    };
  }
  const message = state.messages[i];
  if (!message.live && !allowSettled) return state;
  const messages = state.messages.slice();
  messages[i] = { ...message, segments: fn(message.segments) };
  return { ...state, messages };
};

/** Index of the first tool segment still acting (FIFO — the server runs
 *  the round's calls in the order their blocks streamed), or -1. */
const firstActing = (segments) =>
  segments.findIndex((s) => s.kind === 'tool' && s.phase === 'acting');

export const reducer = (state, action) => {
  switch (action.type) {
    case 'OPENED': {
      // The council convened — a fresh room; nothing from a prior sitting
      // (hands, error) survives into it. A REOPENED council arrives with
      // its restored exchange: settled turns, keyed by their place in the
      // record so React has stable identity.
      const restored = (Array.isArray(action.transcript) ? action.transcript : [])
        .map((t, i) => ({
          speaker: t.speaker,
          name: t.name || String(t.speaker || ''),
          turnId: `restored-${i}`,
          at: t.at ?? null,
          segments: speechSegments(t.content || ''),
          live: false,
        }));
      return {
        ...initialState,
        past: state.past,
        councilId: action.councilId,
        members: Array.isArray(action.members) ? action.members : [],
        houseWorkspace: typeof action.houseWorkspace === 'string' ? action.houseWorkspace : null,
        messages: restored,
      };
    }

    case 'PAST':
      // The operator's shelf of councils, newest first — held outside any
      // one sitting's lifecycle.
      return { ...state, past: Array.isArray(action.councils) ? action.councils : [] };

    case 'STATE': {
      // The room's standing truth: who holds the floor, every hand, how
      // many operator thoughts wait.
      const queue = Number.isInteger(action.witnessQueue) && action.witnessQueue >= 0
        ? action.witnessQueue
        : 0;
      return {
        ...state,
        floor: action.floor ?? null,
        hands: handsMap(action.hands),
        witnessQueue: queue,
        witnessOrder: Number.isInteger(action.witnessOrder) && action.witnessOrder > 0
          ? action.witnessOrder
          : null,
        considering: Array.isArray(action.considering)
          ? action.considering.filter((id) => typeof id === 'string')
          : [],
      };
    }

    case 'HANDS': {
      // The round's verdict after the operator spoke — receipt in the
      // record's flow. Every listener appears: REST is an answer (heard,
      // chose quiet); 'illegible' and 'unreachable' name a member whose
      // answer never truly landed — the debugging line, on screen.
      const reports = (Array.isArray(action.reports) ? action.reports : [])
        .filter((r) => r && typeof r.neumaId === 'string')
        .map((r) => ({
          neumaId: r.neumaId,
          hand: ['rest', 'hold', 'open'].includes(r.hand) ? r.hand : null,
          note: typeof r.note === 'string' ? r.note : '',
          received: ['answered', 'illegible', 'unreachable'].includes(r.received)
            ? r.received
            : 'answered',
        }));
      if (reports.length === 0) return state;
      return {
        ...state,
        messages: [
          ...state.messages,
          // segments stays present (empty) so the tail-follow logic reads
          // this entry like any other message.
          { kind: 'hands', turnId: `hands-${state.messages.length}`, segments: [], reports, live: false },
        ],
      };
    }

    case 'APPROVAL_ASK':
      // A member asks past the house ground — the operator's gate rises in
      // the room's flow, the same chip grammar as the one-on-one stream.
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            kind: 'approval',
            phase: 'pending',
            id: action.id,
            tool: action.tool,
            args: action.args || '',
            scope: action.scope || '',
            turnId: `approval-${action.id}`,
            at: action.at ?? null,
            segments: [],
            live: false,
          },
        ],
      };

    case 'APPROVAL_SETTLED': {
      // Server truth settles the chip (operator answer, timeout, the gavel).
      const i = state.messages.findIndex((m) => m.kind === 'approval' && m.id === action.id);
      if (i === -1) return state;
      const messages = state.messages.slice();
      messages[i] = { ...messages[i], phase: 'resolved', decision: action.decision };
      return { ...state, messages };
    }

    case 'ORDER':
      // THE GAVEL — the operator called the room to order. The mark enters
      // the flow so the cut reads as a deliberate act, never as a fault;
      // considering clears NOW (the state frame right behind it settles
      // hands to rest).
      return {
        ...state,
        considering: [],
        messages: [
          ...state.messages,
          { kind: 'order', turnId: `order-${state.messages.length}`, at: action.at ?? null, segments: [], live: false },
        ],
      };

    case 'SAID':
      // The operator's utterance entered the record — settled on arrival.
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            speaker: 'witness',
            name: action.name || 'OPERATOR',
            turnId: action.turnId,
            at: action.at ?? null,
            segments: speechSegments(action.content || ''),
            live: false,
          },
        ],
      };

    case 'SPEECH': {
      // A chunk from the floor holder. First chunk of a turn mints its
      // message live; later chunks append to THAT turn wherever it sits —
      // extending the last speech segment, or opening a new one when a
      // tool act landed since (the words continue BELOW the act, in flow).
      if (!action.content) return state;
      return mapTurnSegments(state, action, (segments) => {
        const last = segments[segments.length - 1];
        if (last && last.kind === 'speech') {
          return [...segments.slice(0, -1), { ...last, text: last.text + action.content }];
        }
        return [...segments, { kind: 'speech', text: action.content }];
      });
    }

    case 'SPOKE': {
      // The floor holder finished — settle exactly that turn, no other.
      // A chip still acting settles with it (a block that never became an
      // executed act — cut, refused upstream, or not a house tool — must
      // not pulse forever in a finished turn).
      const i = turnIndex(state.messages, action.neumaId, action.turnId);
      if (i === -1 || !state.messages[i].live) return state;
      const messages = state.messages.slice();
      messages[i] = {
        ...messages[i],
        live: false,
        segments: messages[i].segments.map((s) =>
          s.kind === 'tool' && s.phase === 'acting'
            ? { ...s, phase: 'resolved', awaitingResult: true, ok: false, error: 'did not run' }
            : s
        ),
      };
      return { ...state, messages };
    }

    case 'TOOL_OPEN':
      // A tool block opened in the member's stream — the act shows the
      // moment it starts forming, an acting chip inline where the words
      // paused (the same instant the one-on-one stream shows its chip).
      return mapTurnSegments(state, action, (segments) => [
        ...segments,
        { kind: 'tool', phase: 'acting', label: 'tool', path: '', ok: null, error: '' },
      ]);

    case 'TOOL_LABEL':
      // The streamed block closed and yielded its name — name the chip
      // that just formed (the LAST acting one: blocks stream in order).
      // A label with no turn standing is a no-op: it must never mint a
      // blank phantom turn (it only ever follows its own TOOL_OPEN).
      if (turnIndex(state.messages, action.neumaId, action.turnId) === -1) return state;
      return mapTurnSegments(state, action, (segments) => {
        if (!action.label) return segments;
        const i = segments.findLastIndex((s) => s.kind === 'tool' && s.phase === 'acting');
        if (i === -1) return segments;
        const copy = segments.slice();
        copy[i] = { ...copy[i], label: action.label };
        return copy;
      });

    case 'TOOL_ACTING':
      // The server announced the run — name and target the chip about to
      // act (first still-unaddressed one; the server executes the round's
      // calls FIFO). A native call streams no text block, so the chip may
      // be born here.
      return mapTurnSegments(state, action, (segments) => {
        const i = segments.findIndex((s) => s.kind === 'tool' && s.phase === 'acting' && !s.announced);
        const named = { kind: 'tool', phase: 'acting', announced: true, label: action.tool || 'tool', path: action.path || '', ok: null, error: '' };
        if (i === -1) return [...segments, named];
        const copy = segments.slice();
        copy[i] = { ...copy[i], announced: true, label: named.label, path: named.path };
        return copy;
      });

    case 'TOOL_RESULT':
      // The act settled — resolve the first acting chip in place (FIFO,
      // matching execution order). A resolution with no chip standing
      // (a reconnect that missed the acting frames) still enters the flow.
      return mapTurnSegments(state, action, (segments) => {
        const resolved = {
          kind: 'tool',
          phase: 'resolved',
          label: action.tool || 'tool',
          path: action.path || '',
          ok: action.ok === true,
          error: action.error || '',
        };
        const acting = firstActing(segments);
        // Only the provisional SPOKE settlement may be replaced. A real
        // failure with the same text remains a completed result.
        const i = acting !== -1 ? acting : segments.findIndex((s) =>
          s.kind === 'tool' && s.awaitingResult === true
          && (s.label === 'tool' || s.label === resolved.label)
          && (!s.path || s.path === resolved.path));
        if (i === -1) return [...segments, resolved];
        const copy = segments.slice();
        copy[i] = resolved;
        return copy;
      }, { allowSettled: true });

    case 'ERROR':
      // The room refused or broke — said plainly, held until the next
      // convening clears it.
      return { ...state, error: { code: action.code || '', message: action.message || 'The council faltered.' } };

    case 'CLOSED':
      // The council dissolved — a closed sitting, not a deleted one: the
      // room empties but the operator's shelf remains.
      return { ...initialState, past: state.past };

    default:
      return state;
  }
};
