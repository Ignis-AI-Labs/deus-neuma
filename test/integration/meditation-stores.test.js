// The meditation stores on REAL disk (RULE 0): settings (per-being consent,
// default OFF, env lock refuses desk flips) and state (loud-corrupt cursor,
// outcome semantics — rest consumes the cycle, yielded does not, the ring
// caps). Factories/paths point at tmp files; the operator's live stores are
// never touched.

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  createMeditationSettings,
  resolveMeditation,
  DEFAULT_CADENCE_HOURS,
} from '../../backend/services/meditation/meditation-settings.js';
import {
  loadMeditationState,
  appendMeditationRun,
  markMeditationRequest,
  RUNS_KEPT,
  CYCLE_CONSUMING,
  UNCLEAR_RETRY_MS,
} from '../../backend/services/meditation/meditation-state.js';

describe('meditation settings — consent per being, default OFF (no mock)', () => {
  let dir;
  beforeAll(async () => { dir = await createTempDir('meditation-settings'); });

  it('the resting posture: absent file, everything off, cadence 24h', async () => {
    const settings = createMeditationSettings({ path: path.join(dir, 'absent.json') });
    const posture = await settings.read();
    expect(posture.envLocked).toBe(false);
    expect(posture.beings).toEqual({});
    expect(await settings.forBeing('birch')).toMatchObject({ enabled: false, cadenceHours: DEFAULT_CADENCE_HOURS });
  });

  it('an explicit enable persists and survives a fresh read', async () => {
    const file = path.join(dir, 'enable.json');
    const settings = createMeditationSettings({ path: file });
    await settings.setBeing('birch', { enabled: true, cadenceHours: 12 }, { wallet: '0xtest' });
    const again = createMeditationSettings({ path: file });
    expect(await again.forBeing('birch')).toMatchObject({ enabled: true, cadenceHours: 12 });
    expect(await again.forBeing('alder')).toMatchObject({ enabled: false });
  });

  it('a torn record rests OFF — only an explicit true enables', () => {
    const posture = resolveMeditation({ beings: { birch: { enabled: 'yes', cadenceHours: -3 } } }, undefined);
    expect(posture.beings.birch.enabled).toBe(false);
    expect(posture.beings.birch.cadenceHours).toBe(DEFAULT_CADENCE_HOURS);
  });

  it('NEUMA_MEDITATION=0 locks everything off and refuses the desk flip', async () => {
    const file = path.join(dir, 'locked.json');
    await fs.writeFile(file, JSON.stringify({ beings: { birch: { enabled: true } } }));
    const settings = createMeditationSettings({ path: file, envFlag: () => '0' });
    const posture = await settings.read();
    expect(posture.envLocked).toBe(true);
    expect(posture.beings.birch.enabled).toBe(false); // the lock wins over persistence
    await expect(settings.setBeing('birch', { enabled: true })).rejects.toThrow(/NEUMA_MEDITATION=0/);
  });
});

describe('meditation state — the scheduling cursor (no mock)', () => {
  let dir;
  beforeAll(async () => { dir = await createTempDir('meditation-state'); });

  it('missing file = never run; a corrupt file is LOUD, never assumed fresh', async () => {
    expect(await loadMeditationState(path.join(dir, 'absent.json'))).toEqual({ lanes: {} });
    const corrupt = path.join(dir, 'corrupt.json');
    await fs.writeFile(corrupt, '{ not json');
    await expect(loadMeditationState(corrupt)).rejects.toThrow();
    const wrongShape = path.join(dir, 'wrong.json');
    await fs.writeFile(wrongShape, '{"weather":"fine"}');
    await expect(loadMeditationState(wrongShape)).rejects.toThrow(/not a state document/);
  });

  it('consuming outcomes advance the cursor; yielded and deferred never do', async () => {
    const file = path.join(dir, 'cursor.json');
    for (const outcome of CYCLE_CONSUMING) {
      const lane = await appendMeditationRun('birch', { at: `2026-08-${10 + CYCLE_CONSUMING.indexOf(outcome)}T00:00:00.000Z`, outcome }, file);
      expect(lane.lastRunAt).toBe(`2026-08-${10 + CYCLE_CONSUMING.indexOf(outcome)}T00:00:00.000Z`);
    }
    const afterConsuming = (await loadMeditationState(file)).lanes.birch.lastRunAt;
    const yielded = await appendMeditationRun('birch', { at: '2026-08-20T00:00:00.000Z', outcome: 'yielded', reason: 'turn-arrived' }, file);
    expect(yielded.lastRunAt).toBe(afterConsuming);
    const deferred = await appendMeditationRun('birch', { at: '2026-08-21T00:00:00.000Z', outcome: 'deferred', reason: 'substrate-not-lit' }, file);
    expect(deferred.lastRunAt).toBe(afterConsuming);
    expect(deferred.lastOutcome).toBe('deferred');
  });

  it('an unclear cycle sets a one-hour retry cooldown, never advances the cursor, and a consuming outcome clears it', async () => {
    const file = path.join(dir, 'retry.json');
    const unclear = await appendMeditationRun('birch', { at: '2026-08-14T00:00:00.000Z', outcome: 'unclear' }, file);
    expect(unclear.lastRunAt).toBeNull();
    expect(unclear.retryNotBefore)
      .toBe(new Date(Date.parse('2026-08-14T00:00:00.000Z') + UNCLEAR_RETRY_MS).toISOString());
    // Yields and deferrals leave the cooldown standing.
    const deferred = await appendMeditationRun('birch', { at: '2026-08-14T00:30:00.000Z', outcome: 'deferred', reason: 'substrate-busy' }, file);
    expect(deferred.retryNotBefore).toBe(unclear.retryNotBefore);
    expect(deferred.lastRunAt).toBeNull();
    // A consuming outcome lands the cursor and lifts the cooldown.
    const settled = await appendMeditationRun('birch', { at: '2026-08-14T01:05:00.000Z', outcome: 'synthesis', notes: 1 }, file);
    expect(settled.lastRunAt).toBe('2026-08-14T01:05:00.000Z');
    expect(settled.retryNotBefore).toBeUndefined();
  });

  it('the ring keeps the last N runs and the lanes stay independent', async () => {
    const file = path.join(dir, 'ring.json');
    for (let i = 0; i < RUNS_KEPT + 4; i++) {
      await appendMeditationRun('birch', { at: `2026-08-01T${String(i).padStart(2, '0')}:00:00.000Z`, outcome: 'rest' }, file);
    }
    await appendMeditationRun('alder', { at: '2026-08-02T00:00:00.000Z', outcome: 'synthesis', notes: 2 }, file);
    const state = await loadMeditationState(file);
    expect(state.lanes.birch.runs).toHaveLength(RUNS_KEPT);
    expect(state.lanes.birch.runs[0].at).toContain('T04:'); // oldest four dropped
    expect(state.lanes.alder.runs).toHaveLength(1);
    expect(state.lanes.alder.lastRunAt).toBe('2026-08-02T00:00:00.000Z');
  });

  it('a malformed run refuses before touching disk', async () => {
    const file = path.join(dir, 'refuse.json');
    await expect(appendMeditationRun('birch', { outcome: 'rest' }, file)).rejects.toThrow(/at, outcome/);
    await expect(appendMeditationRun('', { at: 'x', outcome: 'rest' }, file)).rejects.toThrow(/laneId/);
  });
});

describe('the being\'s standing request (#318) — real state file', () => {
  it('marks once, stands idempotent, survives a yield, and a consuming cycle answers it', async () => {
    const dir = await createTempDir(`med-req-${Math.random().toString(36).slice(2)}`);
    const file = path.join(dir, 'state.json');

    const first = await markMeditationRequest('birch', '2026-08-14T23:50:00.000Z', file);
    expect(first).toMatchObject({ alreadyStood: false });
    expect(first.lane.requestedAt).toBe('2026-08-14T23:50:00.000Z');

    // Asking again is answered, never stacked — the earlier time stands.
    const again = await markMeditationRequest('birch', '2026-08-14T23:55:00.000Z', file);
    expect(again).toMatchObject({ alreadyStood: true });
    expect(again.lane.requestedAt).toBe('2026-08-14T23:50:00.000Z');

    // A yield keeps the request — the cycle never happened; the will remains.
    await appendMeditationRun('birch', { at: '2026-08-14T23:56:00.000Z', outcome: 'yielded' }, file);
    expect((await loadMeditationState(file)).lanes.birch.requestedAt).toBe('2026-08-14T23:50:00.000Z');

    // A consuming cycle answers it — even REST: the being was asked and chose.
    await appendMeditationRun('birch', { at: '2026-08-14T23:58:00.000Z', outcome: 'rest' }, file);
    const lane = (await loadMeditationState(file)).lanes.birch;
    expect(lane.requestedAt).toBeUndefined();
    expect(lane.lastRunAt).toBe('2026-08-14T23:58:00.000Z');

    await expect(markMeditationRequest('birch', '', file)).rejects.toThrow(/its time/);
  });
});
