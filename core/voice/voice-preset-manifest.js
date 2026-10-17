// Voice preset manifest builder — pure: catalog data + frozen registry view
// in, servable manifest out. No IO, no side effects.
//
// This is the ONLY place the CC-BY-NC exclusion happens for the preset
// gallery: a voice whose resolved commercial flag is not exactly true is
// dropped while the manifest is being BUILT (expresso/ never exists in the
// output), so neither the route nor the UI has anything left to filter.
//
// License resolution (per voice):
//   1. voice-level license/commercial from the catalog (the kyutai per-voice
//      split — the engine weights' license says nothing about donations)
//   2. else the engine's entry in the frozen registry view
//      (`engine-registry.js` toPublicJSON()) — one store, no drift
//   3. else fail closed: commercial defaults to false and the voice is
//      excluded. An unknown license never accidentally ships.
//
// The manifest's shape is the route's response contract — ids, display
// names, engine, engine display name, license badge. No filesystem paths,
// no absolute paths, nothing a client could traverse with.

// pure — resolve one voice's { license, commercial } against the registry view
const resolveLicense = (voice, engineEntry) => ({
  license: voice.license ?? engineEntry?.license ?? 'unknown',
  commercial: voice.commercial ?? engineEntry?.commercial ?? false,
});

// pure — one catalog voice → one manifest preset (null when excluded)
const toPreset = (section, voice, engineEntry) => {
  const { license, commercial } = resolveLicense(voice, engineEntry);
  if (commercial !== true) return null; // build-time exclusion (expresso/, NC engines)
  return Object.freeze({
    id: voice.id,
    name: voice.name,
    engine: section.engine,
    engineName: engineEntry?.name ?? section.engineName,
    license,
  });
};

/**
 * Build the frozen preset manifest from the curated catalog and the frozen
 * registry view.
 * @param {ReadonlyArray<{engine: string, engineName: string, voices: ReadonlyArray}>} catalog
 * @param {Readonly<Object<string, {name?: string, license?: string, commercial?: boolean}>>} registryView
 * @returns {Readonly<{version: 1, presets: ReadonlyArray}>}
 */
// pure
export const buildPresetManifest = (catalog, registryView) =>
  Object.freeze({
    version: 1,
    presets: Object.freeze(
      catalog.flatMap((section) =>
        section.voices
          .map((voice) => toPreset(section, voice, registryView?.[section.engine]))
          .filter((preset) => preset !== null)
      )
    ),
  });
