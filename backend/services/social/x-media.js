/**
 * X media — attach real images to the house's outward speech.
 *
 * Three acts, in order: UPLOAD the bytes (returns a media id), describe them
 * with ALT TEXT, then name those ids on the post itself. Uploading publishes
 * nothing — an unused media id simply expires — so the irreversible step
 * remains the post, exactly where the approval gate already stands.
 *
 * OAuth 1.0a subtlety that decides whether any of this works: for a
 * `multipart/form-data` request the signature base string carries ONLY the
 * oauth_* parameters — the body is NOT folded in, unlike the
 * form-urlencoded case the spec is usually described with. `buildOAuth1Header`
 * already signs exactly the params it is handed, so passing none is correct
 * and deliberate here, not an omission.
 *
 * What is NOT here: chunked upload. That is the video path (INIT/APPEND/
 * FINALIZE against a different shape) and it is not needed for stills. A file
 * that is too large is refused with its real size rather than half-sent.
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { buildOAuth1Header } from './x-poster.js';

// The same env door x-poster and x-reader carry: the platform's own tests
// aim the REAL upload path (signing, multipart framing, the lot) at a
// loopback X-shaped server instead of the live API.
const apiRoot = () => process.env.NEUMA_X_API_ROOT || 'https://api.x.com/2';
const uploadEndpoint = () => `${apiRoot()}/media/upload`;
const metadataEndpoint = () => `${apiRoot()}/media/metadata`;

/** X's ceiling for a still image. Refuse locally rather than stream 5MB at a
 *  server that will reject it. */
export const MEDIA_MAX_BYTES = 5 * 1024 * 1024;

/** X caps alt text at 1000 characters. */
export const ALT_TEXT_MAX = 1000;

/** At most four images ride one post. */
export const MEDIA_PER_POST_MAX = 4;

/**
 * Identify an image by its MAGIC BYTES, never by its filename. An extension is
 * a claim made by whoever named the file; the header is the file itself. This
 * is also the type we hand X, so a mislabelled `.png` cannot make us lie to it.
 * Pure.
 * @param {Buffer} buf
 * @returns {string|null} a MIME type, or null when these bytes are not an
 *   image format X accepts
 */
export const sniffImageType = (buf) => {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return 'image/png';
  if (buf.subarray(0, 6).toString('latin1') === 'GIF89a' || buf.subarray(0, 6).toString('latin1') === 'GIF87a') return 'image/gif';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
};

/**
 * The upload category X requires alongside the bytes. Proven necessary the
 * hard way: without it `POST /2/media/upload` answers 400 […] — the endpoint will not infer it from the MIME type.
 * Pure.
 * @param {string} contentType - as sniffed from the bytes
 * @returns {string}
 */
export const mediaCategoryFor = (contentType) =>
  (contentType === 'image/gif' ? 'tweet_gif' : 'tweet_image');

/**
 * Compose a multipart/form-data body: any number of plain text fields followed
 * by the file part. Pure given its boundary.
 * @param {{name: string, filename: string, contentType: string, content: Buffer}} file
 * @param {string} boundary
 * @param {Record<string, string>} [fields] - text parts sent beside the file
 * @returns {Buffer}
 */
export const buildMultipartBody = (file, boundary, fields = {}) => Buffer.concat([
  ...Object.entries(fields).flatMap(([name, value]) => [
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from(`Content-Disposition: form-data; name="${name}"\r\n\r\n`),
    Buffer.from(String(value)),
    Buffer.from('\r\n'),
  ]),
  Buffer.from(`--${boundary}\r\n`),
  Buffer.from(`Content-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\n`),
  Buffer.from(`Content-Type: ${file.contentType}\r\n\r\n`),
  file.content,
  Buffer.from(`\r\n--${boundary}--\r\n`),
]);

/**
 * Read one media file for posting, refusing anything that is not a real,
 * in-bounds image. The path must already be resolved and authorised by the
 * caller (`resolveMediaFile`) — this only re-checks the bytes.
 *
 * impure (disk)
 * @param {string} absPath
 * @returns {Promise<{ok: true, content: Buffer, contentType: string, filename: string}
 *   |{ok: false, detail: string}>}
 */
export const readMediaFile = async (absPath) => {
  let stat;
  try {
    stat = await fs.stat(absPath);
  } catch {
    return { ok: false, detail: `the media file is gone: ${absPath}` };
  }
  if (!stat.isFile()) return { ok: false, detail: `not a regular file: ${absPath}` };
  if (stat.size > MEDIA_MAX_BYTES) {
    return { ok: false, detail: `image is ${Math.round(stat.size / 1024)}KB — over the ${MEDIA_MAX_BYTES / 1024 / 1024}MB ceiling for a still` };
  }
  if (stat.size === 0) return { ok: false, detail: `the media file is empty: ${absPath}` };
  const content = await fs.readFile(absPath);
  const contentType = sniffImageType(content);
  if (!contentType) {
    return { ok: false, detail: `these bytes are not a JPEG, PNG, GIF or WEBP — whatever the name says (${path.basename(absPath)})` };
  }
  return { ok: true, content, contentType, filename: path.basename(absPath) };
};

/**
 * A DROPPED CONNECTION IS NOT AN ANSWER (2026-11-10, 21:01: the machine's
 * network blinked for ten seconds and an approved post failed as "fetch
 * failed"; 64 image posts had gone out on this path before it). An upload
 * publishes nothing, so after a network failure or a server error (5xx) it is
 * asked again on these waits before the post is given up. A refusal (4xx) is
 * X's answer and is final. The post itself is never retried here: it can
 * publish, and a lost answer must not become a second post.
 */
export const UPLOAD_RETRY_WAITS_MS = Object.freeze([5_000, 15_000, 40_000]);

const pause = (ms, signal) => new Promise((resolve) => {
  if (signal?.aborted) return resolve(false);
  const timer = setTimeout(() => { signal?.removeEventListener?.('abort', stop); resolve(true); }, ms);
  const stop = () => { clearTimeout(timer); resolve(false); };
  signal?.addEventListener?.('abort', stop, { once: true });
});

/**
 * Upload one image and return its media id. Publishes NOTHING: an id that is
 * never named on a post simply expires. Retried on a dropped connection or a
 * 5xx (UPLOAD_RETRY_WAITS_MS).
 *
 * impure — network + clock + entropy
 * @param {object} credentials - from `xPostCredentials()`
 * @param {{content: Buffer, contentType: string, filename: string}} file
 * @param {{signal?: AbortSignal, retryWaitsMs?: ReadonlyArray<number>}} [opts]
 * @returns {Promise<{ok: true, mediaId: string}|{ok: false, status?: number, detail: string}>}
 */
export const uploadMedia = async (credentials, file, { signal, retryWaitsMs = UPLOAD_RETRY_WAITS_MS } = {}) => {
  if (!credentials) return { ok: false, detail: 'X credentials are not configured' };
  let result = await uploadOnce(credentials, file, signal);
  let tries = 1;
  for (const ms of retryWaitsMs) {
    if (result.ok || result.final || !(await pause(ms, signal))) break;
    result = await uploadOnce(credentials, file, signal);
    tries += 1;
  }
  if (signal?.aborted && !result.ok) return { ok: false, detail: 'interrupted before the image was uploaded' };
  const { final: _final, ...answer } = result;
  return answer.ok || tries === 1 ? answer : { ...answer, detail: `${answer.detail} (tried ${tries} times)` };
};

// One attempt. `final` marks an answer a retry cannot change: X's own refusal, or an interruption.
const uploadOnce = async (credentials, file, signal) => {
  const boundary = `----neuma${crypto.randomBytes(16).toString('hex')}`;
  // No body params in the signature — see the multipart note in the header.
  const header = buildOAuth1Header(credentials, {
    method: 'POST',
    url: uploadEndpoint(),
    timestamp: String(Math.floor(Date.now() / 1000)),
    nonce: crypto.randomBytes(16).toString('hex'),
  });
  try {
    const res = await fetch(uploadEndpoint(), {
      method: 'POST',
      headers: { Authorization: header, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      // media_category rides as a form field, NOT in the signature — the body
      // of a multipart request is excluded from the OAuth base string.
      body: buildMultipartBody(
        { name: 'media', ...file }, boundary, { media_category: mediaCategoryFor(file.contentType) },
      ),
      signal,
    });
    const body = await res.json().catch(() => ({}));
    const mediaId = body?.data?.id || body?.id || body?.media_id_string;
    if (res.ok && mediaId) return { ok: true, mediaId: String(mediaId) };
    const detail = body?.detail || body?.errors?.[0]?.message || body?.title || `HTTP ${res.status}`;
    return { ok: false, status: res.status, detail, final: res.status < 500 };
  } catch (err) {
    if (err.name === 'AbortError') return { ok: false, detail: 'interrupted before the image was uploaded', final: true };
    // "fetch failed" alone hides the reason; the cause names it (ECONNRESET, ENOTFOUND, a timeout)
    const cause = err.cause?.code || err.cause?.message;
    return { ok: false, detail: `${err.message}${cause ? ` (${cause})` : ''} — the network did not carry the upload` };
  }
};

/**
 * Describe an uploaded image for people who cannot see it. Called after upload
 * and before the post; a failure here is reported but never blocks the post —
 * losing the alt text is bad, silently dropping the whole post is worse.
 *
 * impure — network + clock + entropy
 * @param {object} credentials
 * @param {string} mediaId
 * @param {string} altText
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<{ok: boolean, detail?: string}>}
 */
export const setAltText = async (credentials, mediaId, altText, { signal } = {}) => {
  const text = String(altText || '').trim().slice(0, ALT_TEXT_MAX);
  if (!credentials || !mediaId || !text) return { ok: false, detail: 'nothing to describe' };
  const header = buildOAuth1Header(credentials, {
    method: 'POST',
    url: metadataEndpoint(),
    timestamp: String(Math.floor(Date.now() / 1000)),
    nonce: crypto.randomBytes(16).toString('hex'),
  });
  try {
    const res = await fetch(metadataEndpoint(), {
      method: 'POST',
      headers: { Authorization: header, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: String(mediaId), metadata: { alt_text: { text } } }),
      signal,
    });
    if (res.ok) return { ok: true };
    const body = await res.json().catch(() => ({}));
    return { ok: false, detail: body?.detail || body?.title || `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
};
