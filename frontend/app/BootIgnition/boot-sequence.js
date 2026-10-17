// boot-sequence.js — the startup's instruments: probe result → verdict. Pure.
//
// THE IGNITION (frontend/app/Ignition/) shows each instrument's verdict on
// its ring and the gateway's strip reports them (ignition-report.js). SHINKEI
// binds: every verdict states a true count or a true state — a failed
// measurement is itself a truthful result, an honest absence is never a failure.

/** The instruments every startup runs, in order (the report's keys). */
export const ROW_KEYS = Object.freeze(['PLATFORM', 'MEMORY', 'PORTAL']);

// The Arrival's stages, in order — where its being and session are proven.
const ARRIVAL_ORDER = ['IDLE', 'REACHING', 'ANCHORING', 'RESUMING', 'BOUND', 'DONE'];

// Display states. ok/bound render signal (live and true), empty/standby
// render plain ink (honest absence, not a failure), fail renders alert.
export const ROW_STATE = Object.freeze({
  OK: 'ok',
  EMPTY: 'empty',
  BOUND: 'bound',
  STANDBY: 'standby',
  FAIL: 'fail',
});

/**
 * BEING / SESSION from the Arrival's published stage (desk entry): null while
 * still open, a verdict once the stage proves it, FAIL on a HOLDING.
 * @param {'BEING'|'SESSION'} key
 * @param {?{stage: string, resumeExpected: ?boolean}} arrival
 */
export const arrivalRow = (key, arrival) => {
  if (!arrival) return null;
  if (arrival.stage === 'HOLDING') return { state: ROW_STATE.FAIL, text: 'HOLDING' };
  const at = ARRIVAL_ORDER.indexOf(arrival.stage);
  if (key === 'BEING') return at >= ARRIVAL_ORDER.indexOf('RESUMING') ? { state: ROW_STATE.OK, text: 'OK · ANCHORED' } : null;
  if (at < ARRIVAL_ORDER.indexOf('BOUND')) return null;
  return arrival.resumeExpected === false
    ? { state: ROW_STATE.OK, text: 'OK · FRESH' }
    : { state: ROW_STATE.OK, text: 'OK · RESUMED' };
};

/** The ceiling on an Arrival instrument: a stage unanswered this long declares NO ANSWER. */
export const ARRIVAL_ROW_CEILING_MS = 9000;

const pad3 = (n) => String(n).padStart(3, '0');

/** PLATFORM: does the local platform answer, and how fast truly. */
export const platformRow = (result) =>
  result.ok
    ? { state: ROW_STATE.OK, text: `OK · ${pad3(result.ms)}MS` }
    : { state: ROW_STATE.FAIL, text: 'TIMEOUT' };

export const memoryRow = (result) => {
  if (!result.ok) return { state: ROW_STATE.FAIL, text: 'BLOCKED' };
  return result.held
    ? { state: ROW_STATE.OK, text: 'OK · ROSTER HELD' }
    : { state: ROW_STATE.EMPTY, text: 'EMPTY' };
};

export const portalRow = (result) =>
  result.bound
    ? { state: ROW_STATE.BOUND, text: 'BOUND' }
    : { state: ROW_STATE.STANDBY, text: 'AWAITING IDENTITY' };
