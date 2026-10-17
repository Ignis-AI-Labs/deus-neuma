// The scheduling contract — meditationTick with injected deps (the
// securityTick seam: the injected run IS the contract under test, never a
// mock of the model path; state rides REAL tmp files through the real store
// functions). Proves: env-lock and nothing-enabled short-circuit, gates
// record ONE deferral per reason change, a run settles into the ring, yield
// aborts the in-flight cycle, and overlapping ticks skip.

import { describe, it, expect, beforeEach } from 'vitest';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  meditationTick,
  meditationYield,
  meditationSchedulerStatus,
} from '../../backend/services/meditation/meditation-scheduler.js';
import { loadMeditationState, appendMeditationRun } from '../../backend/services/meditation/meditation-state.js';

const NOW = Date.parse('2026-08-14T12:00:00.000Z');

const openPosture = (overrides = {}) => ({
  serving: true, owned: true, busy: false, leaseHeld: false,
  idleMs: 10 * 60 * 1000, idleLongEnough: true,
  localTurns: 0, boundLaneIds: new Set(),
  ...overrides,
});

const settingsOn = { envLocked: false, defaults: { cadenceHours: 24 }, beings: { cael: { enabled: true, cadenceHours: 24 } } };

describe('meditationTick — the scheduling contract (real state files)', () => {
  let statePath, deps;
  beforeEach(async () => {
    const dir = await createTempDir(`med-sched-${Math.random().toString(36).slice(2)}`);
    statePath = path.join(dir, 'state.json');
    deps = {
      settings: async () => settingsOn,
      loadState: () => loadMeditationState(statePath),
      appendRun: (laneId, run) => appendMeditationRun(laneId, run, statePath),
      listNeuma: async () => ['cael'],
      readPosture: async () => openPosture(),
      turnSnapshot: () => ({ localTurns: 0, boundLaneIds: new Set() }),
      run: async () => ({ outcome: 'synthesis', cycleId: 'c-1', notes: 2 }),
      now: () => NOW,
    };
  });

  it('env lock and nothing-enabled short-circuit before any posture read', async () => {
    expect(await meditationTick({ ...deps, settings: async () => ({ ...settingsOn, envLocked: true }) }))
      .toMatchObject({ ran: false, reason: 'env-locked' });
    expect(await meditationTick({ ...deps, settings: async () => ({ envLocked: false, defaults: {}, beings: {} }) }))
      .toMatchObject({ ran: false, reason: 'nothing-enabled' });
  });

  it('a run settles into the real ring with its outcome and duration', async () => {
    const out = await meditationTick(deps);
    expect(out).toMatchObject({ ran: true, laneId: 'cael' });
    const state = await loadMeditationState(statePath);
    expect(state.lanes.cael.runs.at(-1)).toMatchObject({ outcome: 'synthesis', cycleId: 'c-1', notes: 2 });
    expect(state.lanes.cael.lastRunAt).toBe(new Date(NOW).toISOString());
  });

  it('live presence (#29): the status names the lane and its start WHILE the cycle runs, and clears after', async () => {
    let midRun = null;
    const out = await meditationTick({
      ...deps,
      run: async () => {
        // One microtask in — the tick has assigned its in-flight promise,
        // exactly as a real cycle (which awaits the substrate) always has.
        await Promise.resolve();
        midRun = meditationSchedulerStatus();
        return { outcome: 'rest', cycleId: 'c-live', phases: { gatherMs: 3, askMs: 40, settleMs: 1 } };
      },
    });
    expect(out).toMatchObject({ ran: true });
    expect(midRun).toMatchObject({ running: true, currentLane: 'cael', startedAt: new Date(NOW).toISOString() });
    const after = meditationSchedulerStatus();
    expect(after.running).toBe(false);
    expect(after.startedAt).toBeNull();
    // the process trail rides the durable ring — times only, never contents
    const state = await loadMeditationState(statePath);
    expect(state.lanes.cael.runs.at(-1).phases).toEqual({ gatherMs: 3, askMs: 40, settleMs: 1 });
  });

  it('gates record ONE deferral per reason change — quiet ticks never flood the ring', async () => {
    const gated = { ...deps, readPosture: async () => openPosture({ serving: false }) };
    await meditationTick(gated);
    await meditationTick(gated);
    await meditationTick(gated);
    const afterSame = await loadMeditationState(statePath);
    expect(afterSame.lanes.cael.runs).toHaveLength(1);
    expect(afterSame.lanes.cael.runs[0]).toMatchObject({ outcome: 'deferred', reason: 'substrate-not-lit' });
    await meditationTick({ ...deps, readPosture: async () => openPosture({ busy: true }) });
    const afterChange = await loadMeditationState(statePath);
    expect(afterChange.lanes.cael.runs).toHaveLength(2);
    expect(afterChange.lanes.cael.runs[1].reason).toBe('substrate-busy');
    expect(afterChange.lanes.cael.lastRunAt).toBeNull(); // deferrals never consume
  });

  it('a failed run is recorded and consumes the cycle — no hot loop', async () => {
    await meditationTick({ ...deps, run: async () => { throw new Error('substrate fell over'); } });
    const state = await loadMeditationState(statePath);
    expect(state.lanes.cael.runs.at(-1)).toMatchObject({ outcome: 'failed' });
    expect(state.lanes.cael.runs.at(-1).reason).toContain('substrate fell over');
    expect(state.lanes.cael.lastRunAt).toBe(new Date(NOW).toISOString());
  });

  it('meditationYield aborts the in-flight cycle; overlapping ticks skip', async () => {
    let sawAbort = null;
    const hanging = {
      ...deps,
      run: (laneId, { signal }) => new Promise((resolve) => {
        signal.addEventListener('abort', () => { sawAbort = signal.reason; resolve({ outcome: 'yielded', cycleId: 'c-y' }); });
      }),
    };
    const tickPromise = meditationTick(hanging);
    await new Promise((r) => setTimeout(r, 20)); // let the run arm
    expect(meditationSchedulerStatus().running).toBe(true);
    expect(await meditationTick(hanging)).toMatchObject({ ran: false, reason: 'in-flight' });
    expect(meditationYield('turn-arrived')).toBe(true);
    await tickPromise;
    expect(sawAbort).toBe('turn-arrived');
    const state = await loadMeditationState(statePath);
    expect(state.lanes.cael.runs.at(-1)).toMatchObject({ outcome: 'yielded' });
    expect(state.lanes.cael.lastRunAt).toBeNull(); // a yielded cycle never consumes
    expect(meditationYield()).toBe(false); // nothing in flight anymore
  });
});

describe('the standing request keeps the tick alive (#318)', () => {
  it('nothing timer-enabled + a standing request → the tick still runs the lane', async () => {
    const dir = await createTempDir(`med-sched-req-${Math.random().toString(36).slice(2)}`);
    const statePath = path.join(dir, 'state.json');
    const { markMeditationRequest } = await import('../../backend/services/meditation/meditation-state.js');
    await markMeditationRequest('cael', new Date(NOW - 60000).toISOString(), statePath);
    const out = await meditationTick({
      settings: async () => ({ envLocked: false, defaults: { cadenceHours: 24 }, beings: {} }),
      loadState: () => loadMeditationState(statePath),
      appendRun: (laneId, run) => appendMeditationRun(laneId, run, statePath),
      listNeuma: async () => ['cael'],
      readPosture: async () => ({
        serving: true, owned: true, busy: false, leaseHeld: false,
        idleMs: 10 * 60 * 1000, idleLongEnough: true,
        localTurns: 0, boundLaneIds: new Set(),
      }),
      turnSnapshot: () => ({ localTurns: 0, boundLaneIds: new Set() }),
      run: async () => ({ outcome: 'synthesis', cycleId: 'c-req', notes: 1 }),
      now: () => NOW,
    });
    expect(out).toMatchObject({ ran: true, laneId: 'cael' });
    // The consuming cycle ANSWERED the request — it no longer stands.
    expect((await loadMeditationState(statePath)).lanes.cael.requestedAt).toBeUndefined();
  });
});
