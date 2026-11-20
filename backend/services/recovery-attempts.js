import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { consumeRateSlot } from '../../core/workspace/rate-slots.js';

// impure — one durable lane-wide quota shared by every recovery password oracle.
export const consumeRecoveryAttempt = (neumaId) => consumeRateSlot(neumaWorkspace, neumaId, {
  namespace: 'recovery-attempts',
  limit: 8,
  windowMs: 15 * 60 * 1000,
});

export const recoveryLimitResponse = (res) => res.status(429).json({ error: 'Too many recovery attempts; try again later' });
