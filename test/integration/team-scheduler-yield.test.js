import { describe, expect, it } from 'vitest';
import { runTeam } from '../../backend/services/team-coordinator.js';
import { runCoordinatedTeam } from '../../backend/services/team-run.js';
import { resolveScheduleEstimates } from '../../backend/services/team-schedule.js';

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const median = (values) => {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)];
};

const durations = Object.freeze({
  'filler-a': 40,
  'filler-b': 40,
  'critical-root': 30,
  'critical-mid': 30,
  'critical-final': 15,
});

// Every step deliberately names the same member. Capacity, not member identity,
// is the concurrency law, and the production runTeam scheduler remains real.
const steps = Object.freeze([
  { id: 'filler-a', neumaId: 'same-member', role: 'worker', task: 'private filler A', needs: [] },
  { id: 'filler-b', neumaId: 'same-member', role: 'worker', task: 'private filler B', needs: [] },
  { id: 'critical-root', neumaId: 'same-member', role: 'worker', task: 'private root', needs: [] },
  { id: 'critical-mid', neumaId: 'same-member', role: 'worker', task: 'private middle', needs: ['critical-root'] },
  { id: 'critical-final', neumaId: 'same-member', role: 'worker', task: 'private final', needs: ['critical-mid'] },
]);

const estimateInputs = resolveScheduleEstimates(steps, { declaredWaits: durations });

const runArm = async (policy) => {
  let telemetry = null;
  const started = [];
  const result = await runTeam({
    steps,
    maxParallel: 2,
    buildMessages: () => [],
    ask: async (_neumaId, _messages, current) => {
      started.push(current.id);
      await wait(durations[current.id]);
      return `result:${current.id}`;
    },
    schedule: {
      policy,
      estimateInputs,
      onTelemetry: (snapshot) => { telemetry = snapshot; },
    },
  });
  const final = telemetry.timingRows.find((row) => row.stepId === 'critical-final');
  return {
    result,
    telemetry,
    started,
    finalDependentMakespanMs: final.finishedAt - telemetry.runStartedAt,
  };
};

const rowMap = (telemetry) => new Map(telemetry.timingRows.map((row) => [row.stepId, row]));

const expectMonotonicRows = (telemetry) => {
  for (const row of telemetry.timingRows) {
    expect(row.readyAt).toBeLessThanOrEqual(row.startedAt);
    expect(row.startedAt).toBeLessThanOrEqual(row.finishedAt);
    expect(row.waitMs).toBeGreaterThanOrEqual(0);
    expect(row.durationMs).toBeGreaterThanOrEqual(0);
    expect(['success', 'failure']).toContain(row.status);
  }
};

describe('critical-path scheduling through actual runTeam waits', () => {
  it('improves paired final-dependent makespan without changing results, dependencies, or capacity', async () => {
    const controls = [];
    const candidates = [];

    // Accepted T2 order law: three pairs, baseline before candidate in the first
    // pair and alternating arm order thereafter. These are real timers through
    // runTeam—not a mocked clock, executor, model, busy loop, or GPU path.
    for (let pair = 0; pair < 3; pair += 1) {
      const order = pair % 2 === 0
        ? ['plan-order', 'critical-path']
        : ['critical-path', 'plan-order'];
      const pairRuns = {};
      for (const policy of order) pairRuns[policy] = await runArm(policy);
      controls.push(pairRuns['plan-order']);
      candidates.push(pairRuns['critical-path']);
    }

    for (let index = 0; index < controls.length; index += 1) {
      const control = controls[index];
      const candidate = candidates[index];
      expect(candidate.result.results).toEqual(control.result.results);
      expect(candidate.telemetry.observedPeakConcurrency).toBeLessThanOrEqual(2);
      expect(control.telemetry.observedPeakConcurrency).toBeLessThanOrEqual(2);
      expect(candidate.telemetry.observedPeakConcurrency).toBe(2);
      expect(candidate.telemetry.slotUtilization).toBeGreaterThan(0);
      expect(candidate.telemetry.slotUtilization).toBeLessThanOrEqual(1);
      expect(control.started.slice(0, 2)).toEqual(['filler-a', 'filler-b']);
      expect(candidate.started.slice(0, 2)).toEqual(['critical-root', 'filler-a']);
      expectMonotonicRows(control.telemetry);
      expectMonotonicRows(candidate.telemetry);

      const rows = rowMap(candidate.telemetry);
      expect(rows.get('critical-root').finishedAt).toBeLessThanOrEqual(rows.get('critical-mid').startedAt);
      expect(rows.get('critical-mid').finishedAt).toBeLessThanOrEqual(rows.get('critical-final').startedAt);
      expect(candidate.telemetry.observedCriticalPath.stepIds)
        .toEqual(['critical-root', 'critical-mid', 'critical-final']);
      expect(JSON.stringify(candidate.telemetry)).not.toContain('private');
      expect(JSON.stringify(candidate.telemetry)).not.toContain('result:');
    }

    expect(median(candidates.map((run) => run.finalDependentMakespanMs)))
      .toBeLessThan(median(controls.map((run) => run.finalDependentMakespanMs)));
  }, 20_000);

  it('omits resumed seed timing instead of fabricating offline duration', async () => {
    const resumedSteps = [
      { id: 'seeded', neumaId: 'member', task: 'private prior work', needs: [] },
      { id: 'child', neumaId: 'member', task: 'private child', needs: ['seeded'] },
    ];
    let telemetry = null;
    const result = await runTeam({
      steps: resumedSteps,
      maxParallel: 1,
      seed: { seeded: 'prior output' },
      buildMessages: () => [],
      ask: async () => {
        await wait(5);
        return 'child output';
      },
      schedule: { onTelemetry: (snapshot) => { telemetry = snapshot; } },
    });

    expect(result.results).toEqual({ seeded: 'prior output', child: 'child output' });
    expect(telemetry.timingRows.map((row) => row.stepId)).toEqual(['child']);
    expectMonotonicRows(telemetry);
    expect(JSON.stringify(telemetry)).not.toContain('prior output');
  });

  it('records real failed settlement time while excluding it from the observed successful path', async () => {
    const failureSteps = [
      { id: 'fails', neumaId: 'member', task: 'private failure', needs: [] },
      { id: 'blocked', neumaId: 'member', task: 'private blocked', needs: ['fails'] },
      { id: 'survives', neumaId: 'member', task: 'private success', needs: [] },
    ];
    let telemetry = null;
    const result = await runTeam({
      steps: failureSteps,
      maxParallel: 2,
      continueOnFailure: true,
      buildMessages: () => [],
      ask: async (_neumaId, _messages, current) => {
        await wait(5);
        if (current.id === 'fails') throw new Error('private failure detail');
        return 'survived output';
      },
      schedule: { onTelemetry: (snapshot) => { telemetry = snapshot; } },
    });

    expect(result.failures).toEqual({ fails: 'private failure detail' });
    expect(result.skipped).toEqual(['blocked']);
    expect(telemetry.timingRows.map((row) => row.stepId).sort()).toEqual(['fails', 'survives']);
    expect(rowMap(telemetry).get('fails').status).toBe('failure');
    expect(telemetry.observedCriticalPath.stepIds).toEqual(['survives']);
    expectMonotonicRows(telemetry);
    expect(JSON.stringify(telemetry)).not.toContain('private failure detail');
  });

  it('keeps scheduler telemetry outside coordinated step payloads and result shape', async () => {
    const events = [];
    let telemetry = null;
    const coordinatedSteps = [{
      id: 'only',
      neumaId: 'member',
      role: 'worker',
      task: 'private coordinated work',
      needs: [],
    }];
    const result = await runCoordinatedTeam({
      steps: coordinatedSteps,
      maxParallel: 1,
      onEvent: (event) => events.push(event),
      ask: async () => {
        await wait(5);
        return 'unchanged output';
      },
      options: {
        schedule: {
          policy: 'critical-path',
          estimateInputs: resolveScheduleEstimates(coordinatedSteps, { declaredWaits: { only: 5 } }),
          onTelemetry: (snapshot) => { telemetry = snapshot; },
        },
      },
    });

    expect(result).toEqual({
      results: { only: 'unchanged output' },
      order: ['only'],
      statuses: {},
      torches: {},
    });
    expect(events).toEqual([{
      type: 'step',
      id: 'only',
      neumaId: 'member',
      role: 'worker',
      output: 'unchanged output',
    }]);
    expect(telemetry.policy).toBe('critical-path');
    expect(telemetry.timingRows.map((row) => row.stepId)).toEqual(['only']);
    expect(JSON.stringify(events)).not.toContain('timingRows');
    expect(JSON.stringify(result)).not.toContain('timingRows');
  });
  it('success and failure telemetry observers cannot rerun work or reclassify scheduler truth', async () => {
    let successAsks = 0;
    let successTelemetry = 0;
    const success = await runTeam({
      steps: [{ id: 'success', neumaId: 'member', task: 'private success', needs: [] }],
      maxParallel: 1,
      buildMessages: () => [],
      ask: async () => { successAsks += 1; return 'successful output'; },
      schedule: { onTelemetry: () => { successTelemetry += 1; throw new Error('private success observer text'); } },
    });

    const original = new Error('original scheduler failure');
    let failureAsks = 0;
    let failureTelemetry = 0;
    const failure = runTeam({
      steps: [{ id: 'failure', neumaId: 'member', task: 'private failure', needs: [] }],
      maxParallel: 1,
      buildMessages: () => [],
      ask: async () => { failureAsks += 1; throw original; },
      schedule: { onTelemetry: () => { failureTelemetry += 1; return Promise.reject(new TypeError('private failure observer text')); } },
    });

    await expect(failure).rejects.toBe(original);
    await Promise.resolve();
    expect(success.results).toEqual({ success: 'successful output' });
    expect([successAsks, successTelemetry, failureAsks, failureTelemetry]).toEqual([1, 1, 1, 1]);
  });

});
