/**
 * Brand Asset Routes — the form spec, the vendored faces, and a brand's marks.
 *
 * Split out of brand-routes.js because those four routes are about ONE KIT'S
 * JSON and these are about the material a kit is assembled from: the shape of
 * the form, the fonts this repository carries, and the artwork on disk. They
 * also have a different security posture — two of them serve BYTES to a bare
 * browser GET — which is easier to reason about when it is not interleaved with
 * a JSON CRUD surface.
 *
 * GET  /form                  — how a kit is edited: sections, fields, controls
 * GET  /faces                 — the vendored families and the weights that exist
 * GET  /faces/:id/file        — one face's bytes, for a real @font-face
 * GET  /:brand/marks          — the marks this brand carries, as data URIs
 * POST /:brand/marks          — put an SVG into the kit's own marks/ folder
 *
 * MOUNTED BEFORE brand-routes.js's `/:brand`, or Express reads "form" and
 * "faces" as brand names — the same ordering `/:brand/new` already depends on.
 */
import { Router } from 'express';
import multer from 'multer';
import { readFile, mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { createLogger } from '../services/logger.js';
import { kitForm } from '../services/branding/kit-form.js';
import { families, faceFile } from '../services/branding/font-registry.js';
import { requiredColors, requiredType, requiredMarks } from '../services/branding/template-tokens.js';
import { loadMarks, brandsDir } from '../services/branding/brand-tokens.js';
import { readKit, brandNameRefusal } from '../services/branding/kit-store.js';
import { workspaceBrandsDir } from '../services/branding/kit-locate.js';

const router = Router();
const log = createLogger('Brands.Assets');

// ⚠️ Auth is NOT applied here. brand-routes.js mounts this behind its own
// requireAuth, and opens the ?token= door for /faces/:id/file just above it —
// one door and one gate for the whole lane, rather than two of each to keep in
// step. Every handler below can rely on req.walletAddress.

/**
 * How a brand kit is EDITED, plus what the cards demand of it.
 *
 * The form travels rather than being hand-written in the frontend, because a
 * hand-written copy drifts from the gate the first time a field is added — and
 * the drift is silent. That is exactly how twenty of thirty-nine fields ended
 * up reachable only through a raw JSON textarea.
 *
 * The template requirements ride along so the palette editor can badge a role
 * the CARDS need but the loader does not demand, naming which templates go dark
 * without it.
 */
router.get('/form', async (req, res) => {
  try {
    const [colors, type, marks] = await Promise.all([
      requiredColors(), requiredType(), requiredMarks(),
    ]);
    res.json({ ...kitForm(), templates: { colors, type, marks } });
  } catch (error) {
    log.error('Could not describe the kit form', { error: error.message });
    res.status(500).json({ error: 'the brand kit form could not be read' });
  }
});

/**
 * The faces this repository carries, grouped by family.
 *
 * ⚠️ Names and weights only. EMBEDDABLE holds absolute paths into the repo and
 * serving it straight through would publish the rig's directory layout.
 */
router.get('/faces', (req, res) => {
  res.json({ families: families() });
});

/**
 * One face's bytes, so a specimen renders in the font the CARD will use.
 *
 * The id is looked UP in the registry, never joined to a path — the only
 * strings that resolve are keys this repository declared, so there is no
 * traversal to defend against.
 */
router.get('/faces/:id/file', async (req, res) => {
  const face = faceFile(req.params.id);
  if (!face) return res.status(404).json({ error: `no vendored face "${req.params.id}"` });
  try {
    const bytes = await readFile(face.file);
    res.type(face.format === 'otf' ? 'font/otf' : 'font/ttf');
    // The bytes are immutable — a face id names one file that ships with the
    // source. Caching hard is what keeps a live preview cheap.
    res.set('Cache-Control', 'private, max-age=31536000, immutable');
    return res.send(bytes);
  } catch (error) {
    log.error('Vendored face is not on this machine', { id: req.params.id, error: error.message });
    return res.status(404).json({ error: `${req.params.id} is registered but its file is not on this machine` });
  }
});

/** The marks this brand carries, recoloured onto its own palette, as data URIs. */
router.get('/:brand/marks', async (req, res) => {
  const kit = await readKit(req.params.brand, req.walletAddress);
  if (!kit.ok) return res.status(404).json(kit);
  const { marks, missing } = await loadMarks(req.params.brand, kit.kit, { wallet: req.walletAddress });
  const needed = await requiredMarks();
  return res.json({
    brand: req.params.brand,
    marks,
    missing,
    // Where to drop a file by hand, said exactly. Upload is the easy path; an
    // operator who would rather use their own editor should not have to guess.
    where: path.join((await workspaceBrandsDir(req.walletAddress)) || brandsDir(), req.params.brand, 'marks'),
    needed,
  });
});

// SVG only, and small. A mark is line art — anything megabyte-sized is not a
// mark, and rasters are refused because a logo that cannot scale will be drawn
// blurry on a 1600px card. Memory storage, not disk: the file is validated and
// then written to the kit's own folder under a name WE choose.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

/** A mark name is a path component and nothing else — the same closed door
 *  loadMarks keeps, checked here before anything reaches disk. */
const MARK_NAME = /^[a-z][a-z0-9-]*$/;

/**
 * Put an SVG into this brand's own marks/ folder.
 *
 * ⚠️ Multipart, so it never touches the strict 100kb JSON limit /api/v1/brands
 * inherits from server.js. And it always writes to the SIGNER'S ground — a
 * brand that currently resolves to the repo gets a workspace copy, which is the
 * same precedence a PUT already follows. The repo's shipped artwork is source
 * and is never overwritten.
 */
router.post('/:brand/marks', upload.single('mark'), async (req, res) => {
  const refusal = brandNameRefusal(req.params.brand);
  if (refusal) return res.status(400).json({ error: refusal });

  const name = String(req.body?.name || '').trim().toLowerCase();
  if (!MARK_NAME.test(name)) {
    return res.status(400).json({ error: `"${req.body?.name}" is not a mark name — lowercase letters, digits and hyphens only` });
  }
  if (!req.file) return res.status(400).json({ error: 'no file was uploaded' });

  // Sniffed, not trusted. A browser's declared mime is whatever the OS guessed
  // from an extension, and this file gets served back to a browser.
  const text = req.file.buffer.toString('utf8');
  if (!/<svg[\s>]/i.test(text.slice(0, 4096))) {
    return res.status(415).json({ error: 'that file is not an SVG — a mark must be vector, or it draws blurry at card size' });
  }

  const ground = await workspaceBrandsDir(req.walletAddress);
  if (!ground) {
    return res.status(400).json({ error: 'no house ground is set, so there is nowhere of your own to keep a brand kit' });
  }
  try {
    const dir = path.join(ground, req.params.brand, 'marks');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${name}.svg`), text, 'utf8');
    log.info('Brand mark saved', { brand: req.params.brand, mark: name });
    return res.json({ ok: true, brand: req.params.brand, name, file: `${name}.svg` });
  } catch (error) {
    log.error('Could not save brand mark', { brand: req.params.brand, error: error.message });
    return res.status(500).json({ error: 'the mark could not be saved' });
  }
});

export default router;
