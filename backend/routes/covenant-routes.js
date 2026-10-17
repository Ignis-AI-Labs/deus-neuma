/**
 * Covenant Routes — the binding documents and wallet-signed acceptance.
 *
 * GET  /            public: document texts + hashes (what would be signed)
 * GET  /:id/pdf      public: the document's branded PDF (inline)
 * GET  /status      auth:   acceptance state + the exact message to sign
 * POST /accept      auth:   verify the wallet signature, persist the record
 */
import { Router } from 'express';
import { existsSync } from 'fs';
import { basename } from 'path';
import { requireAuth } from '../services/auth.js';
import { createLogger } from '../services/logger.js';
import {
  ACCEPTANCE_VERSION,
  loadDocuments,
  buildAcceptanceMessage,
  verifyAcceptance,
  getAcceptances,
  recordAcceptance,
  isAcceptanceCurrent,
  pdfFileFor,
} from '../services/covenant.js';

const router = Router();
const log = createLogger('Covenant');

router.get('/', (req, res) => {
  try {
    const documents = loadDocuments().map((doc) => (existsSync(pdfFileFor(doc.id))
      ? { ...doc, pdfUrl: `/api/v1/covenant/${doc.id}/pdf` }
      : doc));
    res.json({ version: ACCEPTANCE_VERSION, documents });
  } catch (error) {
    log.error('Document load failed', { error: error.message });
    res.status(500).json({ error: 'Binding documents unavailable' });
  }
});

router.get('/:id/pdf', (req, res) => {
  const file = pdfFileFor(req.params.id);
  if (!file || !existsSync(file)) return res.status(404).json({ error: 'No such document' });
  res.type('application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${basename(file)}"`);
  return res.sendFile(file);
});

router.get('/status', requireAuth, async (req, res) => {
  try {
    const wallet = req.walletAddress;
    const currentDocs = loadDocuments().map(({ id, sha256 }) => ({ id, sha256 }));
    const history = await getAcceptances(wallet);
    const latest = history[history.length - 1] || null;
    const current = isAcceptanceCurrent(latest, currentDocs);

    const signedAt = new Date().toISOString();
    res.json({
      version: ACCEPTANCE_VERSION,
      accepted: Boolean(latest),
      current,
      acceptedAt: latest?.signedAt || null,
      signedAt,
      messageToSign: buildAcceptanceMessage({ wallet, documents: currentDocs, signedAt }),
    });
  } catch (error) {
    log.error('Status failed', { error: error.message });
    res.status(500).json({ error: 'Covenant status unavailable' });
  }
});

router.post('/accept', requireAuth, async (req, res) => {
  try {
    const wallet = req.walletAddress;
    const { signature, signedAt } = req.body || {};
    if (typeof signature !== 'string' || typeof signedAt !== 'string') {
      return res.status(400).json({ error: 'signature and signedAt are required' });
    }

    const verified = verifyAcceptance({ wallet, signature, signedAt });
    if (!verified) {
      log.warn('Acceptance rejected', { wallet });
      return res.status(422).json({
        error: 'Signature does not match the current documents for this wallet',
      });
    }

    const record = await recordAcceptance({ wallet, signature, signedAt, ...verified });
    log.info('Covenant accepted', { wallet, signedAt: record.signedAt });
    res.status(201).json({
      version: record.version,
      wallet: record.wallet,
      signedAt: record.signedAt,
      recordedAt: record.recordedAt,
      documents: record.documents,
    });
  } catch (error) {
    log.error('Accept failed', { error: error.message });
    res.status(500).json({ error: 'Could not record acceptance' });
  }
});

export default router;
