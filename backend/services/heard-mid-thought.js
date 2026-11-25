// HEARD MID-THOUGHT — the operator's words reach a being WHILE IT IS STILL THINKING (Design note, 2026-11-20: […]).
//
// Words sent mid-turn ride into the turn at the next action boundary (queued-action-handoff.js heardWhileWorking).
// That left one long wait: a round that is still THINKING has no boundary until the thought ends and its action
// finishes — on a busy card, minutes, with the words sitting in the queue. A model cannot be handed words in the
// middle of a generation, so the thought is asked again WITH the words: the round's request is cut while nothing
// has been said or done in it yet, the words join the conversation with the same note (put it on your list, finish
// what you were doing), and the same round runs again. What is lost is the unfinished thought of that one round —
// never an action, never a word already spoken. Once a round has begun to speak, words sent to HOLD leave it to
// finish and ride at the boundary as before.
//
// SENT NOW IS HEARD NOW, EVEN MID-SENTENCE (Design note, 2026-11-21, the third time of asking: […]). A NOW used to cut the WHOLE turn and start another: the being lost the work it was in the middle of — the
// opposite of what was asked. Now a NOW joins the running turn at once: the round is cut wherever it is, thinking or
// speaking; what it had already said is kept, word for word, as its own words so far; the operator's words follow
// them; and the same round runs on from there. Nothing done is lost and the turn is never cut.
import { heardWhileWorking, wordsCanRide } from './queued-action-handoff.js';

export const HEARD_THINKING_REASON = 'heard-while-thinking';
// Said with words that arrived while the being was mid-sentence: its words so far stand just above them.
export const MID_SENTENCE = 'You were in the middle of speaking when this arrived: your words so far stand just above. Do not start over or repeat them — carry on from exactly where you stopped.';

/**
 * impure — one round's ear. `signal` is the round's own (the turn's interrupt still cuts it); `onSpoke` is called at
 * the round's first spoken word; words sent NOW cut it even after that; `cut()` says the round was cut to hear the operator; `take(messages)` runs after the round: true when the round was cut to hear the
 * operator, the words now standing at the end of `messages` — the caller runs the round again.
 * @param {object} connection
 * @param {AbortSignal} turnSignal
 */
export const listenWhileThinking = (connection, turnSignal) => {
  const round = new AbortController();
  let spoke = false;
  // now: the words were sent NOW — the round is cut even when it is already speaking.
  const hear = (now = false) => { if ((now || !spoke) && !round.signal.aborted && !turnSignal.aborted && wordsCanRide(connection)) round.abort(HEARD_THINKING_REASON); };
  connection.onHeldWord = hear;
  return {
    signal: AbortSignal.any([turnSignal, round.signal]),
    onSpoke: () => { spoke = true; },
    // A request cut before its stream opened fails instead of returning: that failure is this cut, not an error.
    cut: () => round.signal.aborted && !turnSignal.aborted,
    take: async (messages, said = '') => {
      if (connection.onHeldWord === hear) connection.onHeldWord = null;
      if (!round.signal.aborted || turnSignal.aborted) return false;
      // What the round had already said when it was cut stays said: its own words so far, before the operator's.
      if (String(said).trim()) messages.push({ role: 'assistant', content: String(said) });
      // Taken back by the operator in the same instant (queue_pull): nothing to add, the round still runs again.
      const note = await heardWhileWorking(connection);
      if (note) messages.push({ role: 'user', content: String(said).trim() ? `${note}\n${MID_SENTENCE}` : note });
      return true;
    },
  };
};
