/** Pure presentation shared by both seats; no arguments or credentials in identifiers. */
export const operationReceiptLabel = (result) => {
  if (!result.operationId) return '';
  const label = `\noperation: ${result.operationId}; state: ${result.operationState}`;
  const timing = result.operationTiming;
  if (!timing) return `${label}\ntiming: unavailable (legacy receipt)`;
  const ms = (value) => Number.isFinite(value) ? `${value} ms` : 'unmeasured';
  return `${label}\nstarted_at: ${timing.startedAt}; finished_at: ${timing.finishedAt}`
    + `\nelapsed: ${ms(timing.durationMs)}; approval_wait: ${ms(timing.approvalWaitMs)}`
    + `; active_including_overhead: ${ms(timing.activeDurationMs)}`;
};

/** A checkpoint failure is a recovery stop, never a provider outage. */
export const operationRecoveryNotice = (error) => error?.code === 'TURN_OPERATION_CHECKPOINT'
  ? `[Operation recovery stopped] ${error.publicMessage || 'The operation record could not be verified. Execution stopped before continuing; inspect the recorded effects before retrying.'}`
  : null;
