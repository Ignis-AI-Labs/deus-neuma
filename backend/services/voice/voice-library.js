// THE VOICE LIBRARY — curated voices the forge's library door offers.
//
// The manifest (voice-library.json, beside this file) is the whole library:
// for every voice its licence, its attribution, where it comes from, the
// sha256 of the exact file, its pitch band (higher / lower), its accent and
// register (feminine / masculine) as the source gives them, and the words
// spoken in it (transcribed once, pinned, so finding a library voice needs no
// speech-to-text). Every entry is CC0 or CC BY 4.0;
// a CC BY voice carries its attribution wherever it is shown.
//
// The clips themselves are NEVER committed: each is downloaded on demand into
// the writable voice data root and checked against its pinned sha256 before a
// byte of it is used — on download and again on every read, so a file changed
// on disk is refused, never cloned.

import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const MANIFEST_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'voice-library.json');
const LIBRARY = Object.freeze(JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')));

// A library clip is seconds of audio; anything near this is not one.
const CLIP_MAX_BYTES = 20 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const SHA256 = /^[0-9a-f]{64}$/;
const FORMAT = /^[a-z0-9]{2,5}$/;

/**
 * The writable root for voice data that is downloaded, never shipped
 * (NEUMA_VOICE_DATA_ROOT, else ~/.neuma/voice). impure (reads env)
 */
export const voiceDataRoot = () => process.env.NEUMA_VOICE_DATA_ROOT || path.join(os.homedir(), '.neuma', 'voice');

/** pure — what any surface may show of an entry (the raw file URL stays here: the backend fetches it, never the desk). */
const publicEntry = ({ id, name, about, accent, register, licence, attribution, pitch, seconds }) =>
  Object.freeze({ id, name, about, accent, register, licence, attribution, pitch, seconds });

/**
 * The library, optionally only the higher or lower voices. Pure over the
 * manifest.
 * @param {{pitch?: 'higher'|'lower'}} [filter]
 */
export const listLibrary = ({ pitch } = {}) =>
  LIBRARY.voices.filter((v) => !pitch || v.pitch === pitch).map(publicEntry);

/** pure — the manifest entry with this id, or null. */
export const libraryEntry = (id) => LIBRARY.voices.find((v) => v.id === id) ?? null;

const sha256Of = (bytes) => createHash('sha256').update(bytes).digest('hex');

// impure — the cached file's bytes when present AND still the pinned bytes.
const readCached = async (file, sha256) => {
  try {
    const bytes = await readFile(file);
    return sha256Of(bytes) === sha256 ? bytes : null;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
};

/**
 * A library clip's bytes: from the local cache when they still hash to the
 * pin, else downloaded from the entry's source, checked, and cached (tmp +
 * rename, so a half-written file never sits under the final name). A source
 * that answers with other bytes is refused and nothing is kept. impure
 * @param {{id: string, source: string, sha256: string, format: string}} entry
 * @param {{root?: string}} [opts]
 * @returns {Promise<Buffer>}
 */
export const fetchLibraryClip = async (entry, { root = voiceDataRoot() } = {}) => {
  if (!SHA256.test(entry?.sha256 ?? '') || !FORMAT.test(entry?.format ?? '')) {
    throw new Error(`library entry '${entry?.id}' has no valid sha256 pin and format`);
  }
  const dir = path.join(root, 'library');
  const file = path.join(dir, `${entry.sha256}.${entry.format}`);
  const cached = await readCached(file, entry.sha256);
  if (cached) return cached;

  let res;
  try {
    res = await fetch(entry.source, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  } catch (err) {
    throw Object.assign(new Error(`could not download library voice '${entry.id}': ${err.message}`), { status: 502 });
  }
  if (!res.ok) throw Object.assign(new Error(`library voice '${entry.id}' download answered ${res.status}`), { status: 502 });
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > CLIP_MAX_BYTES) throw Object.assign(new Error(`library voice '${entry.id}' is too large`), { status: 502 });
  if (sha256Of(bytes) !== entry.sha256) {
    throw Object.assign(new Error(`library voice '${entry.id}' did not match its pinned sha256 — refused`), { status: 502 });
  }
  await mkdir(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, bytes);
  await rename(tmp, file);
  return bytes;
};
