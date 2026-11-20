// managed-ollama-download — a pinned download onto this disk, whole and verified, then unpacked:
// the Ollama archive (managed-ollama.js), and the llama.cpp engine and model files
// (managed-engine.js). An asset's `label` names it in what a person reads (Ollama when it has none).
// impure (network, fs, child processes). Imports neither of its users.
//
// THE CAUSE IT ANSWERS (2026-10-23, a fresh Linux user): […]. The pin was right (GitHub's own digest, and the real bytes hash to it). Two
// presses of SET IT UP FOR ME had started two jobs on ONE .part: the second resumed the file the
// first was still writing, hashed past the length it had measured, and appended into it. So the
// archive is judged by the FILE ON DISK, never by the bytes a stream saw, a resume appends only
// where the server says its bytes begin, and a damaged, short or wrong download is tried again here
// before anyone is told.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setupFailure as failure } from './managed-ollama-errors.js';

/** How many times one setup downloads the archive before it says so. */
export const DOWNLOAD_TRIES = 3;

// pure — what the download is called where a person reads it
const named = (asset) => asset.label || 'Ollama';

/** The SHA-256 of a file on disk. impure */
const fileSha256 = async (file) => {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
};

// impure — bytes on disk, or -1 when the file (or its folder) is gone
const sizeOf = (file) => { try { return fs.statSync(file).size; } catch { return -1; } };

/** Where a 206 says its bytes begin, or null. Pure. */
export const rangeStart = (contentRange) => {
  const m = /^bytes (\d+)-/.exec(String(contentRange || ''));
  return m ? Number(m[1]) : null;
};

/**
 * One request into the .part: resume it where the server agrees it stops, else start it over.
 * Moves bytes only; the caller judges the file. impure
 */
const fetchInto = async (asset, part, signal, onBytes) => {
  await fsp.mkdir(path.dirname(part), { recursive: true });
  let have = Math.max(0, sizeOf(part));
  if (have > asset.size) { await fsp.rm(part, { force: true }); have = 0; }
  if (have === asset.size) return;
  const what = named(asset);
  const res = await fetch(asset.url, { signal, redirect: 'follow', headers: have ? { Range: `bytes=${have}-` } : {} });
  if (!res.ok || !res.body) throw failure('DOWNLOAD_HTTP', `the ${what} download answered HTTP ${res.status}`);
  const type = res.headers.get('content-type') || '';
  if (/^text\//i.test(type)) {
    await res.body.cancel();
    throw failure('DOWNLOAD_PAGE', `the ${what} download answered with a web page (${type}), not the file`);
  }
  if (res.status === 206 && rangeStart(res.headers.get('content-range')) !== have) {
    await res.body.cancel();
    await fsp.rm(part, { force: true });
    throw failure('DOWNLOAD_NETWORK', `the ${what} download resumed at the wrong place; starting it over`);
  }
  if (res.status !== 206) have = 0;
  const length = Number(res.headers.get('content-length'));
  if (length > 0 && have + length !== asset.size) {
    await res.body.cancel();
    throw failure('DOWNLOAD_SIZE', `the ${what} download is ${have + length} bytes, not the ${asset.size} published`);
  }
  onBytes(have);
  const count = new Transform({ transform(chunk, _e, cb) { have += chunk.length; onBytes(have); cb(null, chunk); } });
  await pipeline(Readable.fromWeb(res.body), count, fs.createWriteStream(part, { flags: have > 0 ? 'a' : 'w' }), { signal });
};

/**
 * The pinned archive, whole and verified, at `archive`. One already there that hashes to the pin
 * is used as it is; one that does not is removed. Then up to `tries` downloads: a short one resumes,
 * a damaged one is removed and fetched again, and only after the last try does it throw. impure
 * @param {{name: string, url: string, size: number, sha256: string}} asset
 * @param {string} archive
 * @param {{signal?: AbortSignal, onBytes?: (n: number) => void, onLine?: (s: string) => void, tries?: number}} [opts]
 * @returns {Promise<'kept'|'downloaded'>}
 */
export const obtainArchive = async (asset, archive, { signal, onBytes = () => {}, onLine = () => {}, tries = DOWNLOAD_TRIES } = {}) => {
  const what = named(asset);
  if (fs.existsSync(archive)) {
    onLine(`Checking the ${what} download already on this disk`);
    if (await fileSha256(archive) === asset.sha256) return 'kept';
    await fsp.rm(archive, { force: true });
  }
  const part = `${archive}.part`;
  let last = null;
  for (let n = 1; n <= tries; n += 1) {
    if (n > 1) onLine(`Downloading ${what} again (try ${n} of ${tries})`);
    try {
      await fetchInto(asset, part, signal, onBytes);
    } catch (err) {
      if (signal?.aborted) throw err;
      last = err.code?.startsWith('DOWNLOAD_') ? err : failure('DOWNLOAD_NETWORK', `the ${what} download stopped: ${err.message}`);
      continue;
    }
    const size = sizeOf(part);
    // short (the connection closed early) or gone (its folder was removed): the next try fetches it
    if (size !== asset.size) { last = failure('DOWNLOAD_NETWORK', `the ${what} download stopped at ${Math.max(0, size)} of ${asset.size} bytes`); continue; }
    if (await fileSha256(part) !== asset.sha256) {
      await fsp.rm(part, { force: true });
      last = failure('DOWNLOAD_DAMAGED', `${asset.name} did not hash to its pinned SHA-256 after ${n} download${n === 1 ? '' : 's'}`);
      continue;
    }
    try { await fsp.rename(part, archive); return 'downloaded'; } catch (err) { last = err; }
  }
  throw last;
};

// Windows' own bsdtar by its full path: a GNU tar earlier on the PATH (Git for Windows) cannot read a zip
const TAR = process.platform === 'win32'
  ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
  : 'tar';

/** Unpack with the system's own tar (Linux tar, Windows 10+ bsdtar): zip, tar.gz or tar.zst. impure */
export const unpackArchive = async (asset, archive, dir) => {
  const tarRun = (args, input) => new Promise((resolve, reject) => {
    const p = spawn(TAR, args, { stdio: [input ? 'pipe' : 'ignore', 'ignore', 'pipe'], windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(failure('UNPACK', `unpacking failed (tar exit ${code}): ${err.trim().split('\n').pop() || ''}`))));
    if (input) pipeline(fs.createReadStream(archive), zlib.createZstdDecompress(), p.stdin).catch(reject);
  });
  if (asset.format === 'zip') return tarRun(['-xf', archive, '-C', dir]);
  if (asset.format === 'tar.gz') return tarRun(['-xzf', archive, '-C', dir]);
  if (typeof zlib.createZstdDecompress === 'function') return tarRun(['-x', '-C', dir], true);
  return tarRun(['--zstd', '-xf', archive, '-C', dir]);
};

/**
 * Unpack a verified archive into `dir` (beside it first, so a failed unpack never leaves half a
 * server), then remove the archive. impure
 * @returns {Promise<string>} the server binary
 */
export const installArchive = async (asset, archive, dir) => {
  const tmp = `${dir}.unpacking`;
  await fsp.rm(tmp, { recursive: true, force: true });
  await fsp.mkdir(tmp, { recursive: true });
  await unpackArchive(asset, archive, tmp);
  if (!fs.existsSync(path.join(tmp, asset.bin))) throw failure('UNPACK', `the ${named(asset)} archive did not hold ${asset.bin}`);
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.rename(tmp, dir);
  const bin = path.join(dir, asset.bin);
  if (process.platform !== 'win32') await fsp.chmod(bin, 0o755);
  await fsp.rm(archive, { force: true });
  return bin;
};
