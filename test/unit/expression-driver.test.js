// expression-driver.test.js — the expression driver proven on real vessels:
// real GLBs parsed through the real vessel loader, weights read back from the
// real three-vrm expressionManager. No mocks; time is simulated through
// update() deltas and the rng is injected for determinism.

import { describe, it, expect } from 'vitest';
import { vrm1Glb } from '../helpers/vessel-glb.js';
import { createVesselLoader } from '../../frontend/app/RelinkShell/vessel/vessel-loader.js';
import { createExpressionDriver } from '../../frontend/app/RelinkShell/vessel/expression-driver.js';
import { ARKIT_52, VRM_PRESETS_17, VISEME_PRESETS } from '../../frontend/app/RelinkShell/vessel/expression-map.js';

const loadVrm = async (glb) => {
  const gltf = await createVesselLoader().parseAsync(glb, '');
  return gltf.userData.vrm;
};

// KENORIE-shaped: both contract layers. Community-shaped: presets only.
const kenorieVessel = () => loadVrm(vrm1Glb({ presets: [...VRM_PRESETS_17], customs: [...ARKIT_52] }));
const communityVessel = () => loadVrm(vrm1Glb({
  licenseUrl: 'https://vrm.dev/licenses/1.0/',
  presets: [...VRM_PRESETS_17],
}));

/** Advance the driver in fixed steps; returns per-step max of watched names. */
const run = (driver, seconds, step = 0.05) => {
  for (let t = 0; t < seconds; t += step) driver.update(step);
};

describe('capability probe', () => {
  it('detects the ARKit-52 rich layer on a KENORIE-shaped vessel', async () => {
    const driver = createExpressionDriver(await kenorieVessel(), { rng: () => 0.5 });
    expect(driver.capabilities.hasArkit).toBe(true);
  });

  it('falls back on a presets-only community vessel', async () => {
    const driver = createExpressionDriver(await communityVessel(), { rng: () => 0.5 });
    expect(driver.capabilities.hasArkit).toBe(false);
  });

  it('returns null for a vessel with no expressions at all', async () => {
    const vrm = await loadVrm(vrm1Glb());
    expect(createExpressionDriver(vrm, { rng: () => 0.5 })).toBeNull();
  });
});

describe('emotion channel', () => {
  it('drives the ARKit rich layer on a KENORIE vessel (presets stay untouched)', async () => {
    const vrm = await kenorieVessel();
    const driver = createExpressionDriver(vrm, { rng: () => 0.9 });
    driver.setEmotion('joyful');
    run(driver, 1.5);
    expect(vrm.expressionManager.getValue('mouthSmileLeft')).toBeGreaterThan(0.5);
    expect(vrm.expressionManager.getValue('mouthSmileRight')).toBeGreaterThan(0.5);
    expect(vrm.expressionManager.getValue('happy')).toBe(0);
  });

  it('drives the preset fallback on a community vessel', async () => {
    const vrm = await communityVessel();
    const driver = createExpressionDriver(vrm, { rng: () => 0.9 });
    driver.setEmotion('joyful');
    run(driver, 1.5);
    expect(vrm.expressionManager.getValue('happy')).toBeGreaterThan(0.6);
  });

  it('decays back toward rest after the hold window', async () => {
    const vrm = await communityVessel();
    const driver = createExpressionDriver(vrm, { rng: () => 0.9 });
    driver.setEmotion('melancholic');
    run(driver, 1.5);
    expect(vrm.expressionManager.getValue('sad')).toBeGreaterThan(0.5);
    run(driver, 8);
    expect(vrm.expressionManager.getValue('sad')).toBeLessThan(0.05);
  });

  it('an unknown label clears the emotion instead of throwing', async () => {
    const vrm = await communityVessel();
    const driver = createExpressionDriver(vrm, { rng: () => 0.9 });
    driver.setEmotion('joyful');
    run(driver, 1);
    driver.setEmotion('not-an-emotion');
    run(driver, 2);
    expect(vrm.expressionManager.getValue('happy')).toBeLessThan(0.05);
  });
});

describe('speaking (viseme babble)', () => {
  it('cycles contract visemes while speaking and quiets after', async () => {
    const vrm = await kenorieVessel();
    const driver = createExpressionDriver(vrm, { rng: () => 0.9 });
    driver.setSpeaking(true);
    let peak = 0;
    for (let t = 0; t < 2; t += 0.05) {
      driver.update(0.05);
      for (const v of VISEME_PRESETS) {
        peak = Math.max(peak, vrm.expressionManager.getValue(v));
      }
    }
    expect(peak).toBeGreaterThan(0.3);

    driver.setSpeaking(false);
    run(driver, 1);
    for (const v of VISEME_PRESETS) {
      expect(vrm.expressionManager.getValue(v)).toBeLessThan(0.05);
    }
  });
});

describe('blink channel', () => {
  it('blinks autonomously and reopens (deterministic rng)', async () => {
    const vrm = await kenorieVessel();
    const driver = createExpressionDriver(vrm, { rng: () => 0.5 });
    // rng 0.5 → first blink at t=4s; watch 0..5s and find the closed peak
    let peak = 0;
    for (let t = 0; t < 5; t += 0.02) {
      driver.update(0.02);
      peak = Math.max(peak, vrm.expressionManager.getValue('blink'));
    }
    expect(peak).toBeGreaterThan(0.7);
    run(driver, 0.5, 0.02);
    expect(vrm.expressionManager.getValue('blink')).toBeLessThan(0.05);
  });
});

describe('gaze channel (look* presets, never vrm.lookAt)', () => {
  it('an explicit gaze drives the matching look preset', async () => {
    const vrm = await kenorieVessel();
    const driver = createExpressionDriver(vrm, { rng: () => 0.9 });
    driver.setGaze(1, 0);
    run(driver, 1.5);
    expect(vrm.expressionManager.getValue('lookRight')).toBeGreaterThan(0.7);
    expect(vrm.expressionManager.getValue('lookLeft')).toBeLessThan(0.05);
  });

  it('idle wander keeps gaze alive within subtle bounds', async () => {
    const vrm = await kenorieVessel();
    const driver = createExpressionDriver(vrm, { rng: () => 0.9 });
    let peak = 0;
    for (let t = 0; t < 20; t += 0.1) {
      driver.update(0.1);
      for (const name of ['lookLeft', 'lookRight', 'lookUp', 'lookDown']) {
        peak = Math.max(peak, vrm.expressionManager.getValue(name));
      }
    }
    expect(peak).toBeGreaterThan(0.05); // it moves
    expect(peak).toBeLessThan(0.5); // it stays subtle
  });

  it('clearGaze returns to the idle wander', async () => {
    const vrm = await kenorieVessel();
    const driver = createExpressionDriver(vrm, { rng: () => 0.9 });
    driver.setGaze(-1, 0);
    run(driver, 1.5);
    expect(vrm.expressionManager.getValue('lookLeft')).toBeGreaterThan(0.7);
    driver.clearGaze();
    run(driver, 2);
    expect(vrm.expressionManager.getValue('lookLeft')).toBeLessThan(0.5);
  });
});
