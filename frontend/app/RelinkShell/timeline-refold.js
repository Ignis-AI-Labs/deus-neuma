// timeline-refold — THE TIMELINE on the live screen (Design note, 2026-11-24: […]).
//
// The record's fold already knows which flow each point belongs to (branch-view.js hiddenPoints). The live screen
// follows it in two moves:
//   a take opens at an EARLIER point (retry, or the edit-fork)  what followed the old take leaves the screen at
//                                                               once: it is in the record, and returns with its take
//   the view moves to another take (‹ k/N ›)                     once the portal has recorded the move, the screen
//                                                               is read again from the record, in place
// "In place": the messages are replaced and nothing else of the stream's state moves, and a bubble that is still
// on screen keeps its id, so it does not blink.
import { loadSessionMessagesStrict } from './workspace-sessions.js';
import { RECENT_ROWS } from '../../../core/runtime/memory-section.js';

export { cutAfter, keepIds } from './timeline-refold-pure.js';

/** impure — the portal recorded a move of the view: read the chat again and put it on screen. Never throws. */
export const refoldOnTakeView = ({ wsService, dispatch, companionRef }) => async (frame) => {
  const neumaId = companionRef.current?.neumaId;
  const sessionId = frame?.sessionId ?? wsService.getSessionState?.()?.sessionId;
  if (!neumaId || !sessionId) return;
  try {
    const messages = await loadSessionMessagesStrict(neumaId, sessionId, RECENT_ROWS);
    if (messages.length) dispatch({ type: 'REFOLD', messages, turnId: frame?.turnId ?? null });
  } catch { /* the screen keeps what it shows; the record is intact and the next open reads it */ }
};
