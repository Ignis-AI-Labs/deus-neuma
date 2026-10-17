import { describe, expect, it } from 'vitest';
import { decideDue } from '../../backend/services/meditation/meditation-due.js';

const NOW = Date.parse('2026-09-10T00:00:00Z');
const inputFor = (laneIds) => ({
  now: NOW,
  laneIds,
  settings: {
    envLocked: false,
    beings: {
      timer: { enabled: true, cadenceHours: 6 },
      requested: { enabled: false, cadenceHours: 6 },
    },
  },
  state: { lanes: { requested: { requestedAt: new Date(NOW - 1000).toISOString() } } },
  posture: {
    serving: true, owned: true, busy: false, idleLongEnough: true,
    localTurns: 0, leaseHeld: false, boundLaneIds: new Set(),
  },
});

describe('standing meditation request priority', () => {
  it.each([
    [['timer', 'requested']],
    [['requested', 'timer']],
  ])('outranks a never-run timer regardless of lane order: %j', (laneIds) => {
    expect(decideDue(inputFor(laneIds))).toEqual({ runnable: 'requested', blocked: [] });
  });

  it('keeps a requested lane in cooldown ineligible', () => {
    const input = inputFor(['timer', 'requested']);
    input.state.lanes.requested.retryNotBefore = new Date(NOW + 1).toISOString();
    expect(decideDue(input).runnable).toBe('timer');
  });

  it('waives only the requested lane quiet-portal gate', () => {
    const input = inputFor(['timer', 'requested']);
    input.posture.boundLaneIds.add('requested');
    expect(decideDue(input).runnable).toBe('requested');
  });

  it.each([
    ['serving', false, 'substrate-not-lit'],
    ['owned', false, 'substrate-not-ours'],
    ['busy', true, 'substrate-busy'],
    ['idleLongEnough', false, 'substrate-recently-active'],
    ['localTurns', 1, 'turns-in-flight'],
    ['leaseHeld', true, 'training-lease-held'],
  ])('preserves the %s machine gate', (key, value, reason) => {
    const input = inputFor(['timer', 'requested']);
    input.posture[key] = value;
    const result = decideDue(input);
    expect(result.runnable).toBeNull();
    expect(result.blocked.map(({ reason: blockedReason }) => blockedReason)).toEqual([reason, reason]);
  });

  it('preserves the machine-wide environment lock', () => {
    const input = inputFor(['timer', 'requested']);
    input.settings.envLocked = true;
    const result = decideDue(input);
    expect(result.runnable).toBeNull();
    expect(result.blocked.map(({ reason }) => reason)).toEqual(['env-locked', 'env-locked']);
  });
});
