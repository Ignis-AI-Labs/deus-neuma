/**
 * THE GALLERY's SCAN — what is in a root, and what kind of thing it is.
 *
 * Design note, 2026-08-01: […]
 *
 * Kind is decided by EXTENSION, deliberately, not by sniffing bytes: a gallery
 * listing a folder of ten thousand files must not open ten thousand files to
 * draw a grid. The byte-level question only matters when something is actually
 * served, and the serve path answers it with a content-type it controls.
 *
 * The walk is bounded on both axes — depth and count — because a root the
 * operator adds could be a home directory. An unbounded recursive scan behind
 * an HTTP request is a way to hang the backend with one careless click.
 */
import path from 'path';
import { promises as fs } from 'fs';
import { createLogger } from '../logger.js';

const log = createLogger('Gallery.Scan');

/** How deep below a root the scan will walk. */
export const MAX_DEPTH = 6;
/** How many media files one root will yield before the scan stops. */
export const MAX_ITEMS = 4000;

const IMAGE_EXT = Object.freeze(new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif', '.tif', '.tiff',
]));
const VIDEO_EXT = Object.freeze(new Set([
  '.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v', '.gifv',
]));

const MIME = Object.freeze({
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.bmp': 'image/bmp', '.avif': 'image/avif', '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.m4v': 'video/x-m4v',
  '.gifv': 'video/mp4',
});

/**
 * The kind of media a filename names: 'image' | 'video' | null. Pure.
 * null means "not media" — the scan skips it entirely.
 */
export const kindOf = (name) => {
  const ext = path.extname(String(name || '')).toLowerCase();
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  return null;
};

/** The content-type to serve a filename as. Pure. */
export const mimeOf = (name) => MIME[path.extname(String(name || '')).toLowerCase()] || 'application/octet-stream';

/**
 * Is `target` really inside `root`? Pure over already-resolved REAL paths.
 *
 * The `${root}${sep}` suffix matters: a plain startsWith would let
 * `/media/photos-private` pass as inside `/media/photos`.
 */
export const isInsideRoot = (realTarget, realRoot) => {
  if (!realTarget || !realRoot) return false;
  if (realTarget === realRoot) return true;
  return realTarget.startsWith(realRoot.endsWith(path.sep) ? realRoot : `${realRoot}${path.sep}`);
};

/**
 * Walk one root for media. impure (fs).
 *
 * Symlinked DIRECTORIES are not followed: following them is how a scan escapes
 * its root and how it loops forever on a cycle. Symlinked FILES are resolved
 * and kept only if their real path is still inside the root.
 *
 * @param {{id: string, label: string, dir: string}} root
 * @returns {Promise<{items: Array<object>, truncated: boolean, error: string|null}>}
 */
export const scanRoot = async (root) => {
  const items = [];
  let truncated = false;
  let realRoot;
  try {
    realRoot = await fs.realpath(root.dir);
  } catch (err) {
    return { items, truncated: false, error: err.code === 'ENOENT' ? 'folder not found' : err.message };
  }

  const walk = async (dir, depth) => {
    if (depth > MAX_DEPTH || items.length >= MAX_ITEMS) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      log.warn('gallery scan could not read a folder', { dir, err: err.message });
      return;
    }
    for (const entry of entries) {
      if (items.length >= MAX_ITEMS) { truncated = true; return; }
      if (entry.name.startsWith('.')) continue; // hidden files are not gallery content
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { await walk(full, depth + 1); continue; }
      if (entry.isSymbolicLink()) {
        // Resolve, and keep ONLY if it still lands inside the root.
        try {
          const real = await fs.realpath(full);
          if (!isInsideRoot(real, realRoot)) continue;
          const st = await fs.stat(real);
          if (!st.isFile()) continue;
        } catch { continue; }
      } else if (!entry.isFile()) continue;

      const kind = kindOf(entry.name);
      if (!kind) continue;
      let st;
      try { st = await fs.stat(full); } catch { continue; }
      items.push({
        rootId: root.id,
        rootLabel: root.label,
        // Root-relative: the id the serve route takes. An absolute path is
        // never accepted from a client, so there is no path to traverse with.
        rel: path.relative(realRoot, full),
        name: entry.name,
        kind,
        mime: mimeOf(entry.name),
        bytes: st.size,
        modified: st.mtimeMs,
      });
    }
  };

  await walk(realRoot, 0);
  return { items, truncated, error: null };
};

/**
 * Resolve a client-supplied root-relative path to a real file inside its root,
 * or null. impure (fs) — the containment check needs the REAL path, because
 * that is the only form a symlink cannot lie about.
 * @returns {Promise<string|null>} absolute real path, or null if it escapes
 */
export const resolveInRoot = async (root, rel) => {
  const relative = String(rel || '');
  // Reject absolute inputs and obvious traversal before touching the disk.
  if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) return null;
  try {
    const realRoot = await fs.realpath(root.dir);
    const real = await fs.realpath(path.join(realRoot, relative));
    if (!isInsideRoot(real, realRoot)) return null;
    const st = await fs.stat(real);
    return st.isFile() ? real : null;
  } catch {
    return null;
  }
};
