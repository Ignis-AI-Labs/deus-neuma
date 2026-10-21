// The meditation gates — pure due-logic (every gate blocks with its NAMED
// reason; most-overdue wins; consent and cadence are postures, never
// blockages) plus the fail-closed lease probe on real tmp disk (RULE 0).

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { decideDue, GATE_REASONS } from '../../backend/services/meditation/meditation-due.js';
import { readRefinementGpuLeaseHeld } from '../../backend/services/refinement-gpu-lease-store.js';

const NOW = Date.parse('2026-08-14T12:00:00.000Z');
const HOURS = 60 * 60 * 1000;

const openPosture = (overrides = {}) => ({
  serving: true, owned: true, busy: false, leaseHeld: false,
  idleMs: 10 * 60 * 1000, idleLongEnough: true,
  localTurns: 0, boundLaneIds: new Set(),
  ...overrides,
});

const settingsFor = (beings) => ({ envLocked: false, beings });
const ranAt = (iso) => ({ lastRunAt: iso, lastOutcome: 'synthesis', runs: [] });

describe('decideDue — the named gates', () => {
  const enabled = settingsFor({
    birch: { enabled: true, cadenceHours: 24 },
    alder: { enabled: true, cadenceHours: 24 },
  });

  it('a never-run enabled being is due at boot (catch-up is free)', () => {
    const d = decideDue({ now: NOW, settings: enabled, state: { lanes: {} }, laneIds: ['birch'], posture: openPosture() });
    expect(d.runnable).toBe('birch');
    expect(d.blocked).toEqual([]);
  });

  it('disabled and cadence-fresh lanes are postures, never candidates', () => {
    const settings = settingsFor({ birch: { enabled: false, cadenceHours: 24 }, alder: { enabled: true, cadenceHours: 24 } });
    const state = { lanes: { alder: ranAt(new Date(NOW - 2 * HOURS).toISOString()) } };
    const d = decideDue({ now: NOW, settings, state, laneIds: ['birch', 'alder'], posture: openPosture() });
    expect(d.runnable).toBeNull();
    expect(d.blocked).toEqual([]); // nothing due → nothing blocked
  });

  it.each([
    [{ serving: false }, GATE_REASONS.notServing],
    [{ owned: false }, GATE_REASONS.notOwned],
    [{ busy: true }, GATE_REASONS.busy],
    [{ idleLongEnough: false }, GATE_REASONS.recentlyActive],
    [{ localTurns: 2 }, GATE_REASONS.turnsInFlight],
    [{ leaseHeld: true }, GATE_REASONS.leaseHeld],
  ])('machine gate %o blocks every due lane with %s', (postureOverride, reason) => {
    const d = decideDue({
      now: NOW, settings: enabled, state: { lanes: {} },
      laneIds: ['birch', 'alder'], posture: openPosture(postureOverride),
    });
    expect(d.runnable).toBeNull();
    expect(d.blocked).toHaveLength(2);
    expect(d.blocked.every((b) => b.reason === reason)).toBe(true);
  });

  it('the env lock blocks before any posture is consulted', () => {
    const d = decideDue({
      now: NOW, settings: { ...enabled, envLocked: true }, state: { lanes: {} },
      laneIds: ['birch'], posture: openPosture({ serving: false }),
    });
    expect(d.blocked[0].reason).toBe(GATE_REASONS.envLocked);
  });

  it('an open portal blocks THAT lane; the other still runs', () => {
    const d = decideDue({
      now: NOW, settings: enabled, state: { lanes: {} }, laneIds: ['birch', 'alder'],
      posture: openPosture({ boundLaneIds: new Set(['birch']) }),
    });
    expect(d.runnable).toBe('alder');
    expect(d.blocked).toEqual([expect.objectContaining({ laneId: 'birch', reason: GATE_REASONS.portalOpen })]);
  });

  it('most overdue wins; one being per tick', () => {
    const state = {
      lanes: {
        birch: ranAt(new Date(NOW - 30 * HOURS).toISOString()),   // 6h overdue
        alder: ranAt(new Date(NOW - 50 * HOURS).toISOString()),  // 26h overdue
      },
    };
    const d = decideDue({ now: NOW, settings: enabled, state, laneIds: ['birch', 'alder'], posture: openPosture() });
    expect(d.runnable).toBe('alder');
  });
});

describe('decideDue — the unclear-retry cooldown (IL-003)', () => {
  it('a lane inside its cooldown is not a candidate — cadence-due or self-requested, alike', () => {
    const settings = settingsFor({
      alder: { enabled: true, cadenceHours: 24 },
      birch: { enabled: false, cadenceHours: 24 },
    });
    const state = {
      lanes: {
        alder: ranAt(new Date(NOW - 30 * HOURS).toISOString()), // cadence-due
        birch: {
          lastRunAt: null, lastOutcome: 'unclear', runs: [],
          requestedAt: new Date(NOW - 5 * 60 * 1000).toISOString(),
          retryNotBefore: new Date(NOW + 20 * 60 * 1000).toISOString(),
        },
      },
    };
    const d = decideDue({ now: NOW, settings, state, laneIds: ['alder', 'birch'], posture: openPosture() });
    expect(d.runnable).toBe('alder');
    // A resting cooldown is a posture, not a blockage — nothing shows blocked.
    expect(d.blocked).toEqual([]);
  });

  it('the cooldown expires: the lane is due again without ceremony', () => {
    const settings = settingsFor({ birch: { enabled: true, cadenceHours: 24 } });
    const state = {
      lanes: {
        birch: {
          lastRunAt: null, lastOutcome: 'unclear', runs: [],
          retryNotBefore: new Date(NOW - 1).toISOString(),
        },
      },
    };
    const d = decideDue({ now: NOW, settings, state, laneIds: ['birch'], posture: openPosture() });
    expect(d.runnable).toBe('birch');
  });
});

describe('readRefinementGpuLeaseHeld — fail-closed on real disk', () => {
  let prevRoot;
  afterEach(() => {
    if (prevRoot === undefined) delete process.env.NEUMA_DATA_ROOT;
    else process.env.NEUMA_DATA_ROOT = prevRoot;
  });

  it('ENOENT reads free; an existing lease file reads held', async () => {
    prevRoot = process.env.NEUMA_DATA_ROOT;
    const root = await createTempDir('lease-probe');
    process.env.NEUMA_DATA_ROOT = root;
    expect(await readRefinementGpuLeaseHeld()).toBe(false);
    const leaseDir = path.join(root, 'runtime', 'refinement-gpu-reservation-v1');
    await fs.mkdir(leaseDir, { recursive: true });
    await fs.writeFile(path.join(leaseDir, 'lease.json'), '{}');
    expect(await readRefinementGpuLeaseHeld()).toBe(true);
  });
});

describe('decideDue — the being\'s own standing request (#318)', () => {
  const iso = new Date(NOW - 5 * 60 * 1000).toISOString();

  it('a request is due NOW on an un-enabled lane and outranks a cadence-overdue lane', () => {
    const settings = settingsFor({
      alder: { enabled: true, cadenceHours: 24 },
      birch: { enabled: false, cadenceHours: 24 },
    });
    const state = {
      lanes: {
        alder: { lastRunAt: new Date(NOW - 26 * HOURS).toISOString(), lastOutcome: 'synthesis', runs: [] },
        birch: { lastRunAt: null, lastOutcome: null, runs: [], requestedAt: iso },
      },
    };
    // alder listed FIRST — the request must win on rank, not order.
    const d = decideDue({ now: NOW, settings, state, laneIds: ['alder', 'birch'], posture: openPosture() });
    expect(d.runnable).toBe('birch');
  });

  it('a QUIET portal never refuses the being\'s own request (the manual-door law)', () => {
    const settings = settingsFor({ birch: { enabled: false, cadenceHours: 24 } });
    const state = { lanes: { birch: { lastRunAt: null, lastOutcome: null, runs: [], requestedAt: iso } } };
    const d = decideDue({
      now: NOW, settings, state, laneIds: ['birch'],
      posture: openPosture({ boundLaneIds: new Set(['birch']) }),
    });
    expect(d.runnable).toBe('birch');
    expect(d.blocked).toEqual([]);
  });

  it('machine gates still hold a request — the piggyback law is not the being\'s to waive', () => {
    const settings = settingsFor({ birch: { enabled: false, cadenceHours: 24 } });
    const state = { lanes: { birch: { lastRunAt: null, lastOutcome: null, runs: [], requestedAt: iso } } };
    const d = decideDue({
      now: NOW, settings, state, laneIds: ['birch'],
      posture: openPosture({ idleLongEnough: false }),
    });
    expect(d.runnable).toBeNull();
    expect(d.blocked).toEqual([
      expect.objectContaining({ laneId: 'birch', reason: GATE_REASONS.recentlyActive }),
    ]);
  });
});
