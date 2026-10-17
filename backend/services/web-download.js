/** Original web bytes for local assets. No text extraction or preview truncation. */
import { assertSafeWebTarget, nextRedirectUrl } from './web-guard.js';
import { requestWebOnce, readBounded } from './web-fetch.js';

export const DOWNLOAD_MAX_BYTES = 10 * 1024 * 1024;

/** Fetch a complete public file; interrupted/oversized bodies never succeed. impure.
 * @param {string} target
 * @param {{signal?: AbortSignal}} [options]
 */
export const fetchDownloadBytes = async (target, { signal } = {}) => {
  let url = target;
  const deadline = AbortSignal.timeout(30_000);
  const boundedSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  for (let hop = 0; hop <= 5; hop += 1) {
    if (boundedSignal.aborted) return { ok: false, error: 'download interrupted or timed out; no file saved' };
    const guard = await assertSafeWebTarget(url);
    if (!guard.ok) return { ok: false, error: `target refused (${guard.reason})` };
    // URL credentials must never become receipt or journal text.
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return { ok: false, error: 'URL credentials are not supported' };
    const { res, error } = await requestWebOnce(url, guard.addrs, { signal: boundedSignal });
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
    if (Number(res.headers['content-length']) > DOWNLOAD_MAX_BYTES) {
      res.destroy();
      return { ok: false, error: 'download exceeds the 10 MiB limit; no file saved' };
    }
    const { buf, truncated } = await readBounded(res, DOWNLOAD_MAX_BYTES);
    if (truncated || !res.complete || boundedSignal.aborted) {
      return { ok: false, error: 'download incomplete, interrupted, or over 10 MiB; no file saved' };
    }
    if (!buf.length) return { ok: false, error: 'download is empty; no file saved' };
    return { ok: true, url, bytes: buf, contentType };
  }
  return { ok: false, error: 'too many redirects (>5); no file saved' };
};
