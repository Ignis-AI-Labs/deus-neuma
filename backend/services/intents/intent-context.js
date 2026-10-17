/** Captured settlement authority. No detached task may adopt a later turn. */
import { addAllowedTool } from '../tool-policy.js';

const pendingContexts = new WeakMap();

/** impure - interrupt every captured sweep, even after activeTurn is cleared. */
export const cancelIntentSweeps = (connection) => {
  for (const controller of pendingContexts.get(connection) || []) controller.abort();
};

const isRecord = (value) => value !== null && typeof value === 'object'
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

/** Pure - reject unresolved or malformed policy instead of widening to defaults. */
export const validateIntentPolicy = (policy) => {
  if (policy == null) return null;
  if (!isRecord(policy) || typeof policy.then === 'function') throw new Error('intent policy must be a resolved record');
  for (const [server, rules] of Object.entries(policy)) {
    if (['pathGrants', 'sensitiveGrants', 'shellNetwork'].includes(server)) continue;
    if (!isRecord(rules)) throw new Error(`invalid intent policy rules: ${server}`);
    for (const tier of ['allowed', 'denied', 'requireApproval']) {
      if (rules[tier] !== undefined && (!Array.isArray(rules[tier]) || rules[tier].some((name) => typeof name !== 'string'))) {
        throw new Error(`invalid intent policy tier: ${server}/${tier}`);
      }
    }
  }
  return structuredClone(policy);
};

/** impure - snapshot identity, retain the broker map, watch detached invalidation. */
export const captureIntentContext = (source, origin = {}) => {
  const binding = origin.companion ?? source.companion;
  const companion = Object.freeze({ ...binding });
  const sessionId = origin.sessionId ?? source.sessionId;
  const originalSignal = origin.signal ?? source.activeTurn?.signal;
  const turnPromise = source.turnPromise;
  const walletAddress = source.walletAddress;
  const controller = new AbortController();
  const signal = originalSignal ? AbortSignal.any([originalSignal, controller.signal]) : controller.signal;
  source._pendingApprovals ||= new Map();
  const connection = {
    ...source, companion, sessionId, walletAddress,
    _sessionToolPolicy: structuredClone(source._sessionToolPolicy ?? null),
    activeTurn: Object.freeze({ signal }),
  };
  const pending = pendingContexts.get(source) || new Set();
  pending.add(controller);
  pendingContexts.set(source, pending);
  const current = () => {
    const valid = !signal.aborted
      && source.companion === binding
      && source.companion?.neumaId === companion.neumaId
      && source.sessionId === sessionId && source.walletAddress === walletAddress
      && (!source.activeTurn || source.activeTurn.signal === originalSignal)
      && (!source.turnPromise || source.turnPromise === turnPromise)
      && (!source.ws || source.ws.readyState === source.ws.OPEN);
    if (!valid && !controller.signal.aborted) controller.abort();
    return valid;
  };
  // Clearing activeTurn at turn end is ordinary; replacement/rebind is not.
  // The broker otherwise has no wakeup when a detached task loses its binding.
  const watch = setInterval(current, 25);
  watch.unref?.();
  const close = () => controller.abort();
  source.ws?.once?.('close', close);
  return {
    connection, signal, current,
    syncPolicy: (server, tool) => {
      if (current()) source._sessionToolPolicy = addAllowedTool(source._sessionToolPolicy, server, tool);
    },
    release: () => {
      clearInterval(watch); source.ws?.off?.('close', close);
      pending.delete(controller);
      if (!pending.size) pendingContexts.delete(source);
    },
  };
};
