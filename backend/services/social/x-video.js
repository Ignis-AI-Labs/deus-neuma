/**
 * X video: upload one video for a post, in pieces.
 *
 * A still goes up in one request (x-media.js). A video is too large for that,
 * so X takes it in four acts (docs.x.com, media upload, chunked; read
 * 2026-11-14): INITIALIZE names the type and size and returns a media id,
 * APPEND sends the file segment by segment, FINALIZE closes it, and X then
 * processes the video, which STATUS is asked about until it has succeeded or
 * failed. Only a video that finished processing can be named on a post.
 *
 * Like a still's upload, none of this publishes anything: an id that is never
 * named on a post expires. The file is read from disk one segment at a time,
 * never whole. A dropped connection or a server error is asked again on the
 * same waits a still gets; X's own refusal is final.
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import { buildOAuth1Header } from './x-poster.js';
import { buildMultipartBody, UPLOAD_RETRY_WAITS_MS } from './x-media.js';
import { abortableWait } from './abortable-wait.js';

const apiRoot = () => process.env.NEUMA_X_API_ROOT || 'https://api.x.com/2';

/** X's default ceiling for a post's video (docs.x.com: 8 GB, 20 minutes). */
export const X_VIDEO_MAX_BYTES = 8 * 1024 * 1024 * 1024;

/** One segment. X asks for 5 MB or less a segment. */
export const X_VIDEO_SEGMENT_BYTES = 4 * 1024 * 1024;

/** How long processing is waited on before the send is given up. */
export const X_VIDEO_PROCESSING_MAX_MS = 10 * 60 * 1000;

// a wait a barge-in cuts short: true when it ran its length
const waited = (ms, signal) => abortableWait(ms, signal).then(() => true, () => false);

const sign = (credentials, method, url, params = {}) => buildOAuth1Header(credentials, {
  method, url, params,
  timestamp: String(Math.floor(Date.now() / 1000)),
  nonce: crypto.randomBytes(16).toString('hex'),
});

// One signed request. `final` marks an answer asking again cannot change. impure (network)
const ask = async (credentials, method, url, { query = {}, headers = {}, body, signal } = {}) => {
  const qs = new URLSearchParams(query).toString();
  try {
    const res = await fetch(qs ? `${url}?${qs}` : url, {
      // a query string is part of the OAuth signature; a JSON or multipart body is not
      method, headers: { Authorization: sign(credentials, method, url, query), ...headers }, body, signal,
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, data: json?.data ?? json };
    const detail = json?.detail || json?.errors?.[0]?.message || json?.title || `HTTP ${res.status}`;
    return { ok: false, status: res.status, detail, final: res.status < 500 };
  } catch (err) {
    if (err.name === 'AbortError') return { ok: false, detail: 'interrupted before the video was uploaded', final: true };
    const cause = err.cause?.code || err.cause?.message;
    return { ok: false, detail: `${err.message}${cause ? ` (${cause})` : ''}: the network did not carry the upload` };
  }
};

// The same request, asked again after a dropped connection or a 5xx. impure (network + clock)
const askAgain = async (waits, signal, ...request) => {
  let result = await ask(...request);
  for (const ms of waits) {
    if (result.ok || result.final || !(await waited(ms, signal))) break;
    result = await ask(...request);
  }
  return result;
};

/**
 * Upload one video and return its media id once X has processed it.
 * Publishes NOTHING.
 *
 * impure: disk + network + clock + entropy
 * @param {object} credentials - from `xPostCredentials()`
 * @param {{path: string, size: number, contentType: string, filename: string}} video - from `readVideoHead`
 * @param {{signal?: AbortSignal, retryWaitsMs?: ReadonlyArray<number>, processingMaxMs?: number,
 *   pollFloorMs?: number}} [opts]
 * @returns {Promise<{ok: true, mediaId: string}|{ok: false, status?: number, detail: string}>}
 */
export const uploadVideo = async (credentials, video, {
  signal, retryWaitsMs = UPLOAD_RETRY_WAITS_MS, processingMaxMs = X_VIDEO_PROCESSING_MAX_MS, pollFloorMs = 1000,
} = {}) => {
  if (!credentials) return { ok: false, detail: 'X credentials are not configured' };
  const root = `${apiRoot()}/media/upload`;
  const failed = (step, r) => ({ ok: false, ...(r.status ? { status: r.status } : {}), detail: `${step}: ${r.detail}` });

  const init = await askAgain(retryWaitsMs, signal, credentials, 'POST', `${root}/initialize`, {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ media_type: video.contentType, total_bytes: video.size, media_category: 'tweet_video' }),
    signal,
  });
  const mediaId = init.ok && init.data?.id ? String(init.data.id) : null;
  if (!mediaId) return failed('X did not open the upload', init.ok ? { detail: 'no media id in its answer' } : init);

  const handle = await fs.open(video.path, 'r');
  try {
    const segment = Buffer.alloc(X_VIDEO_SEGMENT_BYTES);
    for (let index = 0, sent = 0; sent < video.size; index += 1) {
      const { bytesRead } = await handle.read(segment, 0, X_VIDEO_SEGMENT_BYTES, sent);
      if (!bytesRead) return { ok: false, detail: `the video ended at ${sent} of ${video.size} bytes: it changed on disk while it was sent` };
      const boundary = `----neuma${crypto.randomBytes(16).toString('hex')}`;
      const body = buildMultipartBody(
        { name: 'media', filename: video.filename, contentType: 'application/octet-stream', content: segment.subarray(0, bytesRead) },
        boundary, { segment_index: index },
      );
      const sentPart = await askAgain(retryWaitsMs, signal, credentials, 'POST', `${root}/${mediaId}/append`, {
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body, signal,
      });
      if (!sentPart.ok) return failed(`part ${index + 1} did not upload`, sentPart);
      sent += bytesRead;
    }
  } finally {
    await handle.close();
  }

  let state = await askAgain(retryWaitsMs, signal, credentials, 'POST', `${root}/${mediaId}/finalize`, { signal });
  if (!state.ok) return failed('X did not close the upload', state);
  // X processes a video after it is whole; only `succeeded` may be named on a post
  const deadline = Date.now() + processingMaxMs;
  for (;;) {
    const info = state.data?.processing_info;
    if (!info || info.state === 'succeeded') return { ok: true, mediaId };
    if (info.state === 'failed') return { ok: false, detail: `X could not process the video: ${info.error?.message || info.error?.name || 'no reason given'}` };
    if (Date.now() >= deadline) return { ok: false, detail: `X was still processing the video after ${Math.round(processingMaxMs / 60000)} minutes` };
    const waitMs = Math.max(pollFloorMs, Number(info.check_after_secs || 1) * 1000);
    if (!(await waited(waitMs, signal))) return { ok: false, detail: 'interrupted while X processed the video' };
    state = await askAgain(retryWaitsMs, signal, credentials, 'GET', root, { query: { command: 'STATUS', media_id: mediaId }, signal });
    if (!state.ok) return failed('X did not report on the video', state);
  }
};
