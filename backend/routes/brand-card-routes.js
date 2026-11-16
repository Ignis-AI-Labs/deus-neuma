/**
 * Brand Card Routes — a company's cards: every card type it can draw, and its own designs.
 *
 * GET    /:brand/cards            every card type, whether it is the company's own design or the
 *                                 shared one, and how alike it is to other companies' (card-gallery.js)
 * GET    /:brand/cards/:template  the design this company draws for that card: {svg, spec, source}
 * PUT    /:brand/cards/:template  keep {svg, spec} as the company's own design (refused unless it
 *                                 is safe to draw and draws against the saved kit)
 * DELETE /:brand/cards/:template  let the company's own design go; the shared card stands again
 *
 * Design note, 2026-11-16: cards […]. Auth is brand-routes.js's one requireAuth; req.walletAddress is set.
 */
import { Router } from 'express';
import { createLogger } from '../services/logger.js';
import { brandNameRefusal } from '../services/branding/kit-store.js';
import { cardGallery } from '../services/branding/card-gallery.js';
import { loadTemplate } from '../services/branding/brand-tokens.js';
import { saveDesign, removeDesign } from '../services/branding/card-design-save.js';
import { designNameRefusal } from '../services/branding/card-designs.js';

const router = Router();
const log = createLogger('Brands.Cards');

const refused = (req) => brandNameRefusal(req.params.brand) || (req.params.template ? designNameRefusal(req.params.template) : null);

router.get('/:brand/cards', async (req, res) => {
  const refusal = refused(req);
  if (refusal) return res.status(400).json({ error: refusal });
  try {
    return res.json(await cardGallery(req.params.brand, req.walletAddress));
  } catch (error) {
    log.error('Could not list cards', { brand: req.params.brand, error: error.message });
    return res.status(500).json({ error: 'the cards could not be read' });
  }
});

router.get('/:brand/cards/:template', async (req, res) => {
  const refusal = refused(req);
  if (refusal) return res.status(400).json({ error: refusal });
  const loaded = await loadTemplate(req.params.template, { brand: req.params.brand, wallet: req.walletAddress });
  if (!loaded.ok) return res.status(404).json({ error: loaded.error });
  return res.json({ name: req.params.template, svg: loaded.svg, spec: loaded.spec, source: loaded.source });
});

router.put('/:brand/cards/:template', async (req, res) => {
  const refusal = refused(req);
  if (refusal) return res.status(400).json({ error: refusal });
  const { svg, spec } = req.body || {};
  if (typeof svg !== 'string' || !spec || typeof spec !== 'object') return res.status(400).json({ error: 'send the design as {svg, spec}' });
  try {
    const saved = await saveDesign({ brand: req.params.brand, template: req.params.template, svg, spec, wallet: req.walletAddress });
    // 422 with the reasons: a design that cannot be drawn is the routine case while redesigning.
    if (!saved.ok) return res.status(422).json({ error: saved.error, errors: saved.errors || [] });
    return res.json(saved);
  } catch (error) {
    log.error('Could not save a card design', { brand: req.params.brand, template: req.params.template, error: error.message });
    return res.status(500).json({ error: 'the design could not be saved' });
  }
});

router.delete('/:brand/cards/:template', async (req, res) => {
  const refusal = refused(req);
  if (refusal) return res.status(400).json({ error: refusal });
  const removed = await removeDesign({ brand: req.params.brand, template: req.params.template, wallet: req.walletAddress });
  return removed.ok ? res.json(removed) : res.status(404).json({ error: removed.error });
});

export default router;
