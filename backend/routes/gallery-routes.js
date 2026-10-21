/**
 * THE GALLERY — the operator's view of every image and video NEUMA can reach.
 *
 * Design note, 2026-08-01: […]
 *
 * The reach is the root allowlist and nothing else (gallery-roots.js). Three
 * properties hold on every request here:
 *   • A client names a ROOT ID and a ROOT-RELATIVE path. It never sends an
 *     absolute path, so there is no path to traverse with.
 *   • Serving realpath-resolves and re-checks containment, so a symlink inside
 *     an allowed folder cannot walk out of it.
 *   • Everything requires auth. This is an operator surface; no being tool
 *     reads it (Founder's call, 2026-08-01).
 *
 * /file is a FILE SERVER, not an API verb. A gallery is an image viewer: the
 * browser should be able to point an <img>/<video> at a path and be left alone
 * to load, decode, cache and evict it. Two things here make that possible —
 * a ?token= query (an element's own GET carries no Authorization header) and
 * real cache validators (see the route).
 */
import path from 'path';
import { createReadStream } from 'fs';
import { promises as fs } from 'fs';
import express from 'express';
import { requireAuth } from '../services/auth.js';
import { createLogger } from '../services/logger.js';
import { resolveComfyConfig } from '../services/image-forge/comfyui-supervisor.js';
import {
  allRoots, rootById, readStoredRoots, writeStoredRoots, applyRootChange,
} from '../services/gallery/gallery-roots.js';
import { scanRoot, resolveInRoot, mimeOf } from '../services/gallery/media-scan.js';
import { requestState } from '../../core/runtime/operator-state.js';
import { deskStanding, requireInstallOwner } from '../services/install-owner.js';
import { houseGroundsOf } from '../services/explorer-ground.js';
import { isWithin } from '../services/ground-roots.js';

const log = createLogger('Gallery.Routes');
const router = express.Router();

// A native <img src> / <video src> issues the browser's OWN bare GET — it can
// carry no Authorization header, which is the entire reason the desk used to
// fetch every thumbnail by hand into an object URL. So for /file ONLY, a
// ?token= query is mapped into the header BEFORE the blanket requireAuth runs:
// the same session token, the same verification, nothing else loosened. The
// portal's WS and /user-files/raw already ride this law.
router.use((req, res, next) => {
  if (req.path === '/file' && !req.headers.authorization && typeof req.query.token === 'string' && req.query.token) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  next();
});
router.use(requireAuth);

// Scoped to the CALLING wallet: a being's art root is its own house's, and the
// gallery never shows another wallet's beings.
// A harness desk is not shown the house's beings' art (operator-state.js).
// The added folders and the ComfyUI output are the machine's, like the
// explorer's opened folders (explorer-ground.js): its owner sees them all, a
// guest house only those inside its own house. Its beings' art is always its own.
const roots = async (req) => {
  const all = await allRoots(resolveComfyConfig(process.env),
    requestState(req.headers) === 'harness' ? null : req.walletAddress);
  if (['owner', 'co-owner'].includes(await deskStanding(req))) return all;
  const grounds = await houseGroundsOf(req.walletAddress);
  return all.filter((root) => root.being || grounds.some((ground) => isWithin(root.dir, ground)));
};

// The folders the gallery reads. `builtIn` marks the ComfyUI output root, which
// the UI shows as un-removable.
router.get('/roots', async (req, res) => {
  try {
    res.json({ roots: await roots(req) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add a folder — THE GRANT. Proven to exist and to be a directory before it is
// stored, so a typo becomes an error now rather than an empty gallery later.
// The folder list is the machine's: its owner adds and removes, at its desk.
router.post('/roots', requireInstallOwner, async (req, res) => {
  try {
    const dir = String(req.body?.dir || '');
    // ABSOLUTE FIRST, then stat. A relative path stats against the backend's
    // cwd, so `dir: "data"` would pass the existence check and only then be
    // refused for a different reason — an ambiguous path must never be resolved
    // against the server's working directory at all (echo r1, Grok).
    if (!path.isAbsolute(dir)) return res.status(400).json({ error: 'a root must be an absolute path' });
    try {
      const st = await fs.stat(dir);
      if (!st.isDirectory()) return res.status(400).json({ error: 'that path is not a folder' });
    } catch {
      return res.status(400).json({ error: 'that folder does not exist or cannot be read' });
    }
    const change = applyRootChange(await readStoredRoots(), { op: 'add', dir, label: req.body?.label });
    if (!change.ok) return res.status(400).json({ error: change.error });
    await writeStoredRoots(change.roots);
    log.info('gallery root added', { dir, by: req.walletAddress });
    return res.json({ roots: await roots(req) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/roots/:id', requireInstallOwner, async (req, res) => {
  try {
    const change = applyRootChange(await readStoredRoots(), { op: 'remove', id: req.params.id });
    if (!change.ok) return res.status(400).json({ error: change.error });
    await writeStoredRoots(change.roots);
    return res.json({ roots: await roots(req) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Everything in reach. `?rootId=` narrows to one folder; omitted scans them all.
// A root that has gone missing (unplugged drive, deleted folder) reports its
// error beside the others rather than failing the whole gallery.
router.get('/items', async (req, res) => {
  try {
    const list = await roots(req);
    const wanted = req.query.rootId ? list.filter((r) => r.id === req.query.rootId) : list;
    const scans = await Promise.all(wanted.map(async (r) => ({ root: r, ...(await scanRoot(r)) })));
    res.set('Cache-Control', 'no-store');
    res.json({
      items: scans.flatMap((s) => s.items),
      roots: scans.map((s) => ({
        id: s.root.id, label: s.root.label, dir: s.root.dir, builtIn: Boolean(s.root.builtIn),
        count: s.items.length, truncated: s.truncated, error: s.error,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * One RFC 7233 byte range against a known size, or null when unsatisfiable.
 * PURE, and exported so the three forms are testable without a socket.
 *
 * The SUFFIX form is the one that bites: `bytes=-500` means […], not […]. Reading `match[1]` as a plain falsy check
 * served the FIRST 500 bytes instead — silently wrong data, with a 206 claiming
 * it was correct (echo r1, both lenses).
 *
 * @param {[string, string, string]} match /^bytes=(\d*)-(\d*)$/ groups
 * @param {number} size
 * @returns {{start: number, end: number}|null}
 */
export const parseByteRange = (match, size) => {
  const [, first, last] = match;
  if (size <= 0) return null;
  if (!first && !last) return null;            // `bytes=-` names nothing
  let start;
  let end;
  if (!first) {
    // Suffix: the last N bytes, clamped to the whole file.
    const n = Number(last);
    if (!Number.isFinite(n) || n <= 0) return null;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(first);
    end = last ? Math.min(Number(last), size - 1) : size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end || start >= size || start < 0) return null;
  return { start, end };
};

/**
 * The tag that lets a browser ask […] instead of pulling the
 * bytes again. Size + mtime, so an overwritten render invalidates on its own.
 * PURE.
 * @param {{size: number, mtimeMs: number}} st
 * @returns {string}
 */
export const fileEtag = (st) =>
  `"${st.size.toString(16)}-${Math.round(st.mtimeMs).toString(16)}"`;

// The bytes. Range-enabled because a <video> element needs it — without a 206
// answer a browser will not scrub, and some will not play at all.
//
// STORABLE, deliberately. `no-store` meant a grid of 1.5 MB renders was
// re-downloaded in full every time the operator scrolled back over it — bytes
// on disk are not a live API answer, they are a file.
//
// `no-cache` rather than a max-age: it permits the browser to KEEP the bytes
// (which is the whole fix) while still asking every time. Over loopback that
// question costs a sub-millisecond 304 instead of a megabyte, and buys the one
// property a viewer must not trade away — a re-rendered file is never shown as
// its old self because a timer has not expired yet.
router.get('/file', async (req, res) => {
  try {
    const root = rootById(await roots(req), String(req.query.rootId || ''));
    // An unknown root id and an escaping path answer identically: a caller
    // learns nothing about what exists outside its reach.
    if (!root) return res.status(404).json({ error: 'not found' });
    const real = await resolveInRoot(root, req.query.rel);
    if (!real) return res.status(404).json({ error: 'not found' });

    const st = await fs.stat(real);
    const mime = mimeOf(real);
    const etag = fileEtag(st);
    res.set('Cache-Control', 'private, no-cache');
    res.set('ETag', etag);
    res.set('Last-Modified', st.mtime.toUTCString());
    res.set('Accept-Ranges', 'bytes');

    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');

    // Answer the cheap question first — but only for a whole-file request. A
    // conditional RANGE is the <video> element resuming a partial read; a 304
    // there hands it no bytes to resume with.
    if (!match && req.headers['if-none-match'] === etag) return res.status(304).end();

    res.set('Content-Type', mime);
    if (match) {
      const range = parseByteRange(match, st.size);
      if (!range) {
        res.set('Content-Range', `bytes */${st.size}`);
        return res.status(416).end();
      }
      const { start, end } = range;
      res.status(206);
      res.set('Content-Range', `bytes ${start}-${end}/${st.size}`);
      res.set('Content-Length', String(end - start + 1));
      return createReadStream(real, { start, end }).pipe(res);
    }

    res.set('Content-Length', String(st.size));
    return createReadStream(real).pipe(res);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
