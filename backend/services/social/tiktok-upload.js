// tiktok-upload.js — the FILE_UPLOAD half of a TikTok publish (media transfer
// guide, developers.tiktok.com/doc/content-posting-api-media-transfer-guide,
// read 2026-10-23).
//
//   PUT each chunk, in order, to the upload URL the init returned, with
//   `Content-Range: bytes first-last/total` and the video's type. TikTok
//   answers 206 while chunks remain and 201 when the last one lands, and
//   names what it holds in its own `Content-Range: bytes 0-N/total`.
//
// A dropped connection or a 5xx is not a failure of the upload: the chunk is
// sent again from the last byte TikTok confirmed. Chunks keep the boundaries
// declared at init, so a resend is always a whole declared chunk; if TikTok
// says (416 + Content-Range) it already holds that chunk, the upload moves on
// from what TikTok holds. The file is streamed one chunk at a time, never
// read whole.

import fs from 'fs/promises';
import { abortableWait as wait } from './abortable-wait.js';

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000;

/** The Content-Range of one chunk, end inclusive. Pure. */
export const chunkContentRange = (start, endExclusive, total) => `bytes ${start}-${endExclusive - 1}/${total}`;

/**
 * The bytes TikTok holds, from its `Content-Range: bytes 0-N/total` (→ N+1),
 * or null when it names none. Pure.
 * @param {string|null} header
 */
export const heldFromContentRange = (header) => {
  const m = /^bytes\s+0-(\d+)\/\d+$/.exec(String(header || '').trim());
  return m ? Number(m[1]) + 1 : null;
};

/** The statuses that mean "send it again", not "refused". Pure. */
const isRetryable = (status) => status >= 500 && status <= 599;

const aborted = Object.freeze({ ok: false, detail: 'interrupted before the upload finished; nothing was published' });

// impure — bytes [start, end) of an open file.
const readChunk = async (handle, start, end) => {
  const buf = Buffer.alloc(end - start);
  const { bytesRead } = await handle.read(buf, 0, end - start, start);
  return buf.subarray(0, bytesRead);
};

// pure — the index of the declared chunk that begins at `held`, or -1.
const chunkAt = (ranges, held) => (held >= ranges.at(-1).end ? ranges.length : ranges.findIndex((r) => r.start === held));

const REFUSED = Object.freeze({
  400: 'TikTok refused a chunk as malformed',
  403: 'the TikTok upload link expired (it lasts one hour)',
  404: 'TikTok no longer knows this upload',
});

/**
 * Send a video's bytes, chunk by declared chunk, resuming across drops.
 * impure — disk + network.
 * @param {{uploadUrl: string, filePath: string, size: number, contentType: string,
 *   ranges: Array<{start: number, end: number}>, signal?: AbortSignal, baseDelayMs?: number}} args
 * @returns {Promise<{ok: true}|{ok: false, status?: number, detail: string}>}
 */
export const sendTikTokChunks = async ({ uploadUrl, filePath, size, contentType, ranges, signal, baseDelayMs = BASE_DELAY_MS }) => {
  const handle = await fs.open(filePath, 'r');
  let index = 0;
  let failures = 0;
  const retry = async (why) => {
    failures += 1;
    if (failures > MAX_RETRIES) return { ok: false, detail: `the upload kept failing (${why}); nothing was published` };
    await wait(baseDelayMs * 2 ** (failures - 1), signal).catch(() => null);
    return signal?.aborted ? aborted : null;
  };
  try {
    while (index < ranges.length) {
      const { start, end } = ranges[index];
      let res;
      try {
        const chunk = await readChunk(handle, start, end);
        res = await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': contentType, 'Content-Range': chunkContentRange(start, end, size) },
          body: chunk,
          signal,
        });
      } catch (err) {
        if (err.name === 'AbortError') return aborted;
        const stop = await retry(err.message);
        if (stop) return stop;
        continue;
      }
      await res.arrayBuffer().catch(() => null);
      const held = heldFromContentRange(res.headers.get('content-range'));
      if (res.status === 201) return { ok: true };
      if (res.status === 206 || res.status === 416) {
        // TikTok's own count of what it holds decides the next chunk.
        const next = held == null ? (res.status === 206 ? index + 1 : -1) : chunkAt(ranges, held);
        if (next === ranges.length) return { ok: true };
        if (next < 0) return { ok: false, status: res.status, detail: 'TikTok and this upload disagree about which bytes arrived; nothing was published' };
        if (next <= index && res.status === 206) return { ok: false, status: 206, detail: 'TikTok did not keep the chunk it acknowledged; nothing was published' };
        index = next;
        failures = 0;
        continue;
      }
      if (isRetryable(res.status)) {
        const stop = await retry(`HTTP ${res.status}`);
        if (stop) return stop;
        continue;
      }
      return { ok: false, status: res.status, detail: `${REFUSED[res.status] || `TikTok refused the upload (HTTP ${res.status})`}; nothing was published` };
    }
    return { ok: false, detail: 'every chunk was sent but TikTok never confirmed the upload; nothing was published' };
  } finally {
    await handle.close();
  }
};
