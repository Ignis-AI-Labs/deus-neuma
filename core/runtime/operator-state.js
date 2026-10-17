/**
 * TWO OPERATOR STATES on the wire — the harness and the full platform never
 * hear each other (Design note, 2026-10-14: […]).
 *
 * Every frame the backend fans out to an operator's open desks (portal-send.js
 * deliverToWallet) and the tray's opening history (notification:hydrate) is
 * judged here: a frame BELONGS to the harness (a harness lane's notice), to the
 * full platform (a being's or a witness's notice, a team run), or to the
 * operator in either state (a disk warning, a read marker). A desk hears its
 * own state's frames and the operator's. The desk's state is the lane it is
 * bound to; before it binds, the state it declared when it connected.
 *
 * Proven live by test/integration/harness-separation-live.test.js. Pure.
 */

/** The two states, and the operator's own (null). */
export const OPERATOR_STATE = Object.freeze({ harness: 'harness', full: 'full' });

const isHarnessLaneId = (id) => typeof id === 'string' && id.startsWith('harness-');

/**
 * Which state a stored notification belongs to — by the lane that raised it.
 * @param {{actor?: {id?: string}|null}|null} record
 * @returns {'harness'|'full'|null} null = the operator's, in either state
 */
export const recordState = (record) => {
  const id = record?.actor?.id;
  if (typeof id !== 'string' || id === '') return null;
  return isHarnessLaneId(id) ? OPERATOR_STATE.harness : OPERATOR_STATE.full;
};

/**
 * Which state a fanned-out frame belongs to.
 * @param {{type?: string, record?: object}|null} frame
 * @returns {'harness'|'full'|null}
 */
export const frameState = (frame) => (frame?.type === 'notification:new' ? recordState(frame.record) : null);

/**
 * Which state a desk's connection is in: the lane it is bound to decides;
 * unbound, the state it declared on connecting (?state=harness), else full.
 * @param {{companion?: {neumaId?: string}|null, declaredState?: string}|null} connection
 * @returns {'harness'|'full'}
 */
export const connectionState = (connection) => {
  const lane = connection?.companion?.neumaId;
  if (typeof lane === 'string' && lane !== '') return isHarnessLaneId(lane) ? OPERATOR_STATE.harness : OPERATOR_STATE.full;
  return connection?.declaredState === OPERATOR_STATE.harness ? OPERATOR_STATE.harness : OPERATOR_STATE.full;
};

/** Whether a frame of `state` may reach a desk in `deskState`. */
export const reachesState = (state, deskState) => state === null || state === deskState;

/** The state a desk declared in its socket URL (?state=harness), as a connection field. */
export const declaredStateOf = (value) => (value === OPERATOR_STATE.harness ? OPERATOR_STATE.harness : OPERATOR_STATE.full);

/** The header every desk request carries (frontend/utils/http.js). */
export const STATE_HEADER = 'x-neuma-state';

/**
 * Which operator state an HTTP request comes from — the header the desk sends;
 * absent (an older desk, a CLI, a test) is the full platform. Pure.
 * @param {Record<string, string|string[]|undefined>|null} headers node's lower-cased headers
 * @returns {'harness'|'full'}
 */
export const requestState = (headers) => declaredStateOf(headers?.[STATE_HEADER]);
