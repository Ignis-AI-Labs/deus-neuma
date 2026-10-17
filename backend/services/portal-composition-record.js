import { buildCompositionEvent } from '../../core/runtime/context-composition.js';
import { settleStanding } from './working-context.js';

/**
 * impure — build this turn's counts-only record, updating historical standing
 * only while the connection still belongs to its captured session and being.
 * A late settlement keeps its own reading without contaminating a new session.
 */
export const settleCompositionRecord = ({
  connection, standingUsage, turnUsage, interrupted, sections,
  completionText, budget, scope, degraded = [], cacheTelemetry = null,
}) => {
  const ownsSession = Boolean(scope?.sessionId && scope?.neumaId
    && connection.sessionId === scope.sessionId
    && connection.companion?.neumaId === scope.neumaId);
  if (ownsSession && Number.isFinite(standingUsage?.promptTokens) && standingUsage.promptTokens > 0) {
    connection.lastMeasuredStanding = { promptTokens: standingUsage.promptTokens };
  }
  return Object.freeze({
    ...buildCompositionEvent({
      sections,
      usage: turnUsage,
      standing: settleStanding(standingUsage, interrupted, ownsSession ? connection.lastMeasuredStanding : null),
      completionText,
      toolResults: ownsSession ? connection.compositionToolResults || [] : [],
      budget,
      degraded,
      cache: cacheTelemetry,
    }),
    ...scope,
    ...(interrupted ? { interrupted: true } : {}),
  });
};
