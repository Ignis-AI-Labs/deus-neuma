// STANDBY — the substrate's rest as a visible, reversible switch.
//
// The behavior it governs used to run from an unset env var: the code default
// of 15 minutes SIGTERM'd a substrate the operator had deliberately ignited,
// with nothing on screen to explain it (Design note, 2026-07-26. These prove the
// precedence rule and that a torn record never silently changes the posture.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  createStandbySettings, resolveStandby, DEFAULT_IDLE_MINUTES,
} from '../../backend/services/standby-settings.js';
import { startIdleMonitor, markActivity } from '../../backend/services/substrate-idle.js';

describe('resolveStandby — the precedence rule, in one place', () => {
  it('defaults ON when nothing is persisted and no env is set', () => {
    // Founder: […].
    expect(resolveStandby(null, null)).toEqual({
      enabled: true, idleMinutes: DEFAULT_IDLE_MINUTES, envLocked: false,
    });
  });

  it('env 0 holds it OFF and LOCKED — a launch policy is not undone from the desk', () => {
    // Same law as the web-access kill switch: what the operator set at launch
    // wins over a runtime toggle.
    expect(resolveStandby({ enabled: true, idleMinutes: 15 }, 0)).toEqual({
      enabled: false, idleMinutes: 0, envLocked: true,
    });
  });

  it('a positive env seeds the window when nothing is persisted', () => {
    expect(resolveStandby(null, 45)).toEqual({
      enabled: true, idleMinutes: 45, envLocked: false,
    });
  });

  it('a persisted choice wins over the env default', () => {
    expect(resolveStandby({ enabled: false, idleMinutes: 30 }, 45)).toEqual({
      enabled: false, idleMinutes: 30, envLocked: false,
    });
  });

  it('a torn record rests at the default posture rather than disabling silently', () => {
    // Only an explicit `false` turns rest off — a half-written file must not
    // quietly pin a 96GB card.
    expect(resolveStandby({}, null).enabled).toBe(true);
    expect(resolveStandby({ idleMinutes: 0 }, null).idleMinutes).toBe(DEFAULT_IDLE_MINUTES);
    expect(resolveStandby({ idleMinutes: -5 }, null).idleMinutes).toBe(DEFAULT_IDLE_MINUTES);
    expect(resolveStandby('nonsense', null).enabled).toBe(true);
  });
});

describe('standby settings on real disk', () => {
  let dir, settings;

  beforeEach(async () => {
    dir = await createTempDir('standby');
    settings = createStandbySettings({ path: path.join(dir, 'standby.json'), envMinutes: () => null });
  });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('an absent file reads as the default posture', async () => {
    expect(await settings.read()).toEqual({
      enabled: true, idleMinutes: DEFAULT_IDLE_MINUTES, envLocked: false,
    });
  });

  it('a choice survives a restart', async () => {
    await settings.setEnabled(false);
    const reread = createStandbySettings({ path: path.join(dir, 'standby.json'), envMinutes: () => null });
    expect((await reread.read()).enabled).toBe(false);
  });

  it('idleMs is the live answer the monitor asks for', async () => {
    expect(await settings.idleMs()).toBe(DEFAULT_IDLE_MINUTES * 60000);
    await settings.setEnabled(false);
    expect(await settings.idleMs()).toBe(0); // off = nothing rests
    await settings.setEnabled(true, 30);
    expect(await settings.idleMs()).toBe(30 * 60000);
  });

  it('refuses to move while the env holds it off — never a switch that lies', async () => {
    const locked = createStandbySettings({ path: path.join(dir, 'standby.json'), envMinutes: () => 0 });
    await expect(locked.setEnabled(true)).rejects.toThrow(/SUBSTRATE_IDLE_MINUTES=0/);
  });
});

describe('the monitor honors a LIVE standby window', () => {
  // The whole point of the switch: flipping it lands on the next tick, not the
  // next restart.
  const tick = () => new Promise((r) => setTimeout(r, 30));

  it('rests nothing while standby is off, then rests once it is turned on', async () => {
    let window = 0; // standby OFF
    const unloads = [];
    markActivity();
    const stop = startIdleMonitor({
      idleMs: 0,
      intervalMs: 10,
      resolveIdleMs: async () => window,
      check: async () => ({ serving: true, owned: true, busy: false }),
      unload: async () => { unloads.push(Date.now()); },
    });
    await tick();
    expect(unloads).toHaveLength(0); // off — the substrate stays resident

    window = 1; // 1ms window: anything idle at all qualifies
    await tick();
    stop();
    expect(unloads.length).toBeGreaterThan(0); // turned on WITHOUT a restart
  });

  it('a resolver that throws leaves the substrate resident', async () => {
    // Rest is the reversible act; a broken read must never unload.
    const unloads = [];
    markActivity();
    const stop = startIdleMonitor({
      idleMs: 0,
      intervalMs: 10,
      resolveIdleMs: async () => { throw new Error('settings unreadable'); },
      check: async () => ({ serving: true, owned: true, busy: false }),
      unload: async () => { unloads.push(1); },
    });
    await tick();
    stop();
    expect(unloads).toHaveLength(0);
  });

  it('never rests a substrate mid-generation, however long the window', async () => {
    const unloads = [];
    markActivity();
    const stop = startIdleMonitor({
      idleMs: 0,
      intervalMs: 10,
      resolveIdleMs: async () => 1,
      check: async () => ({ serving: true, owned: true, busy: true }), // a turn is running
      unload: async () => { unloads.push(1); },
    });
    await tick();
    stop();
    expect(unloads).toHaveLength(0);
  });

  it('without a resolver, the old boot-time behavior is untouched', () => {
    // Every existing caller and test keeps its contract.
    const stop = startIdleMonitor({
      idleMs: 0, intervalMs: 10, check: async () => ({}), unload: async () => {},
    });
    expect(typeof stop).toBe('function');
    stop();
  });
});
