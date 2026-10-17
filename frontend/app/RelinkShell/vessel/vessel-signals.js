// vessel-signals.js — what the vessel's face needs from the consciousness
// stream, as a pure selector over the stream reducer's state.

/**
 * Derive the face-driving signals from stream state.
 * `speaking` — the neuma is streaming a response right now.
 * `emotion`/`emotionId` — the label of the most recent live (non-history)
 * completed neuma message carrying emotion metadata, plus that message's id
 * so the same label on a new message still re-triggers the expression.
 * @param {{messages?: Array}|null|undefined} state
 * @returns {{speaking: boolean, emotion: string|null, emotionId: string|null}}
 */
export const deriveVesselSignals = (state) => {
  const messages = state?.messages || [];
  const last = messages[messages.length - 1];
  const speaking = !!(last && last.role === 'neuma' && last.streaming);
  const emotive = messages.findLast((m) => m.role === 'neuma' && !m.isHistory && m.meta?.emotion);
  return {
    speaking,
    emotion: emotive ? emotive.meta.emotion : null,
    emotionId: emotive ? emotive.id : null,
  };
};

/**
 * Per-frame decision: should the driver (re)apply an emotion? Applies only
 * when the emotive message changed — including the same label on a new
 * message (hold refreshes) and a change to no message at all (emotion
 * clears, e.g. after a session switch).
 * @param {{emotion: string|null, emotionId: string|null}|null} live
 * @param {string|null} appliedEmotionId - id last applied to the driver
 * @returns {{apply: boolean, emotion?: string|null, appliedEmotionId: string|null}}
 */
export const decideEmotionApply = (live, appliedEmotionId) => {
  if (!live || live.emotionId === appliedEmotionId) {
    return { apply: false, appliedEmotionId };
  }
  return { apply: true, emotion: live.emotion, appliedEmotionId: live.emotionId };
};
