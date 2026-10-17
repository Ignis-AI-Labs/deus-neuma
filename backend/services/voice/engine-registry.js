// Voice Engine Registry — typed JS view over voice-engines/engines.json
//
// Single source of truth for engine metadata. Read by:
//   - tts-provider.js (which adapter to dispatch to)
//   - engine-manager.js (how to launch local sidecars)
//   - voice-routes.js (UI status + commercial filtering)
//
// This module is pure: it imports the manifest once at load and exposes
// frozen typed helpers. No IO, no side effects.

import enginesManifest from '../../../voice-engines/engines.json' with { type: 'json' };

const MANIFEST = Object.freeze(enginesManifest);
const ENGINES = Object.freeze(MANIFEST.engines);
const TIERS = Object.freeze(MANIFEST.tiers || {});

// pure
export const getEngine = (id) => ENGINES[id] || null;

// pure
export const listEngines = () => Object.values(ENGINES);

// pure
export const listLocalEngines = () =>
  Object.values(ENGINES).filter((e) => e.type === 'local');

// pure
export const listCloudEngines = () =>
  Object.values(ENGINES).filter((e) => e.type === 'cloud');

// pure — engines safe to enable in a commercial distribution
export const listCommercialEngines = () =>
  Object.values(ENGINES).filter((e) => e.commercial === true);

// pure — resolves the adapter module id for an engine
export const getAdapterId = (id) => ENGINES[id]?.adapter || null;

// pure
export const getManifestVersion = () => MANIFEST.version;

// pure — a voice tier (light | standard | high) → { id, engine, model?, quant?, device, memory }
export const getTier = (tier) =>
  (Object.hasOwn(TIERS, tier) ? Object.freeze({ id: tier, ...TIERS[tier] }) : null);

// pure — every tier, lightest first (manifest order)
export const listTiers = () => Object.keys(TIERS).map(getTier);

// pure — the model an engine serves when the caller names none (null for single-model engines)
export const getDefaultModel = (id) => ENGINES[id]?.defaultModel ?? null;

/**
 * The pinned files a `download.method: "files"` engine needs for one model, each with the path it
 * lands at relative to voice-engines/: its own `dest`, or the Hugging Face cache layout the
 * sidecars load from offline. Shared files (no `model`) are always included. Pure.
 * @param {string} id
 * @param {string|null} [model]
 * @returns {Array<{repo:string, revision:string, path:string, sha256:string, bytes:number, dest:string}>}
 */
export const engineFiles = (id, model = getDefaultModel(id)) =>
  (ENGINES[id]?.download?.files ?? [])
    .filter((f) => !f.model || f.model === model)
    .map((f) => Object.freeze({
      ...f,
      dest: f.dest ?? `_models/_hf_cache/hub/models--${f.repo.replace('/', '--')}/snapshots/${f.revision}/${f.path}`,
    }));

// pure — manifest subset safe to expose over HTTP (no internal paths)
export const toPublicJSON = () =>
  Object.freeze(
    Object.fromEntries(
      Object.entries(ENGINES).map(([id, e]) => [
        id,
        {
          id: e.id,
          name: e.name,
          publisher: e.publisher,
          license: e.license,
          commercial: e.commercial,
          type: e.type,
          languages: e.languages,
          capabilities: e.capabilities,
          requirements: e.requirements,
          validated: e.validated ?? false,
          notes: e.notes,
        },
      ])
    )
  );
