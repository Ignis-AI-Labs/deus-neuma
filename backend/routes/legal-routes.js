/**
 * Legal routes — the operator's window onto the CLO office: the seat, the
 * matters ledger, the watch state, and a manual run. Mounted at
 * /api/v1/legal. Every route requires the operator's Bearer token; every
 * mutation is logged with the wallet that asked for it.
 *
 * Every route reads and moves the SIGNED-IN operator's own house's office
 * (Design note, 2026-10-16: two houses on one machine are never confused) — no
 * route reaches another house's seat, matters or watch.
 *
 * The operator may SEAT and RUN; settling matters is the Praetor's reading
 * (the legal/assess intent) — the desk shows the verdicts, it does not forge
 * them.
 */

import express from 'express';
import { requireAuth } from '../services/auth.js';
import { assertNeumaOwner } from '../middleware/require-neuma-owner.js';
import { cloDesignation } from '../services/legal/clo-designation.js';
import { scaffoldCloWorkspace } from '../services/legal/clo-scaffold.js';
import { matterLedgerFor, matterCounts, mattersDueForReview } from '../services/legal/matter-ledger.js';
import { runLegalWatch, readLegalWatchState } from '../services/legal/legal-scheduler.js';
import { readReaderSetting, saveReaderSetting, HOUSE_MODEL } from '../services/legal/second-reader.js';
import { listConnections } from '../services/provider-connections.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('Legal');

const router = express.Router();
router.use(requireAuth);

// ── The CLO seat — before /matters/:id so static names are never ids. ─────
router.get('/seat', async (req, res) => {
  try {
    res.json({ clo: await cloDesignation.getOfficer(req.walletAddress) });
  } catch (error) {
    log.error('CLO designation read failed', { error: error.message });
    res.status(500).json({ error: 'Failed to read the CLO designation' });
  }
});

// Seat one of the operator's own lanes as the house CLO; the office on disk
// rides with the seat — fail-soft: a scaffold that cannot land never unseats
// the designation.
router.put('/seat', async (req, res) => {
  const laneId = typeof req.body?.laneId === 'string' ? req.body.laneId.trim() : '';
  if (!laneId) return res.status(400).json({ error: 'a CLO designation needs a lane id' });
  if (!(await assertNeumaOwner(req, res, laneId))) return;
  try {
    const clo = await cloDesignation.designate(req.walletAddress, laneId);
    log.info('CLO designated', { laneId: clo.laneId, wallet: req.walletAddress });
    try {
      const { seeded } = await scaffoldCloWorkspace(clo.laneId);
      log.info('CLO office scaffolded', { laneId: clo.laneId, seeded });
    } catch (scaffoldError) {
      log.error('CLO scaffold failed — the designation stands', { laneId: clo.laneId, error: scaffoldError.message });
    }
    res.json({ clo });
  } catch (error) {
    if (/not a lane of this house/.test(error.message)) return res.status(403).json({ error: error.message });
    log.error('CLO designation failed', { error: error.message });
    res.status(500).json({ error: 'Failed to designate the CLO' });
  }
});

// Unseat the operator's own house's CLO — only when the seated lane is the
// operator's own (a record naming another wallet's lane is never theirs to clear).
router.delete('/seat', async (req, res) => {
  try {
    const officer = await cloDesignation.getOfficer(req.walletAddress);
    if (officer?.laneId && !(await assertNeumaOwner(req, res, officer.laneId))) return;
    await cloDesignation.clear(req.walletAddress);
    log.info('CLO cleared', { wallet: req.walletAddress });
    res.json({ cleared: true });
  } catch (error) {
    log.error('CLO clear failed', { error: error.message });
    res.status(500).json({ error: 'Failed to clear the CLO designation' });
  }
});

// ── The second reader — which model seconds the office's readings ──────────
// The house's own model by default; any connected provider is the operator's
// choice (electron/connections.json "legal-second-reader").
router.get('/reader', async (req, res) => {
  try {
    const [reader, connections] = await Promise.all([readReaderSetting(req.walletAddress), listConnections()]);
    res.json({
      reader,
      choices: [
        { provider: HOUSE_MODEL, label: 'The house\'s own model — nothing leaves this computer' },
        ...connections.map((c) => ({ provider: c.providerId, label: `${c.providerId} · ${c.model} — claims and passages go to ${c.providerId}` })),
      ],
    });
  } catch (error) {
    log.error('second reader read failed', { error: error.message });
    res.status(500).json({ error: 'Failed to read the second reader' });
  }
});

router.put('/reader', async (req, res) => {
  try {
    const out = await saveReaderSetting(req.walletAddress, req.body?.provider);
    if (!out.ok) return res.status(400).json({ error: out.error });
    log.info('second reader set', { wallet: req.walletAddress, provider: out.setting.provider });
    res.json({ reader: out.setting });
  } catch (error) {
    log.error('second reader save failed', { error: error.message });
    res.status(500).json({ error: 'Failed to set the second reader' });
  }
});

// ── The matters ledger ──────────────────────────────────────────────────────
router.get('/matters', async (req, res) => {
  try {
    const all = await (await matterLedgerFor(req.walletAddress)).load();
    let matters = all;
    const { status, area, repo } = req.query;
    if (status) matters = matters.filter((m) => m.status === status);
    if (area) matters = matters.filter((m) => m.area === area);
    if (repo) matters = matters.filter((m) => m.repo === repo);
    res.json({ matters, counts: matterCounts(all) });
  } catch (error) {
    log.error('Matters ledger read failed', { error: error.message });
    res.status(500).json({ error: 'Failed to read the matters ledger' });
  }
});

router.get('/matters/:id', async (req, res) => {
  try {
    const matter = await (await matterLedgerFor(req.walletAddress)).get(req.params.id);
    if (!matter) return res.status(404).json({ error: 'no such matter' });
    res.json({ matter });
  } catch (error) {
    log.error('Matter read failed', { id: req.params.id, error: error.message });
    res.status(500).json({ error: 'Failed to read the matter' });
  }
});

// ── The watch ───────────────────────────────────────────────────────────────
router.get('/watch', async (req, res) => {
  try {
    res.json({ watch: await readLegalWatchState(req.walletAddress) });
  } catch (error) {
    log.error('Legal watch state read failed', { error: error.message });
    res.status(500).json({ error: 'Failed to read the legal watch state' });
  }
});

// The operator's "now" — the in-flight guard makes it safe mid-run.
router.post('/watch/run', async (req, res) => {
  try {
    log.info('manual legal watch triggered', { wallet: req.walletAddress });
    res.json({ summary: await runLegalWatch({ wallet: req.walletAddress, trigger: 'manual' }) });
  } catch (error) {
    log.error('Manual legal watch failed', { error: error.message });
    res.status(500).json({ error: 'Failed to run the legal watch' });
  }
});

// ── The posture strip — one call for the desk's summary. ────────────────────
router.get('/posture', async (req, res) => {
  try {
    const [clo, entries, watch] = await Promise.all([
      cloDesignation.getOfficer(req.walletAddress),
      matterLedgerFor(req.walletAddress).then((ledger) => ledger.load()),
      readLegalWatchState(req.walletAddress),
    ]);
    res.json({
      clo,
      counts: matterCounts(entries),
      dueForReview: mattersDueForReview(entries).length,
      lastRunAt: watch.lastRunAt,
      lastRun: watch.runs?.[0] || null,
    });
  } catch (error) {
    log.error('Legal posture read failed', { error: error.message });
    res.status(500).json({ error: 'Failed to read the legal posture' });
  }
});

export default router;
