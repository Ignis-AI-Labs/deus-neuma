/**
 * Supervised-substrate launch planning — the pure config/gate helpers
 * extracted verbatim from llama-server-supervisor.js (size-law breakdown,
 * 2026-08-26): model selection, the active launch resolution, launch
 * prerequisite gates, the bounded public failure projection, and the
 * crash-relight decision. The supervisor imports this and re-exports every
 * symbol, so its wide fan of importers (server.js, ignition/preflight paths,
 * tests) keeps its door; this module never imports the supervisor.
 */
import { existsSync } from 'fs';
import path from 'path';
import { lineageEvidenceFor, memoizedProjectorFor } from './model-catalog.js';
import { clearSelection, readSelection, writeSelection } from './substrate-claim-registry.js';
import { resolveServingLaunchConfig, validatedServingLaunchConfig } from './serving-launch-config.js';
import { claimedLaunch } from './served-model-truth.js';

/**
 * Select the model the supervised substrate serves. The selection IS the persisted
 * marker (substrate-claim-registry): every relight lands on what the operator launched.
 * Impure. @param {string|null} modelPath @param {string|null} [key] - the route-layer key
 */
export const selectSubstrateModel = (modelPath, key = null) => {
  if (modelPath) writeSelection(modelPath, key);
  else clearSelection();
};

/** Resolve the launch the substrate should run: the operator's persisted
 *  selection, then a LIVE persisted claim, then env; projector discovered
 *  beside the model. */
export const activeLaunchConfig = (env) => {
  const cfg = resolveServingLaunchConfig(env);
  const sel = readSelection();
  // servingModel is a LINEAGE identity, never the display key: a selected
  // model with no lineage evidence boots base-only, not into a gate it can
  // never pass (the gate authorizes committed tuples only).
  const active = sel
    ? { ...cfg, model: sel.path, servingModel: lineageEvidenceFor(sel.path)?.servingModel ?? null }
    : claimedLaunch(cfg);
  if (active.mmproj || !active.model) return validatedServingLaunchConfig(active);
  const projector = memoizedProjectorFor(env, active.model);
  return validatedServingLaunchConfig(projector ? { ...active, mmproj: projector } : active);
};

/**
 * THE LAST GATE'S FAIL-SAFE (#529, 2026-09-13): a base-only launch that
 * ARRIVES projector-less gets the rig's discovered projector filled in at the
 * supervisor door — the serving never launches blinder than the model
 * (Founder's 2026-08-15 law: a capability the model has is ON by default). A
 * caller that erases the discovery — the bench night-run that spread
 * activeLaunchConfig and then set mmproj:'' before relighting the house
 * serving — is repaired here, not obeyed.
 *
 * A lineage-supervised launch (servingModel set) is NEVER filled: refinement
 * authority is text-only until projector lineage exists
 * (assertTextOnlySupervisedLaunch). An explicit mmproj, a missing model, and
 * a rig with no projector all pass through untouched.
 * Impure — the discovery walks the model roots (memoized).
 * @param {Object} config - a serving launch config (validated here)
 * @param {Record<string, string|undefined>} [env]
 */
export const withDiscoveredProjector = (config, env = process.env) => {
  const validated = validatedServingLaunchConfig(config);
  if (validated.mmproj || !validated.model || validated.servingModel !== null) return validated;
  const projector = memoizedProjectorFor(env, validated.model);
  return projector ? validatedServingLaunchConfig({ ...validated, mmproj: projector }) : validated;
};

/** Does the validated absolute executable path exist? Pure over filesystem state. */
export const binaryPresent = (bin) =>
  typeof bin === 'string' && path.isAbsolute(bin) && existsSync(bin);

// impure — do the launch prerequisites exist on this machine?
export const launchReady = (config) => {
  const cfg = validatedServingLaunchConfig(config);
  const binOk = binaryPresent(cfg.bin);
  const modelOk = Boolean(cfg.model) && existsSync(cfg.model);
  const lorasOk = cfg.loras.every((lora) => existsSync(lora));
  return Object.freeze({ binOk, modelOk, lorasOk, ready: binOk && modelOk && lorasOk });
};

/** Render actionable missing-prerequisite messages.
 * @param {{binOk:boolean, modelOk:boolean, lorasOk:boolean}} ready
 * @param {{bin?:string, model?:string}} cfg */
export const missingPrerequisites = (ready, cfg = {}) => [
  ready.binOk ? null
    : `llama.cpp is not installed — configure an absolute LLAMA_SERVER_BIN path${cfg.bin ? ` (${cfg.bin})` : ''}`,
  ready.modelOk ? null
    : (cfg.model
      ? `the model file is missing — nothing at ${cfg.model}`
      : 'no model file is configured — set LLAMA_SERVER_MODEL, or choose Ollama or LM Studio in Settings → Models'),
  ready.lorasOk ? null : 'a configured LoRA adapter file is missing',
].filter(Boolean);

const PUBLIC_ERROR_MESSAGES = Object.freeze({
  'launch-not-ready': 'The local substrate is missing a required launch input.',
  'launch-refused': 'The local substrate launch was refused before start — see the backend log for the exact reason.',
  'process-exited': 'The local substrate process exited unexpectedly.',
  'relight-failed': 'The local substrate could not restart automatically.',
  'spawn-failed': 'The local substrate process could not start.',
});


/** Project internal process failures into the bounded public status contract. Pure. */
export const projectSupervisorFailure = (failure) => {
  if (!failure) return null;
  const code = Object.hasOwn(PUBLIC_ERROR_MESSAGES, failure.code)
    ? failure.code : 'spawn-failed';
  const instant = typeof failure.at === 'string' ? new Date(failure.at) : null;
  const at = instant && Number.isFinite(instant.getTime())
    && instant.toISOString() === failure.at ? failure.at : null;
  return Object.freeze({ code, message: PUBLIC_ERROR_MESSAGES[code], at });
};

export const RELIGHT_WINDOW_MS = 10 * 60_000;
export const RELIGHT_MAX = 2;

/** Should a dead server come back on its own? Pure over the exit's facts:
 *  never after a deliberate stop, never past the rate cap. */
export const shouldRelight = ({ deliberate, recent, now, windowMs = RELIGHT_WINDOW_MS, max = RELIGHT_MAX }) =>
  !deliberate && (recent || []).filter((t) => now - t < windowMs).length < max;
