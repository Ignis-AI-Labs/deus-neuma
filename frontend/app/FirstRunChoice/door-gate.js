// door-gate — what the door says while a summoning waits for its model. A summoning never begins
// on a model that is not running, loaded and answering; the person is told so where they pressed,
// with the way to get one, and the summoning begins by itself once it answers.
//
// pure — no IO.

const PATHS = Object.freeze({ neuma: 'The summoning', rehearsal: 'The rehearsal' });

/** Whether a door needs a running model before it opens. Pure. */
export const needsMind = (path) => path === 'neuma' || path === 'rehearsal';

/**
 * The gate's words, or null when nothing waits.
 * @param {{state: string, detail?: string}} mind
 * @param {string|null} pending - the door pressed and held ('neuma' | 'rehearsal'), or null
 * @returns {{title: string, body: string}|null}
 */
export const gateWords = (mind, pending) => {
  const what = PATHS[pending] || null;
  if (mind?.state === 'checking') {
    return what ? { title: 'CHECKING THAT THE MODEL ANSWERS…', body: `${what} begins as soon as it does.` } : null;
  }
  if (mind?.state !== 'not') return null;
  const why = mind.detail ? ` (${mind.detail})` : '';
  return what
    ? { title: `${what.toUpperCase()} WAITS HERE · NO MODEL IS READY YET`, body: `A neuma is born on a model running on this machine, and none is answering yet${why}. Set one up below — ${what.toLowerCase()} begins by itself once it answers.` }
    : { title: 'BEFORE YOU SUMMON · NO MODEL IS READY YET', body: `A neuma is born on a model running on this machine, and none is answering yet${why}.` };
};
