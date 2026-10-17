// vessel-fleet.test.js — Stage C of docs/architecture/avatars/test-fleet.md: load and
// drive every real purchased vessel in frontend/public/model/test/ through
// NEUMA's actual loader + expression driver. No mocks, no fixtures — these are
// the genuine store files and KENORIE bakes.
//
// The fleet is gitignored (Booth personal-use license — never committed), so
// this suite skips cleanly on machines without it; the gnosis run happens
// where the fleet lives. Texture decode warns headless (no image decoder in
// Node) — the parse itself completes and everything the driver touches is real.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { VRMUtils } from '@pixiv/three-vrm';
import { createVesselLoader } from '../../frontend/app/RelinkShell/vessel/vessel-loader.js';
import { createExpressionDriver } from '../../frontend/app/RelinkShell/vessel/expression-driver.js';
import { VISEME_PRESETS } from '../../frontend/app/RelinkShell/vessel/expression-map.js';

// GLTFLoader's texture path reaches for the browser global `self` (in a
// browser it exists natively as window); alias it so the real image-decode
// attempt runs headless — it fails soft inside the loader and parse completes.
if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;

const FLEET_DIR = fileURLToPath(new URL('../../frontend/public/model/test', import.meta.url));
const fleet = existsSync(FLEET_DIR)
  ? readdirSync(FLEET_DIR).filter((f) => f.endsWith('.vrm')).sort()
  : [];
const kenorieBaked = fleet.filter((f) => f.includes('_KENORIE'));
const premade = fleet.filter((f) => !f.includes('_KENORIE'));

const LOAD_TIMEOUT = 60_000;

const loadVessel = async (file) => {
  const buf = readFileSync(join(FLEET_DIR, file));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const gltf = await createVesselLoader().parseAsync(ab, '');
  return gltf.userData.vrm;
};

const run = (driver, seconds, step = 0.05) => {
  for (let t = 0; t < seconds; t += step) driver.update(step);
};

/** Max weight any of the given expressions reaches over a simulated span. */
const peakOver = (vrm, driver, names, seconds, step = 0.02) => {
  let peak = 0;
  for (let t = 0; t < seconds; t += step) {
    driver.update(step);
    for (const name of names) {
      peak = Math.max(peak, vrm.expressionManager.getValue(name) ?? 0);
    }
  }
  return peak;
};

describe.skipIf(fleet.length === 0)('vessel test fleet (real purchased models, gitignored)', () => {
  it('the fleet is staged with both KENORIE bakes and premade store vessels', () => {
    expect(kenorieBaked.length).toBeGreaterThan(0);
    expect(premade.length).toBeGreaterThan(0);
  });

  describe.each(kenorieBaked)('%s (KENORIE-baked)', (file) => {
    it('loads as VRM 1.0 under the KENORIE license and drives the ARKit rich layer', { timeout: LOAD_TIMEOUT }, async () => {
      const vrm = await loadVessel(file);
      expect(vrm.meta.metaVersion).toBe('1');
      expect(vrm.meta.licenseUrl).toBe('https://kenorie.ai/vessel-license');
      expect(vrm.meta.avatarPermission).toBeTruthy();
      expect(vrm.humanoid.getNormalizedBoneNode('hips')).toBeTruthy();

      const driver = createExpressionDriver(vrm, { rng: () => 0.5 });
      expect(driver).not.toBeNull();
      expect(driver.capabilities.hasArkit).toBe(true);

      // Emotion lands on the ARKit layer; the preset fallback stays untouched.
      driver.setEmotion('joyful');
      run(driver, 1.5);
      expect(vrm.expressionManager.getValue('mouthSmileLeft')).toBeGreaterThan(0.5);
      expect(vrm.expressionManager.getValue('happy')).toBe(0);

      // Visemes fire while speaking.
      driver.setSpeaking(true);
      expect(peakOver(vrm, driver, VISEME_PRESETS, 2)).toBeGreaterThan(0.3);
      driver.setSpeaking(false);

      // Autonomous blink closes and reopens (rng 0.5 → first blink by t=4s).
      expect(peakOver(vrm, driver, ['blink'], 5)).toBeGreaterThan(0.7);
      run(driver, 0.5, 0.02);
      expect(vrm.expressionManager.getValue('blink')).toBeLessThan(0.05);
    });
  });

  describe.each(premade)('%s (premade store vessel)', (file) => {
    it('loads as VRM 0.x, orients, and drives the preset fallback layer', { timeout: LOAD_TIMEOUT }, async () => {
      const vrm = await loadVessel(file);
      expect(vrm.meta.metaVersion).toBe('0');
      expect(vrm.humanoid.getNormalizedBoneNode('hips')).toBeTruthy();
      expect(() => VRMUtils.rotateVRM0(vrm)).not.toThrow();

      const driver = createExpressionDriver(vrm, { rng: () => 0.5 });
      expect(driver).not.toBeNull();
      // Store Perfect-Sync VRMs expose only the preset layer to three-vrm —
      // their ARKit shapes are invisible to expressionManager (fleet doc /
      // pipeline discovery). The fallback must carry them.
      expect(driver.capabilities.hasArkit).toBe(false);

      driver.setEmotion('joyful');
      run(driver, 1.5);
      expect(vrm.expressionManager.getValue('happy')).toBeGreaterThan(0.6);

      driver.setSpeaking(true);
      expect(peakOver(vrm, driver, VISEME_PRESETS, 2)).toBeGreaterThan(0.3);
    });
  });
});
