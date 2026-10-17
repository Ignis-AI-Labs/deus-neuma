// Attachment routes — the HTTP leg of image sharing.
//
// The witness pastes an image into the composer; the frontend uploads it
// here (this path rides the 24mb JSON tier — see server.js) and gets back
// short-lived ids. The consciousness:stream WS frame then carries only the
// ids, honoring the portal's 64KB payload cap (WS-002). Redemption happens
// in portal-stream, wallet-scoped and single-use.

import express, { Router } from 'express';
import { requireAuth } from '../services/auth.js';
import { attachmentStore, sanitizeImages, sanitizeTextDocs } from '../services/attachment-store.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('Attachments');

const router = Router();

// Auth BEFORE body parsing (same hardening as the voice forge): an
// unauthenticated 24MB POST dies at the gate without a byte of it being
// JSON-parsed. server.js passes this path through unparsed on purpose.
router.use(requireAuth);
router.use(express.json({ limit: '24mb' }));

router.post('/', (req, res) => {
  // An upload carries images, text documents, or both. Each kind is validated
  // by its own sanitizer; the store parks them together and returns one id
  // list (order preserved: images first, then documents) that the stream frame
  // carries. A payload with neither is a client error.
  const hasImages = Array.isArray(req.body?.images) && req.body.images.length > 0;
  const hasDocs = Array.isArray(req.body?.files) && req.body.files.length > 0;
  if (!hasImages && !hasDocs) {
    res.status(400).json({ error: 'no attachments given' });
    return;
  }

  const payloads = [];
  if (hasImages) {
    const check = sanitizeImages(req.body.images);
    if (!check.ok) { res.status(400).json({ error: check.reason }); return; }
    payloads.push(...check.images); // image data-URI strings
  }
  if (hasDocs) {
    const check = sanitizeTextDocs(req.body.files);
    if (!check.ok) { res.status(400).json({ error: check.reason }); return; }
    payloads.push(...check.docs.map((d) => ({ kind: 'text', name: d.name, text: d.text })));
  }

  const parked = attachmentStore.put(req.walletAddress, payloads);
  if (!parked.ok) {
    res.status(429).json({ error: parked.reason });
    return;
  }
  log.info('Attachments parked', { wallet: req.walletAddress, count: parked.ids.length });
  res.json({ ids: parked.ids });
});

export default router;
