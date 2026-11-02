/** Original web bytes, streamed to a file. No text extraction or preview truncation. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { assertSafeWebTarget, nextRedirectUrl } from './web-guard.js';
import { requestWebOnce } from './web-fetch.js';

// No size cap (Design note, 2026-11-02: […]). The act already waits on the operator's approval; a file
// is refused only when it cannot fit on the disk. A stalled server is cut by
// the request's idle timeout, and the caller's signal cancels at any time.

// impure — bytes free to this process where the file will land.
const freeBytes = async (directory) => {
  try { const s = await fs.promises.statfs(directory); return Number(s.bavail) * Number(s.bsize); }
  catch { return Infinity; }
};

/** Stream a complete public file into `file` (created, never overwritten). impure.
 * Interrupted, cut-short or empty bodies fail and remove the partial file.
 * @param {string} target
 * @param {string} file absolute path from the download store, never a tool argument
 * @param {{signal?: AbortSignal}} [options]
 * @returns {Promise<{ok: true, url: string, bytes: number, sha256: string, contentType: string} | {ok: false, error: string}>}
 */
export const streamDownload = async (target, file, { signal } = {}) => {
  let url = target;
  for (let hop = 0; hop <= 5; hop += 1) {
    if (signal?.aborted) return { ok: false, error: 'download cancelled; no file saved' };
    const guard = await assertSafeWebTarget(url);
    if (!guard.ok) return { ok: false, error: `target refused (${guard.reason})` };
    // URL credentials must never become receipt or journal text.
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return { ok: false, error: 'URL credentials are not supported' };
    const { res, error } = await requestWebOnce(url, guard.addrs, { signal });
    if (error) return { ok: false, error: 'download connection failed or was interrupted; no file saved' };
    if (res.statusCode >= 300 && res.statusCode < 400) {
      const next = nextRedirectUrl(url, res.headers.location);
      res.destroy();
      if (!next) return { ok: false, error: 'redirect has no usable Location' };
      url = next;
      continue;
    }
    if (res.statusCode !== 200) {
      res.destroy();
      return { ok: false, error: `download answered HTTP ${res.statusCode}; no file saved` };
    }
    const contentType = String(res.headers['content-type'] || 'application/octet-stream').split(';')[0].trim();
    const encoding = res.headers['content-encoding'];
    if (encoding && encoding !== 'identity') {
      res.destroy();
      return { ok: false, error: 'server returned encoded bytes without a decoding agreement; no file saved' };
    }
    const declared = Number(res.headers['content-length']) || 0;
    const free = await freeBytes(path.dirname(file));
    if (declared > free) {
      res.destroy();
      return { ok: false, error: `download is ${declared} bytes and the disk has ${free} free; no file saved` };
    }
    const hash = createHash('sha256');
    let bytes = 0;
    const count = new Transform({ transform(chunk, _enc, done) { hash.update(chunk); bytes += chunk.length; done(null, chunk); } });
    try {
      await pipeline(res, count, fs.createWriteStream(file, { flags: 'wx', mode: 0o600 }), { signal });
    } catch {
      await fs.promises.rm(file, { force: true });
      return { ok: false, error: 'download interrupted or could not be written; no file saved' };
    }
    if (!res.complete || (declared && bytes !== declared) || !bytes) {
      await fs.promises.rm(file, { force: true });
      return { ok: false, error: bytes ? 'download incomplete; no file saved' : 'download is empty; no file saved' };
    }
    return { ok: true, url, bytes, sha256: hash.digest('hex'), contentType };
  }
  return { ok: false, error: 'too many redirects (>5); no file saved' };
};
