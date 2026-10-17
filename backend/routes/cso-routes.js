/**
 * CSO routes — the operator's window onto the CSO office: the seat itself,
 * the threat ledger, the watch list, and the scan state. Mounted at
 * /api/v1/cso (the older /api/v1/security router serves the data-security
 * panel — encryption, backups — and owns that prefix). All routes require
 * the operator's Bearer token; every mutation is logged with the wallet
 * that asked for it.
 *
 * Every office route reads and moves the SIGNED-IN OPERATOR'S HOUSE only
 * (Design note, 2026-10-16: two houses on one machine are never confused): its seat,
 * its ledger, its watch list, its scans. The live pulse and the application
 * firewall below are the machine's own instruments.
 */

import express from 'express';
import { requireAuth } from '../services/auth.js';
import { assertNeumaOwner } from '../middleware/require-neuma-owner.js';
import { csoDesignation } from '../services/security/cso-designation.js';
import { scaffoldCsoWorkspace } from '../services/security/cso-scaffold.js';
import { threatLedgerFor, threatCounts } from '../services/security/threat-ledger.js';
import { watchStoreFor } from '../services/security/watch-store.js';
import { runSecurityScan, readScanState } from '../services/security/security-scheduler.js';
import { mapThreatAttackSurface, readArchitectureSurface, selectWatchedRepo } from '../services/security/attack-surface.js';
import { readSecurityTelemetry } from '../services/security/traffic-monitor.js';
import { circuitBreaker } from '../services/security/circuit-breaker.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('Security');

const router = express.Router();
router.use(requireAuth);

const publicSurface = ({ graph, ...surface }) => surface;
const repoOnWatch = async (wallet, repoId = null) => selectWatchedRepo(await (await watchStoreFor(wallet)).load(), repoId);

// ── The CSO seat — mounted before /threats/:id so static names are never
// read as ids. ─────────────────────────────────────────────────────────────
router.get('/seat', async (req, res) => {
  try {
    res.json({ cso: await csoDesignation.getOfficer(req.walletAddress) });
  } catch (error) {
    log.error('CSO designation read failed', { error: error.message });
    res.status(500).json({ error: 'Failed to read the CSO designation' });
  }
});

// Seat one of the operator's own lanes as their house's CSO. The office on
// disk rides with the seat — fail-soft: a scaffold that cannot land never
// unseats the designation.
router.put('/seat', async (req, res) => {
  const laneId = typeof req.body?.laneId === 'string' ? req.body.laneId.trim() : '';
  if (!laneId) {
    return res.status(400).json({ error: 'a CSO designation needs a lane id' });
  }
  if (!(await assertNeumaOwner(req, res, laneId))) return;
  try {
    const cso = await csoDesignation.designate(req.walletAddress, laneId);
    log.info('CSO designated', { laneId: cso.laneId, wallet: req.walletAddress });
    try {
      const { seeded } = await scaffoldCsoWorkspace(cso.laneId);
      log.info('CSO office scaffolded', { laneId: cso.laneId, seeded });
    } catch (scaffoldError) {
      log.error('CSO scaffold failed — the designation stands', { laneId: cso.laneId, error: scaffoldError.message });
    }
    res.json({ cso });
  } catch (error) {
    if (/not a lane of this house/.test(error.message)) return res.status(403).json({ error: error.message });
    log.error('CSO designation failed', { error: error.message });
    res.status(500).json({ error: 'Failed to designate the CSO' });
  }
});

// Unseat the operator's house's CSO — the office's acts close to every being
// of that house. Only the house's own operator: the seated lane must be theirs.
router.delete('/seat', async (req, res) => {
  try {
    const officer = await csoDesignation.getOfficer(req.walletAddress);
    if (officer?.laneId && !(await assertNeumaOwner(req, res, officer.laneId))) return;
    await csoDesignation.clear(req.walletAddress);
    log.info('CSO cleared', { wallet: req.walletAddress });
    res.json({ cleared: true });
  } catch (error) {
    log.error('CSO clear failed', { error: error.message });
    res.status(500).json({ error: 'Failed to clear the CSO designation' });
  }
});

// ── Sight: deployment map + live process pulse ─────────────────────────────
router.get('/attack-surface', async (req, res) => {
  try {
    const repo = await repoOnWatch(req.walletAddress, req.query.repo || null);
    res.json({ repo: { id: repo.id, path: repo.path }, surface: publicSurface(await readArchitectureSurface(repo.path)) });
  } catch (error) {
    log.error('Attack-surface read failed', { repo: req.query.repo, error: error.message });
    res.status(500).json({ error: error.message });
  }
});

router.get('/threats/:id/attack-surface', async (req, res) => {
  try {
    const threat = await (await threatLedgerFor(req.walletAddress)).get(req.params.id);
    if (!threat) return res.status(404).json({ error: 'no such threat' });
    const repo = await repoOnWatch(req.walletAddress, threat.repo);
    res.json({ attackSurface: await mapThreatAttackSurface(threat, repo.path) });
  } catch (error) {
    log.error('Threat attack-surface read failed', { id: req.params.id, error: error.message });
    res.status(500).json({ error: error.message });
  }
});

router.get('/telemetry', async (req, res) => {
  try {
    res.json({ telemetry: await readSecurityTelemetry({
      windowSeconds: req.query.windowSeconds,
      limit: req.query.limit,
      logLimit: req.query.logLimit,
    }) });
  } catch (error) {
    log.error('Security telemetry read failed', { error: error.message });
    res.status(500).json({ error: 'Failed to read live security telemetry' });
  }
});

// ── Reach: the bounded application firewall ────────────────────────────────
router.get('/mitigations', async (req, res) => {
  try {
    res.json({ mitigations: await circuitBreaker.load() });
  } catch (error) {
    log.error('Circuit-breaker state read failed', { error: error.message });
    res.status(500).json({ error: 'Failed to read emergency mitigations' });
  }
});

router.post('/mitigations', async (req, res) => {
  try {
    const outcome = await circuitBreaker.apply({
      ...(req.body || {}),
      actor: `operator:${req.walletAddress}`,
    });
    log.warn('Operator changed an emergency mitigation', {
      action: req.body?.action,
      source: req.body?.source || null,
      wallet: req.walletAddress,
    });
    res.json({ outcome });
  } catch (error) {
    log.error('Emergency mitigation failed', { action: req.body?.action, error: error.message });
    const inputError = /action|source|durationSeconds|reason|enabled|loopback/.test(error.message);
    res.status(inputError ? 400 : 500).json({ error: error.message });
  }
});

// ── The threat ledger ───────────────────────────────────────────────────────
router.get('/threats', async (req, res) => {
  try {
    const all = await (await threatLedgerFor(req.walletAddress)).load();
    let entries = all;
    const { status, layer, repo } = req.query;
    if (status) entries = entries.filter((e) => e.status === status);
    if (layer) entries = entries.filter((e) => e.layer === layer);
    if (repo) entries = entries.filter((e) => e.repo === repo);
    res.json({ threats: entries, counts: threatCounts(all) });
  } catch (error) {
    log.error('Threat ledger read failed', { error: error.message });
    res.status(500).json({ error: 'Failed to read the threat ledger' });
  }
});

router.get('/threats/:id', async (req, res) => {
  try {
    const threat = await (await threatLedgerFor(req.walletAddress)).get(req.params.id);
    if (!threat) return res.status(404).json({ error: 'no such threat' });
    res.json({ threat });
  } catch (error) {
    log.error('Threat read failed', { id: req.params.id, error: error.message });
    res.status(500).json({ error: 'Failed to read the threat' });
  }
});

// ── The watch list ──────────────────────────────────────────────────────────
router.get('/watch', async (req, res) => {
  try {
    res.json({ watch: await (await watchStoreFor(req.walletAddress)).load() });
  } catch (error) {
    log.error('Watch list read failed', { error: error.message });
    res.status(500).json({ error: 'Failed to read the watch list' });
  }
});

router.post('/watch/repos', async (req, res) => {
  const { path } = req.body || {};
  try {
    const result = await (await watchStoreFor(req.walletAddress)).addRepo(path);
    if (!result.ok) return res.status(400).json({ error: result.error });
    log.info('repo added to the security watch', { path, wallet: req.walletAddress });
    res.status(201).json({ repo: result.repo, watch: result.watch });
  } catch (error) {
    log.error('Watch list add failed', { path, error: error.message });
    res.status(400).json({ error: error.message });
  }
});

router.delete('/watch/repos/:id', async (req, res) => {
  try {
    const result = await (await watchStoreFor(req.walletAddress)).removeRepo(req.params.id);
    if (!result.ok) return res.status(404).json({ error: result.error });
    log.info('repo removed from the security watch', { id: req.params.id, wallet: req.walletAddress });
    res.json({ watch: result.watch });
  } catch (error) {
    log.error('Watch list remove failed', { id: req.params.id, error: error.message });
    res.status(500).json({ error: 'Failed to remove the watched repo' });
  }
});

router.put('/watch/host', async (req, res) => {
  const { expectedPorts } = req.body || {};
  try {
    const host = await (await watchStoreFor(req.walletAddress)).setExpectedPorts(expectedPorts);
    log.info('host expected ports set', { ports: host.expectedPorts, wallet: req.walletAddress });
    res.json({ host });
  } catch (error) {
    log.error('Host watch update failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

// ── The scan ────────────────────────────────────────────────────────────────
router.get('/scan', async (req, res) => {
  try {
    res.json({ scan: await readScanState(req.walletAddress) });
  } catch (error) {
    log.error('Scan state read failed', { error: error.message });
    res.status(500).json({ error: 'Failed to read the scan state' });
  }
});

// A manual run of the operator's house — their "now". The scheduler's
// per-house in-flight guard makes this safe to press during a scheduled run.
router.post('/scan/run', async (req, res) => {
  try {
    log.info('manual security scan triggered', { wallet: req.walletAddress });
    const summary = await runSecurityScan({ wallet: req.walletAddress, trigger: 'manual' });
    res.json({ summary });
  } catch (error) {
    log.error('Manual security scan failed', { error: error.message });
    res.status(500).json({ error: 'Failed to run the security scan' });
  }
});

// ── The posture strip — one call for the desk's summary. ────────────────────
router.get('/posture', async (req, res) => {
  try {
    const [cso, entries, watch] = await Promise.all([
      csoDesignation.getOfficer(req.walletAddress),
      threatLedgerFor(req.walletAddress).then((ledger) => ledger.load()),
      watchStoreFor(req.walletAddress).then((store) => store.load()),
    ]);
    res.json({
      cso,
      counts: threatCounts(entries),
      watch: { repos: watch.repos.map((r) => ({ id: r.id, path: r.path, hasLockfile: r.hasLockfile })), host: watch.host },
    });
  } catch (error) {
    log.error('Security posture read failed', { error: error.message });
    res.status(500).json({ error: 'Failed to read the security posture' });
  }
});

export default router;
