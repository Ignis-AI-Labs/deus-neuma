// youtube-upload.js — the resumable upload protocol of `videos.insert`
// (developers.google.com/youtube/v3/guides/using_resumable_upload_protocol).
//
//   1. POST …/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status
//      with the video resource as JSON and the file's size and type in
//      X-Upload-Content-Length / X-Upload-Content-Type. The answer's
//      Location header is the upload session.
//   2. PUT the bytes to the session in chunks (`Content-Range: bytes a-b/total`).
//      308 means "keep going" and its Range header says what YouTube holds;
//      200/201 carries the created video.
//   3. A dropped connection or a 5xx is not a failure of the upload: ask the
//      session where it stands (`Content-Range: bytes */total`, empty body)
//      and resume from the first byte YouTube does not hold. Bytes are never
//      sent twice and a finished upload is never started again, so a retry
//      can never publish a second copy.
//
// The file is streamed from disk one chunk at a time, never read whole.

import fs from 'fs/promises';
import { youtubeApiRoot } from './youtube-api.js';
import { mapYouTubeError } from './youtube-metadata.js';
import { abortableWait as wait } from './abortable-wait.js';

/** 8MiB: a multiple of the 256KiB YouTube requires of every chunk but the last. */
export const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_RETRIES = 6;
const BASE_DELAY_MS = 1000;

const uploadUrl = () => `${youtubeApiRoot()}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`;

/** The Content-Range of one chunk, end inclusive. Pure. */
export const contentRange = (start, endInclusive, total) => `bytes ${start}-${endInclusive}/${total}`;

/**
 * The next byte to send, from a 308's Range header (`bytes=0-N` → N+1). No
 * Range header means YouTube holds nothing yet. Pure.
 * @param {string|null} range
 * @returns {number}
 */
export const nextOffsetFromRange = (range) => {
  const m = /^bytes=0-(\d+)$/.exec(String(range || '').trim());
  return m ? Number(m[1]) + 1 : 0;
};

/** The statuses that mean "try again", not "refused". Pure. */
export const isRetryableStatus = (status) => [500, 502, 503, 504].includes(status);

const aborted = Object.freeze({ ok: false, detail: 'interrupted before the upload finished; nothing was published' });

/**
 * Open an upload session for one video. Publishes nothing: a session that
 * never receives its bytes simply expires. impure — network.
 * @param {{accessToken: string, resource: object, size: number, contentType: string,
 *   signal?: AbortSignal, baseDelayMs?: number}} args
 * @returns {Promise<{ok: true, sessionUri: string}|{ok: false, status?: number, detail: string}>}
 */
export const startResumableSession = async ({ accessToken, resource, size, contentType, signal, baseDelayMs = BASE_DELAY_MS }) => {
  for (let attempt = 0; ; attempt += 1) {
    let res;
    try {
      res = await fetch(uploadUrl(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Length': String(size),
          'X-Upload-Content-Type': contentType,
        },
        body: JSON.stringify(resource),
        signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') return aborted;
      if (attempt >= MAX_RETRIES) return { ok: false, detail: `YouTube did not answer (${err.message}); nothing was published` };
      await wait(baseDelayMs * 2 ** attempt, signal).catch(() => null);
      if (signal?.aborted) return aborted;
      continue;
    }
    const sessionUri = res.headers.get('location');
    if (res.ok && sessionUri) return { ok: true, sessionUri };
    if (isRetryableStatus(res.status) && attempt < MAX_RETRIES) {
      await wait(baseDelayMs * 2 ** attempt, signal).catch(() => null);
      if (signal?.aborted) return aborted;
      continue;
    }
    const body = await res.json().catch(() => ({}));
    return { ok: false, status: res.status, detail: mapYouTubeError(res.status, body) };
  }
};

// impure — bytes [start, start+length) of an open file.
const readChunk = async (handle, start, length) => {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buf, 0, length, start);
  return buf.subarray(0, bytesRead);
};

/**
 * Send a video's bytes into its session, resuming across drops. impure —
 * disk + network.
 * @param {{sessionUri: string, filePath: string, size: number, contentType: string,
 *   signal?: AbortSignal, chunkBytes?: number, baseDelayMs?: number}} args
 * @returns {Promise<{ok: true, video: object}|{ok: false, status?: number, detail: string}>}
 */
export const sendResumable = async ({
  sessionUri, filePath, size, contentType, signal, chunkBytes = UPLOAD_CHUNK_BYTES, baseDelayMs = BASE_DELAY_MS,
}) => {
  const handle = await fs.open(filePath, 'r');
  let offset = 0;
  let failures = 0;
  // After a drop the next request asks where the upload stands instead of
  // guessing: the session's answer is the only truth about which bytes landed.
  let probe = false;
  try {
    for (;;) {
      let res;
      try {
        if (probe) {
          res = await fetch(sessionUri, {
            method: 'PUT', headers: { 'Content-Range': `bytes */${size}` }, body: Buffer.alloc(0), signal,
          });
        } else {
          const chunk = await readChunk(handle, offset, Math.min(chunkBytes, size - offset));
          res = await fetch(sessionUri, {
            method: 'PUT',
            headers: { 'Content-Type': contentType, 'Content-Range': contentRange(offset, offset + chunk.length - 1, size) },
            body: chunk,
            signal,
          });
        }
      } catch (err) {
        if (err.name === 'AbortError') return aborted;
        failures += 1;
        if (failures > MAX_RETRIES) return { ok: false, detail: `the upload kept dropping (${err.message}); nothing was published` };
        await wait(baseDelayMs * 2 ** (failures - 1), signal).catch(() => null);
        if (signal?.aborted) return aborted;
        probe = true;
        continue;
      }
      if (res.status === 200 || res.status === 201) {
        const video = await res.json().catch(() => null);
        return video?.id ? { ok: true, video } : { ok: false, status: res.status, detail: 'YouTube finished the upload but named no video id' };
      }
      if (res.status === 308) {
        offset = nextOffsetFromRange(res.headers.get('range'));
        // Every byte held but no video yet: ask again rather than send an
        // empty chunk, and never forever.
        probe = offset >= size;
        failures = probe ? failures + 1 : 0;
        if (failures > MAX_RETRIES) return { ok: false, status: 308, detail: 'YouTube holds every byte but never finished the video; nothing was published' };
        continue;
      }
      if (isRetryableStatus(res.status)) {
        failures += 1;
        if (failures > MAX_RETRIES) return { ok: false, status: res.status, detail: `YouTube kept failing mid-upload (HTTP ${res.status}); nothing was published` };
        await wait(baseDelayMs * 2 ** (failures - 1), signal).catch(() => null);
        if (signal?.aborted) return aborted;
        probe = true;
        continue;
      }
      if (res.status === 404 || res.status === 410) {
        return { ok: false, status: res.status, detail: 'the upload session expired before the video finished; nothing was published' };
      }
      const body = await res.json().catch(() => ({}));
      return { ok: false, status: res.status, detail: mapYouTubeError(res.status, body) };
    }
  } finally {
    await handle.close();
  }
};
