// vessel-loader.test.js — real-stack proof for the KENORIE license accept-list
// (docs/architecture/avatars/consumer-contract.md, integration item 1).
//
// No mocks: each case builds a real VRM binary (GLB with the VRMC_vrm or VRM
// extension) and parses it through the real GLTFLoader + three-vrm plugin
// chain — the exact path use-vrm-stage.js travels in production.

import { describe, it, expect } from 'vitest';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import { vrm1Glb, vrm0Glb, KENORIE_LICENSE } from '../helpers/vessel-glb.js';
import {
  createVesselLoader,
  ACCEPTED_VESSEL_LICENSE_URLS,
} from '../../frontend/app/RelinkShell/vessel/vessel-loader.js';

describe('vessel-loader (real GLTFLoader + three-vrm, no mocks)', () => {
  it('a bare VRMLoaderPlugin rejects a KENORIE-licensed vessel (the defect this module fixes)', async () => {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    await expect(loader.parseAsync(vrm1Glb(), ''))
      .rejects.toThrow(/license url .* is not accepted/);
  });

  it('createVesselLoader loads a KENORIE-baked vessel and surfaces its consent meta', async () => {
    const gltf = await createVesselLoader().parseAsync(vrm1Glb(), '');
    const vrm = gltf.userData.vrm;
    expect(vrm).toBeDefined();
    expect(vrm.meta.metaVersion).toBe('1');
    expect(vrm.meta.licenseUrl).toBe(KENORIE_LICENSE);
    expect(vrm.meta.avatarPermission).toBe('onlyAuthor');
    expect(vrm.meta.commercialUsage).toBe('personalNonProfit');
    expect(vrm.meta.modification).toBe('prohibited');
    expect(vrm.meta.allowRedistribution).toBe(false);
    expect(vrm.humanoid.getNormalizedBoneNode('hips')).toBeTruthy();
  });

  it('createVesselLoader still accepts the standard vrm.dev 1.0 license', async () => {
    const gltf = await createVesselLoader()
      .parseAsync(vrm1Glb({ licenseUrl: 'https://vrm.dev/licenses/1.0/' }), '');
    expect(gltf.userData.vrm).toBeDefined();
  });

  it('createVesselLoader rejects a VRM 1.0 vessel with an unknown license', async () => {
    await expect(createVesselLoader().parseAsync(vrm1Glb({ licenseUrl: 'https://example.com/not-a-license' }), ''))
      .rejects.toThrow(/license url .* is not accepted/);
  });

  it('createVesselLoader still loads VRM 0.x community vessels (license gate is 1.0-only)', async () => {
    const gltf = await createVesselLoader().parseAsync(vrm0Glb(), '');
    const vrm = gltf.userData.vrm;
    expect(vrm).toBeDefined();
    expect(vrm.meta.metaVersion).toBe('0');
    expect(vrm.humanoid.getNormalizedBoneNode('hips')).toBeTruthy();
  });

  it('the accept-list is exactly the two contract URLs, frozen', () => {
    expect(ACCEPTED_VESSEL_LICENSE_URLS).toEqual([
      KENORIE_LICENSE,
      'https://vrm.dev/licenses/1.0/',
    ]);
    expect(Object.isFrozen(ACCEPTED_VESSEL_LICENSE_URLS)).toBe(true);
  });
});
