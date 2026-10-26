// queue-retry — the TRY AGAIN law (show-dont-tell-audit.md, finding 29). A
// failed post the platform only stumbled on (send-failure.js: `retry`)
// returns to DRAFT — the same entry, its id and its history — with the
// failure kept in its `attempts` trail and every decision on it cleared. It
// goes out again only through the operator's own APPROVE, the path every
// draft takes (and every send-time re-check with it). Never automatic, never
// a being's: post-queue.js `restage` is reached only from the operator's
// route (social-retry-routes.js).
//
// A post refused for its keys or its words is not retried: those doors are
// elsewhere (the keys row, REVISE).

import { sendFailureCause, SEND_FAILURE } from './send-failure.js';

/** How many past failures one entry keeps. */
const ATTEMPTS_MAX = 10;

// What a fresh decision must not inherit: the failure (moved to `attempts`),
// the old decision (and any mandate it was made under), the send's lease and ticket.
const CLEARED = Object.freeze(['error', 'errorStatus', 'failedAt', 'decidedBy', 'decidedAt', 'decidedUnder', 'sendingAt', 'sendTicket']);

/**
 * The transition's apply (post-queue.js idiom): it mutates the entry it is
 * handed, under the store's lock, or refuses with `{error}` and leaves it as
 * it was.
 * @param {object} entry - a failed queue entry
 * @param {{by: string, at: string}} act - the operator, and when
 * @returns {?{error: string}}
 */
export const restageFailed = (entry, { by, at }) => {
  if (sendFailureCause(entry) !== SEND_FAILURE.retry) {
    return { error: 'this post did not fail on a passing platform error — revise it, or fix what refused it' };
  }
  const attempt = {
    failedAt: entry.failedAt || null,
    error: entry.error || null,
    ...(Number.isInteger(entry.errorStatus) ? { errorStatus: entry.errorStatus } : {}),
  };
  entry.attempts = [...(Array.isArray(entry.attempts) ? entry.attempts : []), attempt].slice(-ATTEMPTS_MAX);
  for (const key of CLEARED) delete entry[key];
  entry.status = 'draft';
  entry.restagedBy = String(by || '');
  entry.restagedAt = at;
  return null;
};
