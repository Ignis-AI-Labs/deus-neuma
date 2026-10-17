/** UTC wall instants for correlation; monotonic clocks for elapsed durations. */
import { performance } from 'node:perf_hooks';

const clocks = new WeakMap();

/** Start one process-local duration measurement. impure — reads real clocks. */
export const startTimer = () => ({ startedAt: new Date().toISOString(), monotonic: performance.now() });

/** Finish a timer without depending on wall-clock adjustments. impure. */
export const finishTimer = (timer) => Object.freeze({
  startedAt: timer.startedAt,
  finishedAt: new Date().toISOString(),
  durationMs: Math.max(0, Math.round(performance.now() - timer.monotonic)),
});

/** Keep process-local clock state outside the durable operation record. impure. */
export const startOperationTiming = (operation) => {
  const timer = startTimer();
  clocks.set(operation, { timer, approvals: [] });
  return timer.startedAt;
};

/** Record the actual broker wait, including denied, interrupted and failed asks. impure. */
export const recordApprovalTiming = (operation, timer, decision) => {
  const clock = clocks.get(operation);
  if (clock) clock.approvals.push(Object.freeze({ ...finishTimer(timer), decision }));
};

/** Snapshot completed timing. Old/missing clocks remain explicitly unmeasured. impure. */
export const finishOperationTiming = (operation) => {
  const clock = clocks.get(operation);
  if (!clock) return Object.freeze({ startedAt: operation.startedAt, finishedAt: new Date().toISOString(),
    durationMs: null, approvalWaitMs: null, activeDurationMs: null, approvals: [] });
  clocks.delete(operation);
  const timing = finishTimer(clock.timer);
  const approvalWaitMs = clock.approvals.reduce((total, span) => total + span.durationMs, 0);
  return Object.freeze({ ...timing, approvalWaitMs,
    // Active includes dispatch and checkpoint overhead; it is not CPU or provider time.
    activeDurationMs: Math.max(0, timing.durationMs - approvalWaitMs),
    approvals: Object.freeze([...clock.approvals]),
  });
};
