// llm-presets.js — inference presets (named sampling modes) for the witness.
// The list is static (name + label + blurb, no raw numbers); the witness's
// chosen default is per-wallet. A preset rides on each message per-turn — this
// service only loads the list and reads/persists the default.
// impure — Bearer from the session.

import { apiCall } from '../utils/http.js';

const PRESETS = '/api/v1/user/realm/presets';
const PRESET = '/api/v1/user/realm/preset';
const MODEL_INFO = '/api/v1/lm-studio/config';

// impure — the available modes [{ name, label, blurb }]; failure reads as empty.
export const getPresets = async () => {
  try {
    return (await apiCall('GET', PRESETS, { errorPrefix: 'Could not read presets' })).presets || [];
  } catch {
    return [];
  }
};

// impure — the witness's saved default preset name; failure reads as 'balanced'.
export const getPreset = async () => {
  try {
    return (await apiCall('GET', PRESET, { errorPrefix: 'Could not read preset' })).preset || 'balanced';
  } catch {
    return 'balanced';
  }
};

// impure — persist the witness's default preset; returns the stored name.
export const setPreset = async (name) =>
  (await apiCall('PUT', PRESET, { body: { preset: name }, errorPrefix: 'Could not set preset' })).preset;

// impure — the loaded model + its context window (read-only; context is a
// load-time property of the model, not a per-conversation knob). null on failure.
export const getModelInfo = async () => {
  try {
    const d = await apiCall('GET', MODEL_INFO, { strictJson: true });
    return { model: d.model, contextLength: d.contextLength };
  } catch {
    return null;
  }
};
