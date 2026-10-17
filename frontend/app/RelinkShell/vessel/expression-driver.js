// expression-driver.js — drives a vessel's face through the two-layer
// expression contract (docs/architecture/avatars/consumer-contract.md items 2-4).
//
// Everything goes through vrm.expressionManager.setValue(name, weight):
// emotion (ARKit-52 rich layer when the vessel carries it, VRM presets
// otherwise), autonomous blink, gaze via the look* presets (baked vessels
// have no lookAt block), and a viseme cycle while the neuma is speaking.
// Time is accumulated from update() deltas — no wall clock — so behavior is
// reproducible in tests.

import {
  ARKIT_52, VISEME_PRESETS, GAZE_PRESETS, VRM_PRESETS_17,
  EMOTION_TO_PRESETS, EMOTION_TO_ARKIT,
} from './expression-map.js';

const EMOTION_HOLD_S = 6;
const BLINK_MIN_GAP_S = 2;
const BLINK_MAX_GAP_S = 6;
const BLINK_DURATION_S = 0.18;

// Per-channel easing rates (1/s): how fast a weight chases its target.
const RATE_EMOTION = 3;
const RATE_GAZE = 5;
const RATE_VISEME = 14;
const RATE_BLINK = 25;

const VISEME_SET = new Set(VISEME_PRESETS);
const GAZE_SET = new Set(GAZE_PRESETS);

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Exponential ease of current toward target. Pure. */
const ease = (current, target, rate, delta) =>
  current + (target - current) * (1 - Math.exp(-rate * delta));

/** Easing rate for a given expression name. Pure. */
const rateFor = (name) => {
  if (name === 'blink') return RATE_BLINK;
  if (VISEME_SET.has(name)) return RATE_VISEME;
  if (GAZE_SET.has(name)) return RATE_GAZE;
  return RATE_EMOTION;
};

/** look* preset weights for a gaze direction (x right, y up, each -1..1). Pure. */
const gazeTargets = (x, y) => ({
  lookRight: clamp01(x),
  lookLeft: clamp01(-x),
  lookUp: clamp01(y),
  lookDown: clamp01(-y),
});

/** Slow idle gaze wander so a resting vessel never stares dead ahead. Pure. */
const wanderGaze = (t) => ({
  x: Math.sin(t * 0.31) * 0.25 + Math.sin(t * 0.13) * 0.15,
  y: Math.sin(t * 0.21) * 0.12,
});

/** Viseme weights at time t while speaking — a deterministic babble that
 *  steps through the five contract visemes with a varying envelope. Pure. */
const visemeTargets = (t) => {
  const step = Math.floor(t * 5);
  const active = VISEME_PRESETS[(step * 3 + 1) % VISEME_PRESETS.length];
  const envelope = 0.25 + 0.5 * Math.abs(Math.sin(t * 8.5));
  return Object.fromEntries(VISEME_PRESETS.map((v) => [v, v === active ? envelope : 0]));
};

/** sin envelope over the blink's 0..1 phase. Pure. */
const blinkEnvelope = (phase) => Math.sin(Math.PI * clamp01(phase));

/**
 * Create a driver bound to one vrm's expressionManager.
 * Returns null when the vessel has no expressions at all.
 * @param {object} vrm - a loaded three-vrm VRM (0.x or 1.0)
 * @param {{rng?: () => number}} [opts] - rng injectable for deterministic tests
 */
// impure (holds per-vessel animation state, writes expression weights)
export const createExpressionDriver = (vrm, { rng = Math.random } = {}) => {
  const manager = vrm?.expressionManager;
  if (!manager) return null;

  const available = new Set(
    [...ARKIT_52, ...VRM_PRESETS_17].filter((name) => manager.getExpression(name) !== null),
  );
  const hasArkit = ARKIT_52.every((name) => available.has(name));

  let t = 0;
  let weights = {}; // every name this driver has ever written
  let emotionWeights = null; // active emotion's target map
  let emotionUntil = 0;
  let speaking = false;
  let gaze = null; // explicit {x, y} override, or null for idle wander
  let blinkStart = -1;
  let nextBlinkAt = BLINK_MIN_GAP_S + rng() * (BLINK_MAX_GAP_S - BLINK_MIN_GAP_S);

  const setEmotion = (label) => {
    const layer = hasArkit ? EMOTION_TO_ARKIT : EMOTION_TO_PRESETS;
    emotionWeights = layer[label] || null;
    emotionUntil = emotionWeights ? t + EMOTION_HOLD_S : 0;
  };

  const setSpeaking = (value) => { speaking = !!value; };
  const setGaze = (x, y) => { gaze = { x, y }; };
  const clearGaze = () => { gaze = null; };

  const update = (delta) => {
    t += delta;

    const targets = {};
    if (emotionWeights && t < emotionUntil) Object.assign(targets, emotionWeights);

    const dir = gaze || wanderGaze(t);
    Object.assign(targets, gazeTargets(dir.x, dir.y));

    if (speaking) Object.assign(targets, visemeTargets(t));

    if (blinkStart < 0 && t >= nextBlinkAt) blinkStart = t;
    if (blinkStart >= 0) {
      const phase = (t - blinkStart) / BLINK_DURATION_S;
      if (phase >= 1) {
        blinkStart = -1;
        nextBlinkAt = t + BLINK_MIN_GAP_S + rng() * (BLINK_MAX_GAP_S - BLINK_MIN_GAP_S);
        targets.blink = 0;
      } else {
        targets.blink = blinkEnvelope(phase);
      }
    }

    const next = {};
    for (const name of new Set([...Object.keys(weights), ...Object.keys(targets)])) {
      const value = ease(weights[name] || 0, targets[name] || 0, rateFor(name), delta);
      next[name] = value < 0.001 && !(name in targets) ? 0 : value;
      if (available.has(name)) manager.setValue(name, next[name]);
    }
    weights = next;
  };

  return Object.freeze({
    capabilities: Object.freeze({ hasArkit }),
    setEmotion, setSpeaking, setGaze, clearGaze, update,
  });
};
