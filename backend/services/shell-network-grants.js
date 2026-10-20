// impure: connection-bound consent, disk policy and the real approval broker.
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { approvalCoversOneAct, requestToolApproval } from './tool-approval.js';
import { capturePolicyGrant } from './policy-grant-context.js';
import { readExecutionToolPolicy } from './execution-tool-policy.js';

const states = new WeakMap();
const holders = new Set();
const writes = new Map();
const revocations = new Map();
const interrupted = () => new DOMException('Shell consent interrupted or revoked', 'AbortError');

/** Serialize network consent persistence with its revoke route. impure. */
const withShellNetworkLock = async (laneId, act) => {
  const previous = writes.get(laneId) || Promise.resolve();
  // The previous caller receives its own failure; it must not poison the queue.
  const next = previous.catch(() => {}).then(act);
  writes.set(laneId, next);
  try { return await next; } finally { if (writes.get(laneId) === next) writes.delete(laneId); }
};

/** Invalidate captured capabilities before a lane binding is cleared. impure. */
export const clearShellNetwork = (connection) => {
  const state = states.get(connection);
  state?.controller.abort();
  if (state) holders.delete(state.ref);
  states.delete(connection);
  delete connection._shellNetwork;
  delete connection._shellNetworkDenied;
};

const stateFor = (connection) => {
  let state = states.get(connection);
  if (!state || state.binding !== connection.companion
    || state.laneId !== connection.companion?.neumaId || state.sessionId !== (connection.sessionId ?? null)) {
    clearShellNetwork(connection);
    state = { binding: connection.companion, laneId: connection.companion?.neumaId,
      sessionId: connection.sessionId ?? null, session: null, persisted: false,
      controller: new AbortController(), ref: new WeakRef(connection) };
    states.set(connection, state);
    holders.add(state.ref);
  }
  return state;
};

/** Replace durable consent, never OR it with a stale connection flag. impure. */
export const hydrateShellNetwork = (connection, policy) => {
  const state = stateFor(connection);
  // A closed-book sitting never inherits the lane's standing grant (closed-book.js).
  const persisted = connection?._closedBook !== true
    && !state.revoked && !revocations.has(state.laneId) && policy?.shellNetwork === true;
  if (state.persisted && !persisted) {
    state.controller.abort();
    state.controller = new AbortController();
  }
  state.persisted = persisted;
};

/** Capture binding and originating signal before any approval awaits. impure. */
export const captureShellNetwork = (connection, signal) => {
  const origin = capturePolicyGrant(connection, { signal });
  const state = stateFor(connection);
  const controller = state.controller;
  const combined = AbortSignal.any([controller.signal, ...(origin.signal ? [origin.signal] : [])]);
  const assertCurrent = () => {
    origin.beforeCommit();
    if (!state.laneId || states.get(connection) !== state
      || revocations.has(state.laneId)
      || connection.companion !== state.binding || state.laneId !== connection.companion?.neumaId
      || state.sessionId !== (connection.sessionId ?? null) || connection.ws?.readyState > 1 || combined.aborted) throw interrupted();
  };
  return { state, signal: combined, assertCurrent };
};

/** Decide network reach, separately from command permission. impure. */
export const requestShellNetwork = async (connection, context, emit) => {
  const { state, assertCurrent, signal } = context;
  assertCurrent();
  const policy = await readExecutionToolPolicy(state.laneId);
  assertCurrent();
  hydrateShellNetwork(connection, policy);
  assertCurrent();
  // A CLOSED-BOOK sitting (closed-book.js) runs offline whatever the lane's
  // standing grant says: a persisted ALWAYS must not open the network to a
  // memory test.
  if (connection?._closedBook === true) {
    state.persisted = false;
    state.session = 'deny';
    emit({ status: 'ok', summary: 'closed-book sitting; the shell runs offline' });
    return;
  }
  if (state.persisted || state.session !== null) return;
  // THE DECLARED NETWORK GRANT (ARC-HARNESS L0, #531): a seated benchmark arm
  // declares host network on the command line — the operator's own yes,
  // receipted, session-lived, never persisted to the lane. The declaration
  // IS the consent a headless run could not otherwise give; production
  // connections never carry the flag and keep asking the normal way.
  if (connection?._declaredShellNetwork === true) {
    state.session = 'allow';
    return;
  }
  const decision = await requestToolApproval(connection, {
    tool: 'coding/shell_network', signal,
    args: { laneId: state.laneId, note: 'The internet, outward only: never this machine\'s own services or its home network; scrubbed environment' },
    scope: `Internet (outward only) for lane ${state.laneId}: ALLOW this binding, ALWAYS persisted; revoke in PERMISSIONS`,
  });
  assertCurrent();
  if (decision === 'interrupted') throw interrupted();
  if (decision === 'deny') {
    state.session = 'deny';
    emit({ status: 'ok', summary: 'network not granted; the shell runs offline' });
    return;
  }
  if (decision !== 'allow' && decision !== 'always') throw interrupted();
  // A house yes is for this one command (approvalCoversOneAct): the next one is asked again.
  if (approvalCoversOneAct(connection)) { context.once = true; return; }
  state.session = 'allow';
  if (decision !== 'always') return;
  try {
    await withShellNetworkLock(state.laneId, async () => {
      assertCurrent();
      await neumaWorkspace.updateToolPolicy(state.laneId, (existing) => ({ ...(existing || {}), shellNetwork: true }),
        { signal, beforeCommit: assertCurrent });
      assertCurrent();
      state.persisted = true;
      state.session = null;
    });
  } catch (error) {
    assertCurrent();
    emit({ status: 'ok', summary: 'network granted for this session only (persistence failed)', detail: error.message });
  }
};

/** Runner capability checked again after async preparation, before spawn. impure. */
export const shellNetworkOptions = (context, execute) => ({
  signal: context.signal,
  network: execute && (context.once === true || context.state.persisted || context.state.session === 'allow'),
  beforeSpawn: context.assertCurrent,
});

const liveStates = (laneId) => {
  const found = new Set();
  for (const ref of holders) {
    const connection = ref.deref();
    const state = connection && states.get(connection);
    if (!state || state.binding !== connection.companion || state.laneId !== connection.companion?.neumaId
      || state.sessionId !== (connection.sessionId ?? null) || connection.ws?.readyState > 1) {
      holders.delete(ref);
      continue;
    }
    if (state.laneId === laneId) found.add(state);
  }
  return [...found];
};

/** Session consent visible in the permissions ledger, not claimed as durable. impure. */
export const shellNetworkSessionHeld = (laneId) =>
  liveStates(laneId).some((state) => state.session === 'allow');

/** Revoke all live grants and in-flight approvals for exactly this lane. impure. */
const revokeShellNetwork = (laneId) => {
  for (const state of liveStates(laneId)) {
    state.controller.abort();
    state.controller = new AbortController();
    state.persisted = false;
    state.session = 'deny';
    state.revoked = true;
  }
};

/** Route seam: durable removal and live invalidation share the grant-write lock.
 * Invalidate immediately too, so queued approval cannot land ahead of revoke.
 * impure. */
export const revokeShellNetworkPermission = async (laneId) => {
  const sessionHeld = shellNetworkSessionHeld(laneId);
  revocations.set(laneId, (revocations.get(laneId) || 0) + 1);
  revokeShellNetwork(laneId);
  try {
    return await withShellNetworkLock(laneId, async () => {
      let held = false;
      await neumaWorkspace.updateToolPolicy(laneId, (policy) => {
        held = policy?.shellNetwork === true;
        return held ? { ...policy, shellNetwork: false } : undefined;
      }, { afterCommit: () => revokeShellNetwork(laneId) });
      return { held: held || sessionHeld };
    });
  } finally {
    const pending = revocations.get(laneId) - 1;
    if (pending) revocations.set(laneId, pending);
    else revocations.delete(laneId);
  }
};
