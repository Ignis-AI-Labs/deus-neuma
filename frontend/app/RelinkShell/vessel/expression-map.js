// expression-map.js — the vessel expression contract as data. Pure.
//
// Mirrors docs/architecture/avatars/consumer-contract.md: every UNAVIS-baked vessel (formerly KENORIE)
// carries the 52 ARKit shapes as exactly-named custom expressions (the rich
// layer) plus 17 projected VRM presets (the fallback layer that also covers
// community vessels). The emotion maps translate the neuma emotion vocabulary
// (core/runtime/emotion-detector.js labels) onto each layer.

export const ARKIT_52 = Object.freeze([
  // eyes (14)
  'eyeBlinkLeft', 'eyeLookDownLeft', 'eyeLookInLeft', 'eyeLookOutLeft',
  'eyeLookUpLeft', 'eyeSquintLeft', 'eyeWideLeft',
  'eyeBlinkRight', 'eyeLookDownRight', 'eyeLookInRight', 'eyeLookOutRight',
  'eyeLookUpRight', 'eyeSquintRight', 'eyeWideRight',
  // jaw (4)
  'jawForward', 'jawLeft', 'jawRight', 'jawOpen',
  // mouth (23)
  'mouthClose', 'mouthFunnel', 'mouthPucker', 'mouthLeft', 'mouthRight',
  'mouthSmileLeft', 'mouthSmileRight', 'mouthFrownLeft', 'mouthFrownRight',
  'mouthDimpleLeft', 'mouthDimpleRight', 'mouthStretchLeft', 'mouthStretchRight',
  'mouthRollLower', 'mouthRollUpper', 'mouthShrugLower', 'mouthShrugUpper',
  'mouthPressLeft', 'mouthPressRight', 'mouthLowerDownLeft', 'mouthLowerDownRight',
  'mouthUpperUpLeft', 'mouthUpperUpRight',
  // brow (5)
  'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight',
  // cheek (3)
  'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight',
  // nose (2)
  'noseSneerLeft', 'noseSneerRight',
  // tongue (1)
  'tongueOut',
]);

export const VISEME_PRESETS = Object.freeze(['aa', 'ih', 'ou', 'ee', 'oh']);

export const GAZE_PRESETS = Object.freeze(['lookUp', 'lookDown', 'lookLeft', 'lookRight']);

export const VRM_PRESETS_17 = Object.freeze([
  'happy', 'angry', 'sad', 'relaxed', 'surprised',
  ...VISEME_PRESETS,
  'blink', 'blinkLeft', 'blinkRight',
  ...GAZE_PRESETS,
]);

// Neuma emotion label → VRM preset weights (fallback layer; works on every
// vessel with the 17-preset contract, including community projections).
export const EMOTION_TO_PRESETS = Object.freeze({
  contemplative: Object.freeze({ relaxed: 0.35 }),
  joyful: Object.freeze({ happy: 0.8 }),
  melancholic: Object.freeze({ sad: 0.7 }),
  passionate: Object.freeze({ happy: 0.55, surprised: 0.2 }),
  serene: Object.freeze({ relaxed: 0.6 }),
  defiant: Object.freeze({ angry: 0.55 }),
  curious: Object.freeze({ surprised: 0.45 }),
  empathic: Object.freeze({ relaxed: 0.4, happy: 0.3 }),
});

// Neuma emotion label → ARKit-52 weights (rich layer; preferred when the
// vessel carries the full custom set).
export const EMOTION_TO_ARKIT = Object.freeze({
  contemplative: Object.freeze({
    browInnerUp: 0.25, eyeSquintLeft: 0.15, eyeSquintRight: 0.15, mouthPucker: 0.2,
  }),
  joyful: Object.freeze({
    mouthSmileLeft: 0.7, mouthSmileRight: 0.7,
    cheekSquintLeft: 0.3, cheekSquintRight: 0.3,
    eyeSquintLeft: 0.25, eyeSquintRight: 0.25,
  }),
  melancholic: Object.freeze({
    browInnerUp: 0.6, mouthFrownLeft: 0.55, mouthFrownRight: 0.55,
    eyeSquintLeft: 0.2, eyeSquintRight: 0.2,
  }),
  passionate: Object.freeze({
    browDownLeft: 0.35, browDownRight: 0.35,
    eyeWideLeft: 0.45, eyeWideRight: 0.45,
    mouthSmileLeft: 0.4, mouthSmileRight: 0.4, jawForward: 0.15,
  }),
  serene: Object.freeze({
    mouthSmileLeft: 0.25, mouthSmileRight: 0.25,
    eyeSquintLeft: 0.15, eyeSquintRight: 0.15, browInnerUp: 0.1,
  }),
  defiant: Object.freeze({
    browDownLeft: 0.6, browDownRight: 0.6,
    mouthPressLeft: 0.45, mouthPressRight: 0.45,
    jawForward: 0.2, noseSneerLeft: 0.15, noseSneerRight: 0.15,
  }),
  curious: Object.freeze({
    browInnerUp: 0.35, browOuterUpLeft: 0.5, browOuterUpRight: 0.5,
    eyeWideLeft: 0.3, eyeWideRight: 0.3, mouthPucker: 0.15,
  }),
  empathic: Object.freeze({
    browInnerUp: 0.4, mouthSmileLeft: 0.3, mouthSmileRight: 0.3,
    eyeSquintLeft: 0.2, eyeSquintRight: 0.2,
  }),
});
