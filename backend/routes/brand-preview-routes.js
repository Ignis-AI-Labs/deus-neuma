/**
 * Brand Preview Routes — a card drawn from a kit that has not been saved.
 *
 * POST /:brand/preview — body is the DRAFT kit; answers with the card's SVG
 *
 * WHY A POST FOR SOMETHING THAT READS. The kit being previewed does not exist
 * anywhere yet — it is whatever is currently in the operator's editor, mid-edit.
 * There is nothing to GET. The body IS the subject.
 *
 * It changes nothing on disk. A preview that saved as a side effect would mean
 * an operator could not try a colour without committing to it, which is the
 * opposite of what a preview is for.
 *
 * ⚠️ THE BODY IS A WHOLE BRAND KIT and rides the strict 100kb JSON limit
 * /api/v1/brands inherits (server.js:182). That is comfortable — Umbrae's kit,
 * the largest that exists, is about 8KB — and the limit is left strict on
 * purpose: the wide-limit lanes in this app are the ones carrying media, and a
 * JSON document describing a brand is not one of them.
 */
import { Router } from 'express';
import { createLogger } from '../services/logger.js';
import { previewCard, previewFaceIds } from '../services/branding/card-preview.js';
import { brandNameRefusal } from '../services/branding/kit-store.js';

const router = Router();
const log = createLogger('Brands.Preview');

// Auth is applied by brand-routes.js, which mounts this behind its own
// requireAuth — one gate for the whole lane. req.walletAddress is set.

router.post('/:brand/preview', async (req, res) => {
  const refusal = brandNameRefusal(req.params.brand);
  if (refusal) return res.status(400).json({ error: refusal });

  const { kit, template, data } = req.body || {};
  if (!template) return res.status(400).json({ error: 'name the template to preview' });

  try {
    const result = await previewCard({
      brand: req.params.brand,
      kit,
      template,
      data: data || null,
      wallet: req.walletAddress,
    });
    if (!result.ok) {
      // 200, not 4xx. A refused card is the EXPECTED answer while somebody is
      // half-way through typing a hex value, and the panel draws the reasons in
      // place of the card. Answering 4xx would make the client's error path —
      // which is for a broken request — carry the routine case.
      return res.json({ ok: false, errors: result.errors });
    }
    return res.json({
      ok: true,
      svg: result.svg,
      missing: result.missing,
      sample: result.sample,
      // The faces the BROWSER should install, since the SVG carries none.
      faces: previewFaceIds(kit),
    });
  } catch (error) {
    log.error('Could not preview a card', { brand: req.params.brand, template, error: error.message });
    return res.status(500).json({ error: 'the card could not be drawn' });
  }
});

export default router;
