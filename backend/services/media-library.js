// The media library — the house's culture repository (Design note, 2026-07-28: […]).
//
// Everything here arrived through `media_save` — the ACTS-chipped download —
// so every entry is curated, never accumulated silently. The library keeps
// REAL images only: the bytes are sniffed by their magic header at the door
// (an extension is a claim made by whoever named the file; the header is the
// file itself) and capped at X's still-image ceiling, because a file too
// large for the lane it serves is clutter, not culture.
//
// Each entry carries its provenance — the source URL it was fetched from,
// who saved it, when, and its alt text — because a library the house speaks
// from is part of the record, not a pile of anonymous files. The manifest is
// a whole-file JSON document written atomically (tmp + rename), 0600/0700
// like the sibling social stores. Files themselves are immutable once
// landed: an entry is never overwritten in place, so a path already staged
// on a queued post can never change under the scheduler (media-source's
// re-verify law holds by construction).
//
// Factory shape so tests run the real disk path against tmp roots.

import fs from 'fs/promises';
import crypto from 'crypto';
import { join } from 'path';
import { sniffImageType, MEDIA_MAX_BYTES } from './social/x-media.js';
import { getDataRoot } from './data-root.js';
import { createWriteChain } from './write-chain.js';

const DEFAULT_ROOT = join(getDataRoot(), 'media-library');

// Overridable per call so tests never touch the operator's live library.
export const mediaLibraryRoot = () =>
  process.env.NEUMA_MEDIA_LIBRARY_PATH || DEFAULT_ROOT;

const EXT_FOR = Object.freeze({
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
});

const ALT_MAX = 1000;
const SOURCE_URL_MAX = 2000;

/**
 * @param {{ root?: string|(() => string) }} [opts]
 */
export const createMediaLibrary = (opts = {}) => {
  // Same law as createReplyCandidates: a supplied-but-empty root is a BUG,
  // not a request for the default — never bind silently to the operator's
  // live library because an env var name was mistyped.
  if ('root' in opts && !(typeof opts.root === 'function'
    || (typeof opts.root === 'string' && opts.root.length > 0))) {
    throw new TypeError('createMediaLibrary: `root` was supplied but is not a non-empty string or a function');
  }
  const { root = mediaLibraryRoot } = opts;
  const target = () => (typeof root === 'function' ? root() : root);
  const manifestPath = () => join(target(), 'manifest.json');

  // Serialize mutations — two saves must never interleave a read+write.
  const serialize = createWriteChain();

  // impure — missing manifest = an empty library; a corrupt one surfaces,
  // never collapses to [] (that would silently orphan every landed file).
  const load = async () => {
    let raw;
    try {
      raw = await fs.readFile(manifestPath(), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('media-library: manifest is not an array');
    return parsed;
  };

  const saveManifest = async (entries) => {
    await fs.mkdir(target(), { recursive: true, mode: 0o700 });
    const tmp = `${manifestPath()}.${process.pid}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(entries, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(tmp, manifestPath());
    await fs.chmod(target(), 0o700);
    await fs.chmod(manifestPath(), 0o600);
  };

  return {
    load,

    /** The library's own directory — the root the media-source guard trusts
     *  for attachments. impure only in that it names a place. */
    root: target,

    /**
     * Land one downloaded image in the repository. impure — disk.
     * @param {{bytes: Buffer, sourceUrl?: string, alt?: string, savedBy?: string}} incoming
     * @returns {Promise<{ok: true, entry: object}|{ok: false, detail: string}>}
     */
    save({ bytes, sourceUrl, alt, savedBy } = {}) {
      return serialize(async () => {
        if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
          return { ok: false, detail: 'no bytes were given' };
        }
        if (bytes.length > MEDIA_MAX_BYTES) {
          return { ok: false, detail: `the image is ${(bytes.length / 1024 / 1024).toFixed(1)}MB — over the ${MEDIA_MAX_BYTES / 1024 / 1024}MB ceiling a post can carry` };
        }
        const contentType = sniffImageType(bytes);
        if (!contentType) {
          return { ok: false, detail: 'those bytes are not a JPEG, PNG, GIF or WEBP — the library keeps real images only' };
        }
        const id = crypto.randomBytes(8).toString('hex');
        const file = `${id}${EXT_FOR[contentType]}`;
        await fs.mkdir(target(), { recursive: true, mode: 0o700 });
        await fs.writeFile(join(target(), file), bytes, { mode: 0o600, flag: 'wx' });
        const entries = await load();
        const entry = {
          id,
          file,
          bytes: bytes.length,
          contentType,
          sourceUrl: String(sourceUrl || '').slice(0, SOURCE_URL_MAX),
          alt: String(alt || '').slice(0, ALT_MAX),
          savedBy: String(savedBy || ''),
          savedAt: new Date().toISOString(),
        };
        entries.push(entry);
        await saveManifest(entries);
        return { ok: true, entry };
      });
    },

    /**
     * Every entry with its ABSOLUTE path — the path a being names on
     * `media` when it attaches the file to a post or reply. impure.
     */
    async list() {
      const entries = await load();
      return entries.map((e) => ({ ...e, path: join(target(), e.file) }));
    },

    /** One entry's absolute path by id, or null. impure. */
    async pathFor(id) {
      const entries = await load();
      const found = entries.find((e) => e.id === String(id || ''));
      return found ? join(target(), found.file) : null;
    },
  };
};

// The one instance the tools and the attach path share.
export const mediaLibrary = createMediaLibrary();
