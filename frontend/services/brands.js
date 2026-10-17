// brands.js — the operator's brand kits, over REST.
//
// impure. Mirrors backend/routes/brand-routes.js exactly, so there is no second
// vocabulary to keep in step. There is deliberately NO delete: removing a kit
// would orphan every campaign, queued post and pressed document referencing it,
// and none of those would fail loudly.

import { apiCall, authTokenOrNull } from '../utils/http.js';

const BASE = '/api/v1/brands';

/** Every kit this operator can reach: `{kits, total, ready}`. */
export const listBrandKits = async () => apiCall('GET', BASE);

/**
 * One kit, with `readiness` (per-section progress) and `report` — the exact
 * sentences a being is refused with, so the operator reads what will actually
 * block a campaign rather than a second wording of it.
 */
export const getBrandKit = async (brand) => apiCall('GET', `${BASE}/${encodeURIComponent(brand)}`);

/** A loadable starting point for a brand that does not exist yet. */
export const newBrandKit = async (brand) => apiCall('GET', `${BASE}/${encodeURIComponent(brand)}/new`);

/**
 * Save a kit. It always lands in the operator's OWN ground — saving a brand
 * the repo ships creates a kit that shadows it rather than editing source.
 *
 * A 422 carries `refusals`: the named fields the renderer could not open. Those
 * are the only hard floor; everything else is readiness, which is reported and
 * never enforced on save.
 */
export const saveBrandKit = async (brand, kit) =>
  apiCall('PUT', `${BASE}/${encodeURIComponent(brand)}`, { body: kit });

/**
 * How a kit is EDITED: the form's sections, every field's control, and what the
 * card templates demand of a kit.
 *
 * Fetched rather than hand-written in the frontend on purpose. A copy of the
 * field list over here drifts from the gate the first time a field is added,
 * and the drift is SILENT — which is exactly how twenty of thirty-nine fields
 * ended up reachable only through a raw JSON textarea. A process constant, so
 * callers should memoize it rather than asking per mount.
 */
export const getKitForm = async () => apiCall('GET', `${BASE}/form`);

/** The font families this build carries, and the weights that genuinely exist
 *  for each. The type pickers are closed over this: a family the renderer
 *  cannot embed is not a family a kit may name. */
export const getFaceRegistry = async () => apiCall('GET', `${BASE}/faces`);

/**
 * The URL for one vendored face's bytes, for an `@font-face` rule.
 *
 * ⚠️ Carries the session token in the QUERY, because CSS `url()` issues the
 * browser's own bare GET and can attach no header. That route accepts `?token=`
 * explicitly, and only that route.
 */
export const faceFileUrl = (id) => {
  const token = authTokenOrNull();
  return `${BASE}/faces/${encodeURIComponent(id)}/file${token ? `?token=${encodeURIComponent(token)}` : ''}`;
};

/** The marks a brand carries, recoloured onto its own palette, plus the exact
 *  folder to drop a new one into. */
export const getBrandMarks = async (brand) =>
  apiCall('GET', `${BASE}/${encodeURIComponent(brand)}/marks`);

/**
 * Put an SVG into this brand's marks/ folder. Multipart, so it never touches
 * the strict JSON body limit this lane inherits — and so it does not go through
 * apiCall, which is the JSON idiom.
 */
export const uploadBrandMark = async (brand, name, file) => {
  const form = new FormData();
  form.append('name', name);
  form.append('mark', file);
  const res = await fetch(`${BASE}/${encodeURIComponent(brand)}/marks`, {
    method: 'POST',
    // No Content-Type: the browser must set the multipart boundary itself.
    headers: { ...(authTokenOrNull() ? { Authorization: `Bearer ${authTokenOrNull()}` } : {}) },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'the mark could not be saved');
  return data;
};

/**
 * Draw a card from a kit that is NOT saved — the draft currently being edited.
 *
 * ⚠️ Answers `{ok: false, errors}` at HTTP 200 for a card that simply cannot be
 * drawn yet. That is the routine case while somebody is half-way through typing
 * a hex value, and it belongs in the result rather than on the error path.
 *
 * The SVG carries NO embedded fonts — `faces` names the ids to install as
 * document-level `@font-face` rules instead. That is the difference between an
 * 8KB response and a 1.6MB one on every keystroke.
 */
export const previewBrandCard = async (brand, { kit, template, data = null, signal } = {}) =>
  apiCall('POST', `${BASE}/${encodeURIComponent(brand)}/preview`, {
    body: { kit, template, data },
    signal,
  });
