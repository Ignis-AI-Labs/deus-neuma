// model-route-view.js — pure view helpers for the Models settings section.
//
// Kept free of React/DOM so the state-derivation (a provider's key state, a
// route's display label) is unit-testable without rendering. ModelsSection.jsx
// imports these; the impure fetch/sound/scroll wiring stays in the component.

/**
 * A provider's credential state as a display tag + CSS class.
 *   • has a key      → KEY SET   (ok)
 *   • needs no key   → KEYLESS   (dim)  — local engines, custom endpoints
 *   • needs a key    → NEEDS KEY (warn)
 * @param {{hasKey?:boolean, requiresKey?:boolean}} p masked provider entry
 * @returns {{tag:string, cls:string}}
 */
export const providerState = (p) => {
  if (p.hasKey) return { tag: 'KEY SET', cls: 'settings-tag-ok' };
  if (!p.requiresKey) return { tag: 'KEYLESS', cls: 'settings-tag-dim' };
  return { tag: 'NEEDS KEY', cls: 'settings-tag-warn' };
};

/**
 * A route's "provider / model" label, or null when either half is missing
 * (an incomplete or absent route renders as an em dash / "none", not "x / undefined").
 * @param {{provider?:string, model?:string}|null|undefined} r
 * @returns {string|null}
 */
export const routeLabel = (r) => (r && r.provider && r.model ? `${r.provider} / ${r.model}` : null);

/**
 * Narrow the provider catalog by a free-text query — case-insensitive
 * substring over id and name. A blank query keeps the whole catalog; a
 * non-array yields nothing. With 161 catalog entries this is what keeps the
 * picker usable.
 * @param {Array<{id:string, name:string}>} providers
 * @param {string} query
 * @returns {Array<{id:string, name:string}>}
 */
export const filterProviders = (providers, query) => {
  if (!Array.isArray(providers)) return [];
  const q = String(query || '').trim().toLowerCase();
  if (!q) return providers;
  return providers.filter((p) =>
    String(p.id || '').toLowerCase().includes(q)
    || String(p.name || '').toLowerCase().includes(q));
};
