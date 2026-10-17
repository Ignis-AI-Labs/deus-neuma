// Real durable state -> production due decision and pure React presentation.
// No model cycle is simulated or run; this proves scheduling and rendering.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { appendMeditationRun, loadMeditationState, markMeditationRequest } from '../../backend/services/meditation/meditation-state.js';
import { decideDue } from '../../backend/services/meditation/meditation-due.js';
import { MeditationRetry } from '../../frontend/app/RelinkShell/MeditationRetry.jsx';

const START = Date.parse('2026-09-10T00:00:00Z');
const HOUR = 3600000;
const RETRY = START + 1.5 * HOUR;
const iso = (ms) => new Date(ms).toISOString();
const settings = { envLocked: false, beings: { lane: { enabled: true, cadenceHours: 6 } } };
const posture = {
  serving: true, owned: true, busy: false, idleLongEnough: true,
  localTurns: 0, leaseHeld: false, boundLaneIds: new Set(),
};
let root, file;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'meditation-retry-'));
  file = path.join(root, 'state.json');
  await appendMeditationRun('lane', { at: iso(START), outcome: 'synthesis' }, file);
  await appendMeditationRun('lane', { at: iso(START + HOUR / 2), outcome: 'unclear' }, file);
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
const decision = async (now = RETRY, overrides = {}) => decideDue({
  now, settings, state: await loadMeditationState(file), laneIds: ['lane'], posture, ...overrides,
});
const rendered = async (now, props = {}) => renderToStaticMarkup(createElement(MeditationRetry, {
  lane: (await loadMeditationState(file)).lanes.lane, enabled: true, now, ...props,
}));

describe('unclear retry after a recent successful cycle', () => {
  it('is due at the exact cooldown boundary without consuming the old cursor', async () => {
    expect((await decision(RETRY - 1)).runnable).toBeNull();
    expect((await decision()).runnable).toBe('lane');
    expect((await decision(RETRY + 1)).runnable).toBe('lane');
    expect((await loadMeditationState(file)).lanes.lane.lastRunAt).toBe(iso(START));
  });
  it('keeps timer-disabled lanes off and honors their standing request after cooldown', async () => {
    const disabled = { ...settings, beings: { lane: { enabled: false, cadenceHours: 6 } } };
    expect((await decision(RETRY, { settings: disabled })).runnable).toBeNull();
    await markMeditationRequest('lane', iso(START + HOUR / 2), file);
    expect((await decision(RETRY - 1, { settings: disabled })).runnable).toBeNull();
    expect((await decision(RETRY, { settings: disabled })).runnable).toBe('lane');
  });
  it.each([
    [{ serving: false }, 'substrate-not-lit'], [{ owned: false }, 'substrate-not-ours'],
    [{ busy: true }, 'substrate-busy'], [{ idleLongEnough: false }, 'substrate-recently-active'],
    [{ localTurns: 1 }, 'turns-in-flight'], [{ leaseHeld: true }, 'training-lease-held'],
    [{ boundLaneIds: new Set(['lane']) }, 'portal-open'],
  ])('retains gate %s', async (change, reason) => {
    const result = await decision(RETRY, { posture: { ...posture, ...change } });
    expect(result.runnable).toBeNull();
    expect(result.blocked).toEqual([{ laneId: 'lane', reason, overdueMs: 0 }]);
  });
  it('retains the environment lock', async () => {
    expect((await decision(RETRY, { settings: { ...settings, envLocked: true } })).blocked[0].reason).toBe('env-locked');
  });
  it('a later consuming outcome clears the retry and restores the cadence', async () => {
    await appendMeditationRun('lane', { at: iso(RETRY), outcome: 'rest' }, file);
    expect((await decision(RETRY + HOUR)).runnable).toBeNull();
    expect((await decision(RETRY + 6 * HOUR)).runnable).toBe('lane');
    expect((await loadMeditationState(file)).lanes.lane.retryNotBefore).toBeUndefined();
  });
  it('invalid retry timestamps do not override a fresh cadence', async () => {
    const state = await loadMeditationState(file);
    state.lanes.lane.retryNotBefore = 'invalid';
    expect((await decision(RETRY, { state })).runnable).toBeNull();
  });
  it('renders remaining time and eligibility without promising immediate execution', async () => {
    expect(await rendered(START + HOUR / 2)).toContain('retry eligible in about 60 minutes');
    expect(await rendered(RETRY - 1)).toContain('retry eligible in about 1 minute');
    expect(await rendered(RETRY)).toContain('retry eligible at the next quiet opportunity');
    expect(await rendered(RETRY, { enabled: false })).toContain('retry paused while the timer is off');
    expect(await rendered(RETRY, { envLocked: true })).toContain('retry paused by the operator');
    await markMeditationRequest('lane', iso(START + HOUR / 2), file);
    expect(await rendered(RETRY, { enabled: false })).toContain('retry eligible at the next quiet opportunity');
  });
  it('does not display a stale retry during a cycle or after it settles', async () => {
    expect(await rendered(RETRY, { running: true })).toBe('');
    await appendMeditationRun('lane', { at: iso(RETRY), outcome: 'rest' }, file);
    expect(await rendered(RETRY)).toBe('');
  });
});
