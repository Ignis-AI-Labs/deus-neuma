// image-forge-client.js — THE IMAGE FORGE manage surface, over REST.
//
// impure — the desk's only line to the supervised ComfyUI: status, launch,
// stop, free. The desk NEVER calls the engine's own API (NFR-3); the backend
// is the engine's sole client, and these routes are the door.

import { apiCall, authHeadersOrNull as authHeaders } from '../utils/http.js';

const req = async (path, { method = 'GET', body } = {}) => {
  if (!authHeaders()) throw new Error('Not authenticated.');
  return apiCall(method, `/api/v1/image-forge${path}`, {
    body, errorPrefix: 'Image forge request failed', errorSuffix: '.',
  });
};

/** Supervisor snapshot: state/serving/owned/adopted/foreign/port/install/lastError. */
// impure
export const getForgeStatus = () => req('/status');

/** Kick the engine toward READY (ensureReady lane); poll status for progress. */
// impure
export const launchForge = () => req('/launch', { method: 'POST' });

/** Stop an owned engine / release an adopted one. */
// impure
export const stopForge = () => req('/stop', { method: 'POST' });

/** Tier-1 by hand: ask the engine to drop its models, returning VRAM. */
// impure
export const freeForge = () => req('/free', { method: 'POST' });

/**
 * What the beings are doing on the engine: `{live, recent, at}`.
 *
 * ComfyUI's own UI cannot show this — it routes each job's execution events to
 * the submitting client_id, which is the backend's lane socket, so the canvas
 * beside this rail only ever sees the queue counter move.
 */
// impure
export const getForgeActivity = () => req('/activity');

/**
 * Every verdict standing on one image — both standings, newest first — joined to
 * the prompt that was actually sent (`asked`).
 *
 * `asked` is null when the attempt has scrolled past the log's read window; the
 * surface says so rather than guessing at what was asked for.
 */
// impure
export const getImageReviews = (laneId, imageId) =>
  req(`/images/${encodeURIComponent(imageId)}/reviews?laneId=${encodeURIComponent(laneId)}`);

/**
 * The operator's verdict on an image — recorded BESIDE the being's, never over
 * it. The ledger is append-only, so a grade never edits what the being decided;
 * it stands as the operator's own row and rides forward as evidence the being
 * weighs.
 */
// impure
export const gradeImage = (laneId, imageId, { verdict, note = '' }) =>
  req(`/images/${encodeURIComponent(imageId)}/grade?laneId=${encodeURIComponent(laneId)}`, {
    method: 'POST',
    body: { verdict, note },
  });
