// vessel-loader.js — the GLTFLoader every vessel loads through.
//
// UNAVIS-baked vessels (baked under the former KENORIE name) carry
// `licenseUrl: "https://kenorie.ai/vessel-license"` — a URL fixed into every
// shipped VRM, so it stays accepted whatever the platform is called now
// (docs/architecture/avatars/consumer-contract.md, integration item 1). three-vrm's
// VRMMetaLoaderPlugin gates VRM 1.0 metas against an accept-list whose default
// is only the vrm.dev 1.0 license, so a bare VRMLoaderPlugin rejects every
// such vessel at load. The gate does not apply to VRM 0.x metas —
// community vessels keep loading through acceptV0Meta (default true).

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMMetaLoaderPlugin } from '@pixiv/three-vrm';

export const ACCEPTED_VESSEL_LICENSE_URLS = Object.freeze([
  'https://kenorie.ai/vessel-license',
  'https://vrm.dev/licenses/1.0/',
]);

/**
 * Build a GLTFLoader with the VRM plugin configured to accept UNAVIS-baked
 * vessels alongside standard VRM 1.0-licensed ones.
 * @returns {GLTFLoader}
 */
// impure (constructs a stateful three.js loader)
export const createVesselLoader = () => {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser, {
    metaPlugin: new VRMMetaLoaderPlugin(parser, {
      acceptLicenseUrls: [...ACCEPTED_VESSEL_LICENSE_URLS],
    }),
  }));
  return loader;
};
