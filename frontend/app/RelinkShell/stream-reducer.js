// stream-reducer.js — the display model for the consciousness stream.
//
// Pure and deterministic (no IO, no clocks): a message is a sequence of
// speech and tool segments; the live neuma message accumulates until the
// stream completes. IDs are a sequence counter in state, so the whole model
// unit-tests without mocking randomness or time. A tool segment carries a
// lifecycle `phase` ('acting' → 'resolved'/'orphaned') and, once resolved,
// the raw backend `status` (ok/error/…) for its label and colour —
// mirroring the birth ceremony's ToolActionChip so chips read the same.
//
// Size-law seams (bodies moved verbatim): the live message's segment
// machinery and streaming-content handlers live in
// stream-reducer-segments.js, the witness-gate chip handlers in
// stream-reducer-chips.js, and message assembly / the history fold in
// stream-reducer-messages.js. This file stays the sole import surface.

import { reduceHeldWord } from './held-word.js';
import { streamingIndex, segmentHandlers } from './stream-reducer-segments.js';
import { chipHandlers } from './stream-reducer-chips.js';
import { toHistoryMessages, withDisplayedAsk, pushMessage } from './stream-reducer-messages.js';
import { substrateLineText } from './stream-turn-actions.js';

// --- the voice-sitting contract (SPEECH SYSTEM, Phase A client half) -------
//
// PURPOSE mirrors core/voice/purpose.js across the runtime boundary: absent/
// unknown fails CLOSED to 'work' — a sitting is a voice conversation only
// when the portal's session:purpose ack said so (server truth).
const normalizePurpose = (raw) => (raw === 'conversation' ? 'conversation' : 'work');

/** Pure — is this sitting a declared voice conversation? */
export const isConversationPurpose = (state) => state.purpose === 'conversation';

// GENERATION discipline (CancelScope, mirrored from the stream-session
// bridge): voice frames carry the sitting's generation; a client barge-in
// raises the drop floor, and any older frame is stale by construction —
// it belongs to the utterance the witness cut off.
/** Pure — adopt a frame's generation, monotonically. */
export const advanceVoiceGen = (current, gen) =>
  (Number.isInteger(gen) ? Math.max(current, gen) : current);

/** Pure — is this frame from before the latest client barge-in? */
export const isStaleVoiceGen = (gen, floor) =>
  Number.isInteger(gen) && Number.isInteger(floor) && gen < floor;

/** Pure — the honest in-stream line for a voice:error (degrade:'text'). */
export const voiceErrorText = (code) => {
  switch (code) {
    case 'stt_unavailable':
      return 'voice hearing is unavailable — the sitting continues as text';
    case 'pcm_flood':
      return 'the mic outran the lane — audio was dropped; the sitting continues as text';
    case 'purpose_not_conversation':
      return 'the mic opens only in a declared conversation — the sitting continues as text';
    default:
      return 'the voice lane failed — the sitting continues as text';
  }
};

export const initialState = Object.freeze({
  connected: false,
  pulledDraft: null, // a held word pulled home — the composer seeds from this

  // The sitting's declared purpose (server truth via the session:purpose
  // ack — the PURPOSE action). Fail-closed 'work': the streaming mic path
  // arms only when this reads 'conversation'.
  purpose: 'work',
  // TWO LIGHTS, never one: the LOCAL SUBSTRATE (the machine's own serving —
  // reachable / deliberately resting) and the bound lane's ROUTE (its own
  // provider, probed as itself). Neither may ever borrow the other's truth.
  local: Object.freeze({ reachable: null, standby: false }),
  route: Object.freeze({ live: null, provider: null }),
  localTurns: 0, // turns the LOCAL substrate carries across ALL desks (B-01 broadcast)
  thinking: false,
  seq: 0,
  thread: 0,
  messages: [],
});

// A retry note lives only while the outcome is undecided (Design note, 2026-07-28:
// […]) —
// answered, given up, or turn-ended, it is GONE: never history, only the
// wait made visible.
const retireProviderRetry = (state) =>
  state.messages.some((m) => m.providerRetry || m.lineWait)
    ? { ...state, messages: state.messages.filter((m) => !m.providerRetry && !m.lineWait) }
    : state;

// A live voice partial is a TRANSIENT line — the operator's own speech being
// heard, replaced by each new partial and GONE on the final utterance (the
// ordinary send path then bubbles the words for real). Never history.
const retireVoicePartial = (state) =>
  state.messages.some((m) => m.voicePartial)
    ? { ...state, messages: state.messages.filter((m) => !m.voicePartial) }
    : state;

export const reducer = (state, action) => {
  // The streaming-content and witness-gate chip families live in their own
  // handler-map modules (the size-law seam); the switch below keeps every
  // action that touches link, purpose, voice, or the turn's lifecycle.
  const family = segmentHandlers[action.type] || chipHandlers[action.type];
  if (family) return family(state, action);
  switch (action.type) {
    case 'LINK':
      // A severed link loses activity truth with it — a stale SHARED count
      // must not survive into the next connection.
      return action.connected
        ? { ...state, connected: true }
        : { ...state, connected: false, localTurns: 0 };

    case 'ACTIVITY': {
      // The substrate:activity broadcast (B-01), counted per class server-
      // side: only LOCAL-substrate turns feed the SHARED reading — a third-
      // party turn is never the substrate's load. Malformed counts fail to 0.
      const local = Number.isInteger(action.local) && action.local >= 0 ? action.local : 0;
      return { ...state, localTurns: local };
    }

    case 'LOCAL': {
      // The LOCAL SUBSTRATE light: reachability + deliberate rest, fed ONLY
      // by the machine-config health poll and local-lane stream outcomes.
      const next = {
        reachable: action.reachable ?? null,
        standby: action.standby === true,
      };
      return (state.local.reachable === next.reachable && state.local.standby === next.standby)
        ? state
        : { ...state, local: next };
    }

    case 'ROUTE': {
      // The bound lane's ROUTE light, fed by the lane's own health probe and
      // its route-attributed stream outcomes. `live` tri-state: true / false
      // / null (not yet probed); provider is identity, never health.
      const next = {
        live: action.live !== undefined ? action.live : state.route.live,
        provider: action.provider !== undefined ? action.provider : state.route.provider,
      };
      return (state.route.live === next.live && state.route.provider === next.provider)
        ? state
        : { ...state, route: next };
    }

    case 'USER_SENT':
      return pushMessage(state, 'user', action.text, action.images, action.at, action.holdId, action.docs);

    // A WATCH this chat set fired (portal-watch-delivery.js) — its report opens the turn that follows.
    case 'WATCH_FIRED':
      return pushMessage(state, 'watch', action.text, [], action.at);

    // THE HELD WORD STAYS THE OPERATOR'S (ruling, 2026-08-16) — held-word.js.
    case 'QUEUE_MARK':
    case 'QUEUE_CLEAR':
    case 'QUEUE_EDIT':
    case 'QUEUE_PULLED':
      return reduceHeldWord(state, action, withDisplayedAsk);

    case 'PROVIDER_RETRY': {
      // THE RETRY LADDER, visible (Design note, 2026-07-28: […]): one quiet note that UPDATES per attempt — never nine
      // messages, never an alarm. It marks itself so the next attempt finds
      // it; the turn's success or final refusal simply follows it.
      const seconds = Math.max(1, Math.round((Number(action.delayMs) || 0) / 1000));
      const text = `provider overloaded — retry ${action.attempt}/${action.maxAttempts} in ${seconds}s`;
      const last = state.messages[state.messages.length - 1];
      if (last?.providerRetry) {
        const messages = state.messages.slice();
        messages[messages.length - 1] = {
          ...last,
          segments: [{ kind: 'speech', text, phase: 'settled' }],
          at: action.at ?? last.at,
        };
        return { ...state, messages };
      }
      const next = pushMessage(state, 'error', text, undefined, action.at);
      const marked = next.messages.slice();
      marked[marked.length - 1] = { ...marked[marked.length - 1], providerRetry: true, transient: true };
      return { ...next, messages: marked };
    }

    case 'SUBSTRATE_LINE': {
      // THE LINE, visible (substrate-line.js): one quiet note while this turn waits its turn for
      // the house's model, UPDATED as the line moves, GONE the moment the turn starts.
      if (action.state !== 'waiting') return retireProviderRetry(state);
      const text = substrateLineText(action);
      const last = state.messages[state.messages.length - 1];
      if (last?.lineWait) {
        const messages = state.messages.slice();
        messages[messages.length - 1] = { ...last, segments: [{ kind: 'speech', text, phase: 'settled' }] };
        return { ...state, messages };
      }
      const next = pushMessage(state, 'error', text, undefined, action.at);
      const marked = next.messages.slice();
      marked[marked.length - 1] = { ...marked[marked.length - 1], lineWait: true, transient: true };
      return { ...next, messages: marked };
    }

    case 'PURPOSE': {
      // The session:purpose ack — server truth for what this sitting IS.
      // Fail-closed normalize: unknown values read as 'work'.
      const purpose = normalizePurpose(action.purpose);
      return state.purpose === purpose ? state : { ...state, purpose };
    }

    case 'VOICE_PARTIAL': {
      // A live transcript partial from the streaming voice lane: ONE
      // transient tail line, REPLACED per partial — never a stack of
      // guesses. Thinking untouched: the witness is still speaking.
      const text = typeof action.text === 'string' ? action.text.trim() : '';
      if (!text) return state;
      const last = state.messages[state.messages.length - 1];
      if (last?.voicePartial) {
        const messages = state.messages.slice();
        messages[messages.length - 1] = {
          ...last,
          segments: [{ kind: 'speech', text }],
          at: action.at ?? last.at,
        };
        return { ...state, messages };
      }
      return {
        ...state,
        seq: state.seq + 1,
        messages: [
          ...state.messages,
          {
            id: `m${state.seq}`,
            role: 'user',
            streaming: false,
            isHistory: false,
            transient: true,
            voicePartial: true,
            at: action.at ?? null,
            segments: [{ kind: 'speech', text }],
            meta: null,
          },
        ],
      };
    }

    case 'VOICE_UTTERANCE':
      // The final transcript left the voice lane — the transient partial
      // retires; the words bubble for real through the ORDINARY send path
      // (USER_SENT), so record and stream each carry them exactly once.
      return retireVoicePartial(state);

    case 'VOICE_NOTE': {
      // voice:error with degrade:'text' — an honest standing note (not
      // transient: it is an outcome, not a wait), and any live partial
      // retires with the mic it rode in on.
      return pushMessage(retireVoicePartial(state), 'error', voiceErrorText(action.code), undefined, action.at);
    }

    case 'ERROR': {
      // A refusal whose turn-point was persisted (post-check failures, e.g.
      // provider overload) carries the point's identity — the bubble offers
      // ↻ because the point EXISTS on the record; a pre-persist refusal
      // carries none, offers none. The ladder's final refusal REPLACES its
      // retry note — the outcome is known, the wait is over.
      const next = pushMessage(retireProviderRetry(state), 'error', action.text, undefined, action.at);
      const turnId = typeof action.turnId === 'string' && action.turnId ? action.turnId : null;
      // What actually failed, in the provider's own words, rides under the bubble.
      const reason = typeof action.reason === 'string' && action.reason && !String(action.text).includes(action.reason) ? action.reason : null;
      if (!turnId && !reason) return next;
      const messages = next.messages.slice();
      messages[messages.length - 1] = { ...messages[messages.length - 1], ...(turnId ? { turnId } : {}), ...(reason ? { reason } : {}) };
      return { ...next, messages };
    }

    case 'STREAM': {
      // Any stream activity retires the thinking placeholder — even a chunk
      // that yields no visible speech (empty, or a held-back partial marker).
      // It also retires the retry note: the provider is answering again.
      const retired = retireProviderRetry(state);
      return retired.thinking ? { ...retired, thinking: false } : retired;
    }

    case 'COMPLETE': {
      // The turn's word is final — a standing retry note's wait is over.
      const settled = retireProviderRetry(state);
      const idx = streamingIndex(settled.messages);
      if (idx === -1) return { ...settled, thinking: false };
      const message = settled.messages[idx];
      // An action whose result never arrived must not tick forever — and a
      // prompt whose resolution never arrived must not offer dead buttons.
      const segments = message.segments.map((s) =>
        s.kind === 'tool' && s.phase === 'acting' ? { ...s, phase: 'orphaned' }
          : s.kind === 'approval' && s.phase === 'pending' ? { ...s, phase: 'resolved', decision: 'expired' }
            : s.kind === 'ask' && s.phase === 'pending' ? { ...s, phase: 'resolved', status: 'expired', answer: '' }
              : s.kind === 'plan' && s.phase === 'pending' ? { ...s, phase: 'resolved', status: 'expired', notes: '' }
                : s.kind === 'teamrun' && s.phase === 'pending' && !s.background ? { ...s, phase: 'resolved', status: 'expired', detail: '' }
                  : s
      );
      const messages = settled.messages.slice();
      messages[idx] = message.takes
        ? {
            ...message, streaming: false, segments, meta: action.metadata || null,
            takes: message.takes.map((t, i) => (i === message.takeIndex - 1
              ? { ...t, segments, meta: action.metadata || null }
              : t)),
          }
        : { ...message, streaming: false, segments, meta: action.metadata || null };
      return { ...settled, thinking: false, messages };
    }

    case 'RETRY_SENT': {
      // A new take of a point was asked for (THE TAKES) — the thinking
      // placeholder stands until the take's first frame retires it. No user
      // bubble: the point was asked once, on disk and on screen alike.
      //
      // THE EDIT-FORK: a retry carrying revised words ({turnId, ask}) re-points
      // the bubble's DISPLAYED asking to the revision — the new take streams as
      // the viewed latest, so its ask is what the fold law shows. The first
      // asking is kept in `askOriginal` and the revision in `asks` (keyed by
      // the take's number — the point's count + 1, the index the server will
      // mint), so a later TAKE_SWITCH re-folds the asking with the answer.
      const turnId = typeof action.turnId === 'string' && action.turnId ? action.turnId : null;
      const ask = typeof action.ask === 'string' && action.ask ? action.ask : null;
      if (!turnId || !ask) return { ...state, thinking: true };
      const userIdx = state.messages.findIndex((m) => m.role === 'user' && m.turnId === turnId);
      if (userIdx === -1) return { ...state, thinking: true };
      const point = state.messages.find((m) => m.role === 'neuma' && m.turnId === turnId);
      const k = point?.takeCount ? point.takeCount + 1 : null;
      const message = state.messages[userIdx];
      const askOriginal = message.askOriginal
        ?? message.segments.filter((s) => s.kind === 'speech').map((s) => s.text || '').join('');
      const messages = state.messages.slice();
      messages[userIdx] = {
        ...withDisplayedAsk(message, ask),
        askOriginal,
        asks: { ...(message.asks || {}), ...(k ? { [k]: ask } : {}) },
      };
      return { ...state, thinking: true, messages };
    }

    case 'TAKE_SWITCH': {
      // The witness moved the view to another take of a point — a LOCAL
      // re-fold (every take is already on the message); the switch itself
      // rode to the portal beside this action (consciousness:take_view), an
      // append-only fact in the same record. Refused while the point streams:
      // the live take is the view until it settles.
      const idx = state.messages.findIndex((m) => m.role === 'neuma' && m.turnId === action.turnId);
      if (idx === -1) return state;
      const message = state.messages[idx];
      const k = action.takeIndex;
      if (!message.takes || message.streaming
          || !Number.isInteger(k) || k < 1 || k > message.takes.length
          || k === message.takeIndex) return state;
      const take = message.takes[k - 1];
      const messages = state.messages.slice();
      messages[idx] = {
        ...message,
        takeIndex: k,
        at: take.at ?? null,
        segments: take.segments,
        meta: take.meta ?? null,
      };
      // The point's DISPLAYED asking follows the viewed take (the fold law,
      // live): the take's revised ask when one was recorded for it, the first
      // asking otherwise. Only a bubble the edit-fork touched carries the
      // map — every other point's asking never moves.
      const userIdx = state.messages.findIndex((m) => m.role === 'user' && m.turnId === action.turnId);
      if (userIdx !== -1) {
        const userMsg = state.messages[userIdx];
        if (userMsg.asks || userMsg.askOriginal !== undefined) {
          const text = userMsg.asks?.[k] ?? userMsg.askOriginal;
          if (typeof text === 'string') messages[userIdx] = withDisplayedAsk(userMsg, text);
        }
      }
      return { ...state, messages };
    }

    case 'TURN_STAMP': {
      // The server named the turn-point this turn answers (its frames carry
      // the turnId) — back-patch the LIVE user bubble that opened the turn,
      // so ↻ and EDIT can reach the point without a reload (history rows
      // already carry it from the fold). The EARLIEST unstamped live user
      // message is the one in flight: turns complete in send order, held
      // words included. Idempotent by the point's name — a retry's own point
      // is already named on screen, so the stamp is a no-op there.
      const turnId = typeof action.turnId === 'string' && action.turnId ? action.turnId : null;
      if (!turnId) return state;
      if (state.messages.some((m) => m.turnId === turnId)) return state;
      const idx = state.messages.findIndex((m) => m.role === 'user' && !m.turnId && !m.isHistory);
      if (idx === -1) return state;
      const messages = state.messages.slice();
      messages[idx] = { ...messages[idx], turnId };
      return { ...state, messages };
    }

    case 'HISTORY': {
      // History arrives once, before any live turn, already display-stripped.
      const history = toHistoryMessages(action.messages, state.seq, 'h');
      return {
        ...state,
        seq: state.seq + history.length,
        messages: [...history, ...state.messages],
      };
    }

    case 'LOAD': {
      // Replace the display with a selected past session (resuming a chat) —
      // unlike HISTORY, which prepends to the live thread. Link state survives.
      const prefix = action.threadKey ? `l:${action.threadKey}:` : 'l';
      const messages = toHistoryMessages(action.messages, 0, prefix);
      return {
        ...initialState,
        connected: state.connected,
        purpose: state.purpose,
        local: state.local,
        route: state.route,
        localTurns: state.localTurns,
        seq: messages.length,
        thread: state.thread + 1,
        messages,
      };
    }

    case 'RESET':
      // Clear the display for a deliberately fresh chat; link state survives.
      return {
        ...initialState,
        connected: state.connected,
        purpose: state.purpose,
        local: state.local,
        route: state.route,
        localTurns: state.localTurns,
        thread: state.thread + 1,
      };

    default:
      return state;
  }
};
