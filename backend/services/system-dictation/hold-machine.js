// hold-machine — a held key becomes a recording, the ears way: held past HOLD_MS it starts, its
// release stops it, a shorter tap does nothing. Pure; system-dictation.js feeds it the key's downs,
// ups and the timer, and acts on what it answers.

/** How long the key must be held before it records (ears' tap threshold). */
export const HOLD_MS = 250;

export const IDLE = Object.freeze({ phase: 'idle', downAt: null });

/**
 * One step. Events: {type: 'down'|'up'|'timer', at: ms}. Actions: 'arm' (start a HOLD_MS timer),
 * 'start' (begin recording), 'stop' (end it and read it), or null.
 * @param {{phase: 'idle'|'pending'|'recording', downAt: ?number}} state
 * @param {{type: string, at: number}} event
 * @returns {{state: object, action: ?string}}
 */
export const holdStep = (state, event) => {
  if (event.type === 'down') {
    return state.phase === 'idle'
      ? { state: { phase: 'pending', downAt: event.at }, action: 'arm' }
      : { state, action: null }; // auto-repeat, or a second keyboard's same key
  }
  if (event.type === 'timer') {
    return state.phase === 'pending' && event.at - state.downAt >= HOLD_MS
      ? { state: { phase: 'recording', downAt: state.downAt }, action: 'start' }
      : { state, action: null };
  }
  if (event.type === 'up') {
    if (state.phase === 'recording') return { state: IDLE, action: 'stop' };
    return { state: IDLE, action: null }; // a tap
  }
  return { state, action: null };
};
