// The repo's own canonical hasher, not the benchmarks copy. This was the ONE
// production import reaching into benchmarks/ (#26), and it made a measurement
// lane load-bearing for the platform: nothing could be moved or cut there
// without breaking team scheduling. Both hashers are sha256 over the same
// canonical JSON, proven identical across nine shapes before the swap, so the
// digests this file compares are byte-unchanged.
import { canonicalSha256 } from '../../core/shared/plain-data-canonical.js';

export const SCHEDULE_POLICIES = Object.freeze({
  PLAN_ORDER: 'plan-order',
  CRITICAL_PATH: 'critical-path',
});

export const ESTIMATE_SOURCE_KINDS = Object.freeze({
  DECLARED_WAIT: 'declared-deterministic-wait',
  EXACT_HISTORY: 'exact-history-median',
  NEUTRAL_ONE: 'neutral-one',
});

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const positive = (value) => Number.isFinite(value) && value > 0;
const nonNegative = (value) => Number.isFinite(value) && value >= 0;

/** Pure, fail-closed normalization for every scheduler policy boundary. */
export const normalizeSchedulePolicy = (value) => (
  value === SCHEDULE_POLICIES.CRITICAL_PATH
    ? SCHEDULE_POLICIES.CRITICAL_PATH
    : SCHEDULE_POLICIES.PLAN_ORDER
);

/** Explicit experiment selection wins; otherwise the single env rollback switch applies. */
export const resolveSchedulePolicy = (explicitPolicy, env = process.env) => normalizeSchedulePolicy(
  explicitPolicy == null ? env?.NEUMA_TEAM_SCHEDULE_POLICY : explicitPolicy
);

const median = (values) => {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
};

const exactHistoryKey = (step, { contractVersion, model, taskClasses }) => {
  const taskClass = own(taskClasses, step.id) ? taskClasses[step.id] : step.taskClass;
  if (!Number.isInteger(contractVersion) || contractVersion < 1) return null;
  if (model == null || typeof step.role !== 'string' || !step.role.trim()) return null;
  if (typeof taskClass !== 'string' || !taskClass.trim()) return null;
  return Object.freeze({ contractVersion, model, role: step.role, taskClass });
};

const historyDuration = (row) => row?.durationMs ?? row?.durationMilliseconds;
const sameHistoryKey = (row, sourceKeySha256) => {
  if (!row || row.status !== 'success') return false;
  const key = {
    contractVersion: row.contractVersion,
    model: row.model,
    role: row.role,
    taskClass: row.taskClass,
  };
  try {
    return canonicalSha256(key) === sourceKeySha256 && positive(historyDuration(row));
  } catch {
    return false;
  }
};

/**
 * Resolve one receipt-shaped estimate per authored step without consulting task
 * text. A declared deterministic wait wins, then a sufficiently sampled exact
 * history key, then neutral one. Undersampled exact keys retain their digest and
 * count so the fallback is replayable rather than unexplained.
 */
export const resolveScheduleEstimates = (steps, {
  declaredWaits = {},
  history = [],
  contractVersion = null,
  model = null,
  taskClasses = {},
  minimumHistorySamples = 3,
} = {}) => {
  if (!Array.isArray(steps)) throw new Error('schedule steps must be an array');
  if (!declaredWaits || typeof declaredWaits !== 'object' || Array.isArray(declaredWaits)) {
    throw new Error('declaredWaits must be an object keyed by step id');
  }
  if (!taskClasses || typeof taskClasses !== 'object' || Array.isArray(taskClasses)) {
    throw new Error('taskClasses must be an object keyed by step id');
  }
  if (!Array.isArray(history)) throw new Error('schedule history must be an array');
  if (!Number.isInteger(minimumHistorySamples) || minimumHistorySamples < 1) {
    throw new Error('minimumHistorySamples must be a positive integer');
  }

  const ids = new Set(steps.map((step) => step.id));
  for (const id of [...Object.keys(declaredWaits), ...Object.keys(taskClasses)]) {
    if (!ids.has(id)) throw new Error(`schedule input names unknown step: ${id}`);
  }

  return Object.freeze(steps.map((step) => {
    if (own(declaredWaits, step.id)) {
      const durationMilliseconds = declaredWaits[step.id];
      if (!positive(durationMilliseconds)) {
        throw new Error(`declared wait for ${step.id} must be positive`);
      }
      return Object.freeze({
        stepId: step.id,
        durationMilliseconds,
        sourceKind: ESTIMATE_SOURCE_KINDS.DECLARED_WAIT,
        sourceSampleCount: 1,
        sourceKeySha256: null,
      });
    }

    const key = exactHistoryKey(step, { contractVersion, model, taskClasses });
    if (key) {
      const sourceKeySha256 = canonicalSha256(key);
      const samples = history.filter((row) => sameHistoryKey(row, sourceKeySha256));
      if (samples.length >= minimumHistorySamples) {
        return Object.freeze({
          stepId: step.id,
          durationMilliseconds: median(samples.map(historyDuration)),
          sourceKind: ESTIMATE_SOURCE_KINDS.EXACT_HISTORY,
          sourceSampleCount: samples.length,
          sourceKeySha256,
        });
      }
      return Object.freeze({
        stepId: step.id,
        durationMilliseconds: 1,
        sourceKind: ESTIMATE_SOURCE_KINDS.NEUTRAL_ONE,
        sourceSampleCount: samples.length,
        sourceKeySha256,
      });
    }

    return Object.freeze({
      stepId: step.id,
      durationMilliseconds: 1,
      sourceKind: ESTIMATE_SOURCE_KINDS.NEUTRAL_ONE,
      sourceSampleCount: 0,
      sourceKeySha256: null,
    });
  }));
};

/** Reverse-DAG remaining weight plus unique descendants, in authored order. */
export const buildSchedulePriorities = (steps, estimateInputs = resolveScheduleEstimates(steps)) => {
  const authoredIndex = new Map();
  const children = new Map();
  for (const [index, step] of steps.entries()) {
    if (authoredIndex.has(step.id)) throw new Error(`duplicate schedule step: ${step.id}`);
    authoredIndex.set(step.id, index);
    children.set(step.id, []);
  }
  for (const step of steps) {
    for (const need of step.needs || []) {
      if (!children.has(need)) throw new Error(`schedule step ${step.id} needs unknown step: ${need}`);
      children.get(need).push(step.id);
    }
  }

  const estimates = new Map();
  for (const row of estimateInputs) {
    if (!authoredIndex.has(row?.stepId)) throw new Error(`estimate names unknown step: ${row?.stepId}`);
    if (estimates.has(row.stepId)) throw new Error(`duplicate estimate for step: ${row.stepId}`);
    if (!positive(row.durationMilliseconds)) throw new Error(`estimate for ${row.stepId} must be positive`);
    estimates.set(row.stepId, row.durationMilliseconds);
  }
  if (estimates.size !== steps.length) throw new Error('estimate inputs must name every schedule step exactly once');

  const remaining = new Map();
  const visiting = new Set();
  const remainingOf = (id) => {
    if (remaining.has(id)) return remaining.get(id);
    if (visiting.has(id)) throw new Error('schedule graph must be acyclic');
    visiting.add(id);
    let childMaximum = 0;
    for (const child of children.get(id)) childMaximum = Math.max(childMaximum, remainingOf(child));
    visiting.delete(id);
    const value = estimates.get(id) + childMaximum;
    remaining.set(id, value);
    return value;
  };
  for (const step of steps) remainingOf(step.id);

  const descendants = new Map();
  const descendantsOf = (id) => {
    if (descendants.has(id)) return descendants.get(id);
    const found = new Set();
    for (const child of children.get(id)) {
      found.add(child);
      for (const nested of descendantsOf(child)) found.add(nested);
    }
    descendants.set(id, found);
    return found;
  };

  return Object.freeze(steps.map((step) => Object.freeze({
    stepId: step.id,
    estimatedDurationMilliseconds: estimates.get(step.id),
    remainingPathWeight: remaining.get(step.id),
    uniqueDescendantCount: descendantsOf(step.id).size,
    authoredIndex: authoredIndex.get(step.id),
  })));
};

/** Sort only the already-ready copy; readiness membership never enters policy code. */
export const prioritizeReady = (ready, { policy, priorities = [] } = {}) => {
  if (normalizeSchedulePolicy(policy) === SCHEDULE_POLICIES.PLAN_ORDER) return ready;
  const byStep = new Map(priorities.map((row) => [row.stepId, row]));
  for (const step of ready) {
    if (!byStep.has(step.id)) throw new Error(`missing schedule priority for ready step: ${step.id}`);
  }
  return [...ready].sort((left, right) => {
    const a = byStep.get(left.id);
    const b = byStep.get(right.id);
    return b.remainingPathWeight - a.remainingPathWeight
      || b.uniqueDescendantCount - a.uniqueDescendantCount
      || a.authoredIndex - b.authoredIndex;
  });
};

const earlierAuthoredPath = (left, right, authoredIndex) => {
  if (!right) return true;
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const delta = authoredIndex.get(left[index]) - authoredIndex.get(right[index]);
    if (delta !== 0) return delta < 0;
  }
  return left.length < right.length;
};

/** Longest observed successful-duration path; failure rows cannot bridge edges. */
export const observedCriticalPath = (steps, timingRows) => {
  const authoredIndex = new Map(steps.map((step, index) => [step.id, index]));
  const successes = new Map(timingRows
    .filter((row) => row.status === 'success' && nonNegative(row.durationMs) && nonNegative(row.waitMs))
    .map((row) => [row.stepId, row]));
  const failures = new Set(timingRows.filter((row) => row.status === 'failure').map((row) => row.stepId));
  const memo = new Map();

  const pathTo = (step) => {
    if (memo.has(step.id)) return memo.get(step.id);
    const row = successes.get(step.id);
    if (!row || (step.needs || []).some((id) => failures.has(id))) {
      memo.set(step.id, null);
      return null;
    }
    let predecessor = null;
    for (const need of step.needs || []) {
      if (!successes.has(need)) continue; // seeded prior work is an observed-path boundary
      const candidate = pathTo(steps[authoredIndex.get(need)]);
      if (!candidate) {
        memo.set(step.id, null);
        return null;
      }
      if (!predecessor
        || candidate.durationMs > predecessor.durationMs
        || (candidate.durationMs === predecessor.durationMs
          && earlierAuthoredPath(candidate.stepIds, predecessor.stepIds, authoredIndex))) {
        predecessor = candidate;
      }
    }
    const result = Object.freeze({
      stepIds: Object.freeze([...(predecessor?.stepIds || []), step.id]),
      durationMs: (predecessor?.durationMs || 0) + row.durationMs,
      idleMs: (predecessor?.idleMs || 0) + row.waitMs,
    });
    memo.set(step.id, result);
    return result;
  };

  let best = null;
  for (const step of steps) {
    const candidate = pathTo(step);
    if (candidate && (!best
      || candidate.durationMs > best.durationMs
      || (candidate.durationMs === best.durationMs
        && earlierAuthoredPath(candidate.stepIds, best.stepIds, authoredIndex)))) best = candidate;
  }
  return best || Object.freeze({ stepIds: Object.freeze([]), durationMs: 0, idleMs: 0 });
};

/** Close private-text-free monotonic observations into one bounded snapshot. */
export const buildScheduleTelemetry = ({
  steps,
  policy,
  maxParallel,
  runStartedAt,
  runFinishedAt,
  activeAreaMs,
  observedPeakConcurrency,
  timingRows,
}) => {
  const authoredIndex = new Map(steps.map((step, index) => [step.id, index]));
  const rows = Object.freeze([...timingRows]
    .sort((left, right) => authoredIndex.get(left.stepId) - authoredIndex.get(right.stepId))
    .map((row) => Object.freeze({ ...row })));
  const makespanMs = Math.max(0, runFinishedAt - runStartedAt);
  return Object.freeze({
    policy: normalizeSchedulePolicy(policy),
    maxParallel,
    runStartedAt,
    runFinishedAt,
    makespanMs,
    activeAreaMs,
    observedPeakConcurrency,
    slotUtilization: makespanMs === 0 ? 0 : activeAreaMs / (maxParallel * makespanMs),
    timingRows: rows,
    observedCriticalPath: observedCriticalPath(steps, rows),
  });
};
