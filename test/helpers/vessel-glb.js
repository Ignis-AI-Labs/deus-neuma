// vessel-glb.js — pure builders for real VRM binaries used in vessel tests.
//
// Each builder returns an ArrayBuffer that is a genuine GLB (JSON chunk only —
// a boneless rig needs no buffers) carrying the VRMC_vrm (1.0) or VRM (0.x)
// extension, parseable by the real GLTFLoader + three-vrm chain. This is what
// lets vessel behavior be proven on the real stack before a KENORIE-baked
// vessel exists on disk.

export const KENORIE_LICENSE = 'https://kenorie.ai/vessel-license';

// The 15 required VRM humanoid bones as a node graph: hips → spine → head,
// arms off the spine, legs off the hips. Index = position in `nodes`.
const HUMANOID_NODES = [
  { name: 'hips', translation: [0, 1, 0], children: [1, 9, 12] },
  { name: 'spine', translation: [0, 0.1, 0], children: [2, 3, 6] },
  { name: 'head', translation: [0, 0.4, 0] },
  { name: 'leftUpperArm', translation: [0.1, 0.3, 0], children: [4] },
  { name: 'leftLowerArm', translation: [0.25, 0, 0], children: [5] },
  { name: 'leftHand', translation: [0.25, 0, 0] },
  { name: 'rightUpperArm', translation: [-0.1, 0.3, 0], children: [7] },
  { name: 'rightLowerArm', translation: [-0.25, 0, 0], children: [8] },
  { name: 'rightHand', translation: [-0.25, 0, 0] },
  { name: 'leftUpperLeg', translation: [0.08, -0.05, 0], children: [10] },
  { name: 'leftLowerLeg', translation: [0, -0.4, 0], children: [11] },
  { name: 'leftFoot', translation: [0, -0.45, 0] },
  { name: 'rightUpperLeg', translation: [-0.08, -0.05, 0], children: [13] },
  { name: 'rightLowerLeg', translation: [0, -0.4, 0], children: [14] },
  { name: 'rightFoot', translation: [0, -0.45, 0] },
];

const BONE_NAMES = HUMANOID_NODES.map((n) => n.name);

/** Encode a glTF JSON document as a binary GLB. Pure. */
export const encodeGlb = (json) => {
  const encoder = new TextEncoder();
  const jsonBytes = encoder.encode(JSON.stringify(json));
  const pad = (4 - (jsonBytes.length % 4)) % 4;
  const chunkLength = jsonBytes.length + pad;
  const total = 12 + 8 + chunkLength;
  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  view.setUint32(0, 0x46546c67, true); // magic 'glTF'
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, chunkLength, true);
  view.setUint32(16, 0x4e4f534a, true); // chunk type 'JSON'
  new Uint8Array(buffer, 20, jsonBytes.length).set(jsonBytes);
  new Uint8Array(buffer, 20 + jsonBytes.length, pad).fill(0x20); // space padding
  return buffer;
};

const baseGltf = () => ({
  asset: { version: '2.0' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: HUMANOID_NODES.map((n) => ({ ...n })),
});

// The restrictive consent meta every KENORIE bake writes
// (docs/architecture/avatars/consumer-contract.md "Meta").
const restrictiveMeta = (licenseUrl) => ({
  name: 'test-vessel',
  version: '1.0',
  authors: ['kenorie-bake-test'],
  licenseUrl,
  avatarPermission: 'onlyAuthor',
  commercialUsage: 'personalNonProfit',
  creditNotation: 'required',
  modification: 'prohibited',
  allowRedistribution: false,
  allowExcessivelyViolentUsage: false,
  allowExcessivelySexualUsage: false,
  allowPoliticalOrReligiousUsage: false,
  allowAntisocialOrHateUsage: false,
});

const toExpressionEntries = (names) =>
  Object.fromEntries(names.map((n) => [n, { isBinary: false }]));

/**
 * A VRM 1.0 vessel: all 15 required humanoid bones, restrictive consent meta,
 * and optionally the two expression layers of the consumer contract. Pure.
 * @param {{licenseUrl?: string, presets?: string[], customs?: string[]}} opts
 * @returns {ArrayBuffer}
 */
export const vrm1Glb = ({ licenseUrl = KENORIE_LICENSE, presets = [], customs = [] } = {}) => {
  const vrmc = {
    specVersion: '1.0',
    meta: restrictiveMeta(licenseUrl),
    humanoid: {
      humanBones: Object.fromEntries(BONE_NAMES.map((b, i) => [b, { node: i }])),
    },
  };
  if (presets.length || customs.length) {
    vrmc.expressions = {
      ...(presets.length ? { preset: toExpressionEntries(presets) } : {}),
      ...(customs.length ? { custom: toExpressionEntries(customs) } : {}),
    };
  }
  return encodeGlb({
    ...baseGltf(),
    extensionsUsed: ['VRMC_vrm'],
    extensions: { VRMC_vrm: vrmc },
  });
};

/** A VRM 0.x community vessel (legacy meta + array-form humanBones). Pure. */
export const vrm0Glb = () => encodeGlb({
  ...baseGltf(),
  extensionsUsed: ['VRM'],
  extensions: {
    VRM: {
      specVersion: '0.0',
      exporterVersion: 'test',
      meta: { title: 'community-vessel', author: 'test', licenseName: 'Other' },
      humanoid: {
        humanBones: BONE_NAMES.map((b, i) => ({ bone: b, node: i })),
      },
    },
  },
});
