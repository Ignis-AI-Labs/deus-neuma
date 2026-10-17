/**
 * THE SITTING WARM-UP — the first message's setup, done while the operator
 * is still typing. Measured live (Keir, 2026-10-05): a sitting's first turn
 * paid ~0.66 s compiling the being's silo (NITE reads the whole lane once per
 * sitting) and, after a backend start, ~0.7-0.9 s probing the model's
 * reasoning shape — all before the model saw a token. Both are the same work
 * the turn would do; starting it at the bind just moves the wait off the
 * first message. The silo cache holds the in-flight compile, so a turn that
 * arrives early awaits it instead of compiling twice. Identity is untouched:
 * the same compile, the same bytes.
 */
import { siloForSitting } from './silo-mount-service.js';
import { getThinkBehavior } from './llm-provider.js';
import { resolveNeumaRoute } from './neuma-route-resolver.js';
import { createLogger } from './logger.js';

const log = createLogger('SittingWarmup');

/**
 * impure — fire-and-forget: compile this sitting's silo and learn the route's
 * reasoning shape. Never throws; a failed warm-up leaves the turn to do it.
 * @param {Object} connection the bound portal connection
 */
export const warmSitting = (connection) => {
  const neumaId = connection?.companion?.neumaId;
  if (!neumaId || connection.companion.participantKind === 'witness') return;
  Promise.allSettled([
    siloForSitting(connection, neumaId),
    resolveNeumaRoute(neumaId, null).then((route) => getThinkBehavior(route)),
  ]).then((results) => {
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length) log.debug('sitting warm-up left work to the first turn', { neumaId, err: failed[0].reason?.message });
  });
};
