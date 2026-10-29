/**
 * Brand Routes — the operator's brand kits, listed and edited.
 *
 * Design note, 2026-08-31: […]
 *
 * The store, the readiness gate and the card renderer all shipped before this;
 * what was missing was the operator's own door to them. Until now a kit was
 * authored by hand-editing JSON in the house ground, which is why the house's
 * own two kits are still unfinished.
 *
 * GET  /            — every kit this wallet can reach, with how complete it is
 * GET  /:brand      — one kit, and exactly what it is still missing
 * GET  /:brand/new  — a loadable skeleton to start from (nothing invented)
 * PUT  /:brand      — save it, into the operator's OWN ground and nowhere else
 *
 * Two sub-routers carry the rest: brand-asset-routes.js (the form spec, the
 * vendored faces, a brand's marks) and brand-preview-routes.js (a card drawn
 * from an unsaved draft). They are MOUNTED FIRST — Express matches in order,
 * and `/:brand` would otherwise swallow `/form` and `/faces` as brand names.
 * Same reason `/:brand/new` is declared above `/:brand` below.
 *
 * SCOPED TO THE SIGNER. Workspace kits are resolved through the wallet's own
 * house ground, so one operator can never list or edit another's brands. The
 * repo's shipped kits are visible to everyone because they are source, and a
 * PUT against one does not touch it — it writes a workspace kit that shadows
 * it, which is the precedence kit-locate already declares.
 *
 * THERE IS NO DELETE. Removing a brand kit would orphan every campaign,
 * queued post and pressed document that references it, and none of those
 * would fail loudly. Retiring a brand is a decision with consequences to walk
 * first; it is not a button.
 */
import { Router } from 'express';
import { requireAuth } from '../services/auth.js';
import {
  brandNameRefusal, kitSkeleton, listKits, readKit, writeKit,
} from '../services/branding/kit-store.js';
import { readinessReport } from '../services/branding/kit-readiness.js';
import { createLogger } from '../services/logger.js';
import assetRoutes from './brand-asset-routes.js';
import previewRoutes from './brand-preview-routes.js';

const router = Router();
const log = createLogger('Brands');

// A stylesheet's url() issues the browser's OWN bare GET and can carry no
// Authorization header — which is the entire reason a type specimen used to
// render in whatever font the operator's machine happened to have rather than
// in the face the card will actually use. So for the face bytes ONLY, a
// ?token= query is mapped into the header BEFORE the blanket requireAuth: the
// same session token, the same verification, nothing else loosened.
// gallery-routes.js:45 and user-files-routes.js:37 ride the identical law.
//
// A regex, not a prefix: `/faces/grotesk-light/file` opens the door and
// nothing else does — not `/faces`, not `/umbrae`, not a path that merely
// starts the same way.
const HEADERLESS = /^\/faces\/[a-z0-9-]+\/file$/;
router.use((req, res, next) => {
  if (HEADERLESS.test(req.path) && !req.headers.authorization
      && typeof req.query.token === 'string' && req.query.token) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  next();
});

router.use(requireAuth);

// Mounted FIRST among the handlers: Express matches in order, and this file's
// `/:brand` would otherwise swallow `/form` and `/faces` as brand names. Both
// sub-routers sit behind the one requireAuth above rather than repeating it.
router.use('/', assetRoutes);
router.use('/', previewRoutes);

/** Every kit the signer can reach, workspace shadowing repo. */
router.get('/', async (req, res) => {
  try {
    const kits = await listKits(req.walletAddress);
    res.json({
      kits,
      // The count Founder asked to see, and the one that matters beside it: a kit
      // that exists is not a kit anyone may speak through.
      total: kits.length,
      ready: kits.filter((k) => k.ready).length,
    });
  } catch (error) {
    log.error('Could not list brand kits', { error: error.message });
    res.status(500).json({ error: 'the brand kits could not be read' });
  }
});

/**
 * A skeleton for a brand that does not exist yet.
 *
 * Declared BEFORE `/:brand` or Express would read "new" as a brand name.
 */
router.get('/:brand/new', async (req, res) => {
  const refusal = brandNameRefusal(req.params.brand);
  if (refusal) return res.status(400).json({ error: refusal });
  const existing = await readKit(req.params.brand, req.walletAddress);
  if (existing.ok) {
    return res.status(409).json({ error: `a "${req.params.brand}" brand kit already exists` });
  }
  return res.json({ brand: req.params.brand, kit: kitSkeleton(req.params.brand) });
});

/** One kit, with what it still needs said in words the operator can act on. */
router.get('/:brand', async (req, res) => {
  const result = await readKit(req.params.brand, req.walletAddress);
  if (!result.ok) return res.status(404).json(result);
  return res.json({
    ...result,
    // The same sentences the being is refused with, so the operator reads the
    // exact text that will block a campaign rather than a second wording of it.
    report: readinessReport(result.brand, result.readiness),
  });
});

/**
 * Save a kit. Lands in the signer's own ground, always.
 *
 * A refused save answers 422 WITH the refusals, because "invalid" alone sends
 * the operator back to guess which of nineteen fields the loader objected to.
 *
 * The `company` block is the companies route's (/api/v1/companies): a kit
 * already on disk keeps its own, so a draft opened before its repos or
 * parent were recorded can never save the old block back over them.
 */
router.put('/:brand', async (req, res) => {
  try {
    const onDisk = await readKit(req.params.brand, req.walletAddress);
    const body = onDisk.ok && req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? { ...req.body, company: onDisk.kit.company } : req.body;
    if (body && onDisk.ok && body.company === undefined) delete body.company;
    const result = await writeKit(req.params.brand, req.walletAddress, body);
    if (!result.ok) return res.status(result.refusals ? 422 : 400).json(result);
    log.info('Brand kit saved', { brand: req.params.brand, ready: result.readiness.ready });
    return res.json({ ...result, report: readinessReport(result.brand, result.readiness) });
  } catch (error) {
    log.error('Could not save brand kit', { brand: req.params.brand, error: error.message });
    return res.status(500).json({ error: 'the brand kit could not be saved' });
  }
});

export default router;
