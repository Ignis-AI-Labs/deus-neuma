/** Original web bytes, streamed to a file. No text extraction or preview truncation. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { assertSafeWebTarget, nextRedirectUrl } from './web-guard.js';
import { requestWebOnce } from './web-fetch.js';
import { screenWebEgress } from './web-egress-screen.js';

// Approval decides whether bytes may leave; resource bounds keep a hostile or
// lying server from exhausting the filesystem that holds the install's keys.
export const MAX_DOWNLOAD_BYTES = 1024 ** 3;
export const DOWNLOAD_FREE_RESERVE_BYTES = 64 * 1024 ** 2;

// impure — bytes free to this process where the file will land.
const freeBytes = async (directory) => {
  try { const s = await fs.promises.statfs(directory); return Number(s.bavail) * Number(s.bsize); }
  catch { return Infinity; }
};

// impure — count, hash and forward only chunks inside both resource bounds.
export const downloadByteGuard = ({
  directory, hash, onBytes,
  maxBytes = MAX_DOWNLOAD_BYTES,
  reserveBytes = DOWNLOAD_FREE_RESERVE_BYTES,
}) => {
  let bytes = 0;
  return new Transform({
    transform(chunk, _encoding, done) {
      const next = bytes + chunk.length;
      if (next > maxBytes) {
        done(Object.assign(new Error('download exceeds its byte limit'), { code: 'DOWNLOAD_TOO_LARGE' }));
        return;
      }
      freeBytes(directory).then((free) => {
        if (next + reserveBytes > free) {
          done(Object.assign(new Error('download would exhaust free disk space'), { code: 'DOWNLOAD_NO_SPACE' }));
          return;
        }
        hash.update(chunk);
        bytes = next;
        onBytes(bytes);
        done(null, chunk);
      }).catch(done);
    },
  });
};

/** Stream a complete public file into `file` (created, never overwritten). impure.
 * Interrupted, cut-short or empty bodies fail and remove the partial file.
 * @param {string} target
 * @param {string} file absolute path from the download store, never a tool argument
 * @param {{signal?: AbortSignal, maxBytes?: number, reserveBytes?: number}} [options]
 * @returns {Promise<{ok: true, url: string, bytes: number, sha256: string, contentType: string} | {ok: false, error: string}>}
 */
// `headersFor(url)` gives each hop its own extra headers — a login that belongs to one host is asked for that host's
// address and never rides a redirect to another (image-forge/model-install.js: the Hugging Face token, huggingface.co only).
export const streamDownload = async (target, file, {
  signal, maxBytes = MAX_DOWNLOAD_BYTES, reserveBytes = DOWNLOAD_FREE_RESERVE_BYTES, headersFor = null,
} = {}) => {
  let url = target;
  for (let hop = 0; hop <= 5; hop += 1) {
    if (signal?.aborted) return { ok: false, error: 'download cancelled; no file saved' };
    // Every hop is egress, and so is the name lookup the guard makes: the named address is read
    // for any secret, a redirect for this machine's own, before anything leaves (audit P6-04).
    const secret = screenWebEgress('the download address', url, { redirect: hop > 0 });
    if (!secret.ok) return { ok: false, error: `${secret.reason} No file saved.` };
    const guard = await assertSafeWebTarget(url);
    if (!guard.ok) return { ok: false, error: `target refused (${guard.reason})` };
    // URL credentials must never become receipt or journal text.
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return { ok: false, error: 'URL credentials are not supported' };
    const { res, error } = await requestWebOnce(url, guard.addrs, { signal, headers: headersFor?.(url) ?? {} });
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
    if (declared > maxBytes) {
      res.destroy();
      return { ok: false, error: `download is over the ${maxBytes}-byte limit; no file saved` };
    }
    if (declared + reserveBytes > free) {
      res.destroy();
      return { ok: false, error: `download is ${declared} bytes and the disk has ${free} free; no file saved` };
    }
    const hash = createHash('sha256');
    let bytes = 0;
    const count = downloadByteGuard({
      directory: path.dirname(file), hash, onBytes: (n) => { bytes = n; }, maxBytes, reserveBytes,
    });
    try {
      await pipeline(res, count, fs.createWriteStream(file, { flags: 'wx', mode: 0o600 }), { signal });
    } catch (error) {
      await fs.promises.rm(file, { force: true });
      if (error.code === 'DOWNLOAD_TOO_LARGE') return { ok: false, error: `download is over the ${maxBytes}-byte limit; no file saved` };
      if (error.code === 'DOWNLOAD_NO_SPACE') return { ok: false, error: 'download would leave too little free disk space; no file saved' };
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
