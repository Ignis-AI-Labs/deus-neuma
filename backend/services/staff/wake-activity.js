/**
 * WHO IS AWAKE — the house clock's running wakes as rows of the desk's
 * activity chip (house-state.js houseActivity). A being awake in a wake for a
 * post, a cadence, an operator's answer or a plan review holds no charge in
 * the Optio's drawer and no working entry on the board, so without this leg
 * the chip never showed it (Design note, 2026-10-18: […]).
 *
 * Pure — the queue is read by the caller (wake-queue.js readWakeQueue).
 */

// What woke a seat, in the operator's plain words — the chip's task line.
const WAKE_REASON_WORDS = Object.freeze({
  post: 'house post',
  dispatch: 'a charge from the Optio',
  'run-ended': 'team run ended',
  'run-check-in': 'team run check-in',
  'run-alert': 'team run alert',
  'run-lost': 'team run cut off by a restart',
  cadence: 'review cadence',
  'plan-review': 'team plan to review',
  'plan-verdict': 'the Optio\'s plan verdict',
  'operator-answer': 'your answer',
  scheduled: 'its calendar',
  'charge-due': 'a charge due now',
});

/** @param {string} reason @returns {string} */
export const wakeReasonWords = (reason) => WAKE_REASON_WORDS[reason] || String(reason || 'its queued work').replace(/-/g, ' ');

/**
 * One row per running wake: 'awake' once its turn has its place in the model
 * line, 'waiting' while it still waits for it. The task is every distinct
 * reason its items carry. Pure.
 * @param {{items?: Object[], running?: Object}|null} queue - readWakeQueue's answer
 * @returns {Array<{neumaId: string, status: 'awake'|'waiting', task: string, since: string|null}>}
 */
export const wakeRows = (queue) => Object.entries(queue?.running ?? {}).map(([seat, run]) => {
  const reasons = (queue.items ?? []).filter((i) => run.itemIds?.includes(i.id)).map((i) => wakeReasonWords(i.reason));
  return {
    neumaId: seat,
    status: run.waitingForLine === true ? 'waiting' : 'awake',
    task: [...new Set(reasons)].join(' · ') || 'its queued work',
    since: run.startedAt ?? null,
  };
});
