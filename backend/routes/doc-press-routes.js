/**
 * Doc-press routes — the witness's surface for THE PRESS: list the brand
 * kits on this machine and press markdown into a branded PDF, returned as a
 * download. Rendering is local (real Chromium, no egress). All routes
 * require the witness's Bearer token; the body parser lives behind auth
 * with its own wide limit (markdown documents outgrow the 100kb default).
 */

import express from 'express';
import { requireAuth } from '../services/auth.js';
import { listBrandKits, pressDocument, locateChromium } from '../services/doc-press/index.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('DocPress');

const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;

// pure — a filesystem-safe download filename stem
const slugify = (title) =>
  String(title || 'document')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'document';

const router = express.Router();
router.use(requireAuth);
router.use(express.json({ limit: '3mb' }));

// The press board: available kits + whether this machine can press at all.
router.get('/', async (req, res) => {
  try {
    const kits = await listBrandKits();
    let chromium = { available: true };
    try {
      locateChromium();
    } catch (err) {
      chromium = { available: false, detail: err.message };
    }
    res.json({ kits, chromium });
  } catch (error) {
    log.error('Press board read failed', { error: error.message });
    res.status(500).json({ error: 'Failed to read press state' });
  }
});

// Press markdown into a branded PDF and return the bytes as a download.
router.post('/press', async (req, res) => {
  const { markdown, title, kitId } = req.body || {};
  if (typeof markdown !== 'string' || markdown.trim() === '') {
    return res.status(400).json({ error: 'Body must carry markdown (a non-empty string)' });
  }
  if (Buffer.byteLength(markdown, 'utf8') > MAX_MARKDOWN_BYTES) {
    return res.status(400).json({ error: 'Markdown too large to press (2MB max)' });
  }
  if (title !== undefined && typeof title !== 'string') {
    return res.status(400).json({ error: 'title must be a string' });
  }
  if (kitId !== undefined && typeof kitId !== 'string') {
    return res.status(400).json({ error: 'kitId must be a string' });
  }
  try {
    const docTitle = (title || 'document').trim().slice(0, 120) || 'document';
    const result = await pressDocument({ markdown, title: docTitle, kitId: kitId || undefined });
    log.info('Document pressed', {
      wallet: req.walletAddress, kit: result.kitId, title: docTitle, bytes: result.pdf.length,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${slugify(docTitle)}.pdf"`);
    res.send(result.pdf);
  } catch (error) {
    // An unknown kit is the likeliest miss — answer with the real choices.
    if (/Brand kit .* not readable|Invalid brand kit id/.test(error.message)) {
      const kits = await listBrandKits().catch(() => []);
      return res.status(400).json({ error: error.message, kits: kits.map((k) => k.id) });
    }
    log.error('Press failed', { error: error.message });
    res.status(500).json({ error: `The press failed: ${error.message}` });
  }
});

export default router;
