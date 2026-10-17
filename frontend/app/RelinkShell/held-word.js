// held-word.js — THE HELD WORD STAYS THE OPERATOR'S (Design note, 2026-08-16.
//
// A send carries a hold handle (holdId); while the portal HOLDS that word
// the bubble is addressable, and three doors open on it — none touching the
// flow in progress: rewrite it where it stands (queue_edit), promote it to
// NOW (queue_now), or pull it home to the composer (queue_pull; Escape's
// first tap on an empty field). The queue is SERVER truth: bubbles repaint
// only from the portal's acks, never from desk optimism.

import { HELD_ACK_CHANNELS, heldAckAction } from './stream-held-actions.js';

/** Impure acknowledgement handlers: apply count before the translated action. */
export const heldWordAcks = ({ dispatch, setHeldCount }) => Object.fromEntries(
  HELD_ACK_CHANNELS.map((channel) => [channel, (data) => {
    const frame = heldAckAction(channel, data);
    setHeldCount(frame.count);
    if (frame.action) dispatch(frame.action);
  }]),
);

/** The three doors. `send` is the portal wire; `armVoice` is the same
 *  gesture law every send walks (cut playing speech, resume, sound). */
export const heldWordDoors = ({ send, armVoice }) => ({
  editQueuedThought: (holdId, text) => {
    const trimmed = String(text || '').trim();
    if (holdId && trimmed) send('consciousness:queue_edit', { holdId, thought: trimmed });
  },
  sendQueuedNow: (holdId) => {
    if (!holdId) return;
    armVoice();
    send('consciousness:queue_now', { holdId });
  },
  pullQueuedThought: (holdId = null) =>
    send('consciousness:queue_pull', holdId ? { holdId } : {}),
});

/** The reducer half — the QUEUE_* cases, delegated from stream-reducer.
 *  `withDisplayedAsk` rides in (it is the reducer's own fold law). Pure. */
export const reduceHeldWord = (state, action, withDisplayedAsk) => {
  switch (action.type) {
    case 'QUEUE_MARK':
    case 'QUEUE_CLEAR': {
      const queued = action.type === 'QUEUE_MARK';
      return {
        ...state,
        messages: state.messages.map((m) =>
          (m.holdId === action.holdId && m.queued !== queued ? { ...m, queued } : m)),
      };
    }
    case 'QUEUE_EDIT':
      return {
        ...state,
        messages: state.messages.map((m) =>
          (m.holdId === action.holdId && m.queued ? withDisplayedAsk(m, action.text) : m)),
      };
    case 'QUEUE_PULLED': {
      const index = state.messages.findIndex((m) => m.holdId === action.holdId && m.queued);
      return {
        ...state,
        messages: index < 0
          ? state.messages
          : [...state.messages.slice(0, index), ...state.messages.slice(index + 1)],
        // seq re-seeds the composer even when the same words come home twice.
        pulledDraft: action.text
          ? { seq: (state.pulledDraft?.seq || 0) + 1, text: action.text }
          : state.pulledDraft,
      };
    }
    default:
      return state;
  }
};
