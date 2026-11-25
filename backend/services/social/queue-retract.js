// queue-retract — the RETRACT law (Design note, 2026-11-12: […]). A SENT post the house takes back is deleted from its platform
// and stays in the record as `retracted` — the record says it went out and
// was withdrawn after, never that it did not happen. A retracted answer no
// longer stands, so the reply it answered may be answered again (the
// corrected words). X alone today: it is the platform the reply lane speaks.
//
// The transition's apply follows the post-queue.js idiom: it mutates the
// entry handed to it under the store's lock, or refuses with {error}. Pure.

/** The platforms a being can retract on. */
export const RETRACT_CHANNELS = Object.freeze(['x']);

/**
 * Why this entry cannot be retracted, or null. Pure.
 * @param {?object} entry
 * @returns {?string}
 */
export const retractRefusal = (entry) => {
  if (!entry) return 'no such post in the house\'s queue';
  if (entry.status !== 'sent') return `it is ${entry.status}, not sent — an unsent post is pulled with queue_cancel`;
  if (!RETRACT_CHANNELS.includes(entry.channelId)) return `retracting on ${entry.channelId} is not built yet — X alone today`;
  if (!entry.postId) return 'the record holds no platform id for it, so it cannot be found to delete';
  return null;
};

/**
 * Mark a sent entry retracted. Pure (mutates the entry it is handed).
 * @param {object} entry
 * @param {{by: string, reason?: string, at: string}} act
 * @returns {?{error: string}}
 */
export const retractSent = (entry, { by, reason = '', at }) => {
  const refusal = retractRefusal(entry);
  if (refusal) return { error: refusal };
  entry.status = 'retracted';
  entry.retractedBy = String(by || '');
  entry.retractedAt = at;
  if (reason) entry.retractReason = String(reason).slice(0, 200);
  return null;
};
