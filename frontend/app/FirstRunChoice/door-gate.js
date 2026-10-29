// door-gate — what the door says while a summoning waits for its model. A summoning never begins
// on a model that is not running, loaded and answering; the model bar says what is missing and
// offers the setup, and this adds one line: the pressed door starts by itself once the model runs.
//
// pure — no IO.

const PATHS = Object.freeze({ neuma: 'The summoning', rehearsal: 'The rehearsal' });

/** Whether a door needs a running model before it opens. Pure. */
export const needsMind = (path) => path === 'neuma' || path === 'rehearsal';

/**
 * The gate's one line, or null when nothing waits.
 * @param {{state: string}} mind
 * @param {string|null} pending - the door pressed and held ('neuma' | 'rehearsal'), or null
 * @returns {string|null}
 */
export const gateWords = (mind, pending) => {
  const what = PATHS[pending] || null;
  if (!what || mind?.state === 'ready') return null;
  return `${what} starts by itself once the model runs.`;
};
