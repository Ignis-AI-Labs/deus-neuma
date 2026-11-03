/** Downloads are opaque source files, never automatically executed or served inline. */
import fs from 'node:fs/promises';
import path from 'node:path';

/** A local filename, never a caller-selected directory. Pure. */
export const validDownloadName = (name) => typeof name === 'string'
  && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(name);

/** Save a download in a unique directory beneath an existing lane. impure.
 * `fill(file)` writes the file (web-download.js streamDownload) and reports
 * { ok, url, bytes, sha256, contentType } or { ok: false, error }; a failed
 * fill leaves no asset directory behind.
 * @param {string} laneRoot Trusted workspace resolver output, never a tool argument.
 * @param {{name: string, sourceUrl: (url: string) => string}} incoming sourceUrl makes the receipt's public form of the final URL
 * @param {(file: string) => Promise<object>} fill
 * @param {{signal?: AbortSignal}} [options]
 */
export const saveDownload = async (laneRoot, { name, sourceUrl = (u) => u }, fill, { signal } = {}) => {
  if (!validDownloadName(name)) throw new Error('name must be a filename using letters, digits, dots, underscores or hyphens (max 120)');
  signal?.throwIfAborted();
  const root = await fs.realpath(laneRoot);
  const downloads = path.join(root, 'downloads');
  try { await fs.mkdir(downloads, { mode: 0o700 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const info = await fs.lstat(downloads);
  if (!info.isDirectory() || info.isSymbolicLink() || await fs.realpath(downloads) !== downloads) {
    throw new Error('downloads must be a real directory inside this workspace');
  }
  const directory = await fs.mkdtemp(path.join(downloads, 'asset-'));
  try {
    const file = path.join(directory, name);
    const got = await fill(file);
    if (!got.ok) { await fs.rm(directory, { recursive: true, force: true }); return got; }
    const stored = await fs.stat(file);
    if (stored.size !== got.bytes) throw new Error('download on disk does not match the bytes received');
    const receipt = Object.freeze({ path: file, bytes: got.bytes, sha256: got.sha256, contentType: got.contentType, sourceUrl: sourceUrl(got.url) });
    await fs.writeFile(path.join(directory, '.receipt.json'), JSON.stringify(receipt), { flag: 'wx', mode: 0o600, signal });
    signal?.throwIfAborted();
    return { ok: true, receipt };
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
};
