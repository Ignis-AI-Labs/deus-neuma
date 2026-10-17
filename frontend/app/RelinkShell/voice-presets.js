// voice-presets.js — pure helpers for the forge preset gallery + the engine
// warming panel. No IO: the gallery grouping and the warm-up stage label are
// display logic over data the clients already fetched.

/**
 * Group the flat preset manifest into per-engine sections for the gallery,
 * preserving first-seen engine order and per-engine preset order.
 * @param {Array<{id: string, name: string, engine: string, engineName: string, license: string}>} presets
 * @returns {Array<{engine: string, engineName: string, presets: Array}>}
 */
// pure
export const groupPresetsByEngine = (presets) => {
  const sections = [];
  const byEngine = new Map();
  for (const preset of presets || []) {
    let section = byEngine.get(preset.engine);
    if (!section) {
      section = { engine: preset.engine, engineName: preset.engineName, presets: [] };
      byEngine.set(preset.engine, section);
      sections.push(section);
    }
    section.presets.push(preset);
  }
  return sections;
};

// Display labels for the warming panel, mapped from the REAL engine-manager
// STATES (backend/services/voice/engine-manager.js:45-52) — these are the only
// stages the launch surface actually reports, so they are the only stages the
// panel can name. No invented probe/spawn granularity.
const WARMING_STAGE_LABELS = Object.freeze({
  stopped: 'IDLE',
  syncing: 'SYNCING ENVIRONMENT', // uv sync running
  launching: 'SPAWNING — LOADING MODEL', // process spawned, model loading
  ready: 'READY',
  failed: 'LAUNCH FAILED',
  crashed: 'CRASHED',
});

/**
 * The warming panel's stage line for an engine-manager state. A null/unknown
 * state means the client has not learned the engine's state yet (the first
 * status poll is in flight) — labelled PROBING, which is what is really
 * happening, never a fabricated stage.
 * @param {string|null|undefined} state
 * @returns {string}
 */
// pure
export const warmingStageLabel = (state) =>
  WARMING_STAGE_LABELS[state] || (state ? String(state).toUpperCase() : 'PROBING ENGINE STATE');
