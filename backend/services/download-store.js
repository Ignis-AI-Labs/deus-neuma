/** Downloads are opaque source files, never automatically executed or served inline. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DOWNLOAD_MAX_BYTES } from './web-download.js';

/** A local filename, never a caller-selected directory. Pure. */
export const validDownloadName = (name) => typeof name === 'string'
  && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(name);

/** Save complete bytes in a unique directory beneath an existing lane. impure.
 * @param {string} laneRoot Trusted workspace resolver output, never a tool argument.
 * @param {{name: string, bytes: Buffer, url: string, contentType: string}} incoming
 * @param {{signal?: AbortSignal}} [options]
 */
export const saveDownload = async (laneRoot, incoming, { signal } = {}) => {
  const { name, bytes, url, contentType } = incoming;
  if (!validDownloadName(name)) throw new Error('name must be a filename using letters, digits, dots, underscores or hyphens (max 120)');
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > DOWNLOAD_MAX_BYTES) {
    throw new Error('download must contain complete bytes within the 10 MiB limit');
  }
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
    await fs.writeFile(file, bytes, { flag: 'wx', mode: 0o600, signal });
    const stored = await fs.readFile(file);
    if (!stored.equals(bytes)) throw new Error('download read-back did not match original bytes');
    const receipt = Object.freeze({ path: file, bytes: stored.length, sha256: createHash('sha256').update(stored).digest('hex'), contentType, sourceUrl: url });
    await fs.writeFile(path.join(directory, '.receipt.json'), JSON.stringify(receipt), { flag: 'wx', mode: 0o600, signal });
    signal?.throwIfAborted();
    return receipt;
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
};
