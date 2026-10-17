/**
 * Bench routes — the operator's window onto the benchmark harness: the read
 * plane (status, queue, runs, reports, scoreboard, catalog, incidents) and
 * the launch plane (preflight, launch, stop) through the closed verb
 * catalog. Mounted at /api/v1/bench. All routes require the operator's
 * Bearer token; every launch is journaled with the wallet that asked for it.
 *
 * The harness is sovereign: this plane reads its files and spawns its verbs,
 * and never writes into it. With no harness at the resolved root every route
 * answers 503 BENCH_HARNESS_ABSENT — a desk on a machine without the
 * checkout degrades, never crashes.
 *
 * Error shape is structured: { error: { code, message } } — the server's
 * refusal reason always reaches the caller.
 */

import express from 'express';
import { stat } from 'node:fs/promises';
import { requireAuth } from '../services/auth.js';
import { harnessRoot, available, resolveInside, benchWatchJournalPath } from '../services/bench/bench-paths.js';
import { getBenchStatus, readLatestNightStatus, readServingIncidents, readJsonlTail } from '../services/bench/bench-status.js';
import { listBundles, readBundleArtifact, readScoreboard, listRuns } from '../services/bench/bench-reports.js';
import { listCells, listModels, listPlans } from '../services/bench/bench-catalog.js';
import { launch, stopOwned, ownedStatus } from '../services/bench/bench-launch.js';
import { chainStates } from '../services/bench/bench-matched.js';
import { liveProgress } from '../services/bench/bench-live.js';
import { pressComparisonReport } from '../services/bench/bench-comparison-report.js';
import { readChainReport } from '../services/bench/bench-failure-report.js';
import { listOwnedLanes } from '../services/bench/bench-lanes.js';
import { startProofRun, getProofRunState } from '../services/bench/proof-runner.js';
import { listProofs, readProof } from '../services/bench/proof-certificate.js';
import { pressDocument } from '../services/doc-press/index.js';
import benchShareRouter from './bench-share-routes.js';
import { diagnoseComparison } from '../services/bench/bench-diagnose.js';
import { readRunEvidence } from '../services/bench/bench-run-evidence.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('Bench');

const router = express.Router();
router.use(requireAuth);

const fail = (res, status, code, message) => res.status(status).json({ error: { code, message } });

// The harness gate — every route degrades to 503 when no harness stands.
router.use((req, res, next) => {
  if (!available()) {
    return fail(res, 503, 'BENCH_HARNESS_ABSENT',
      `no benchmark harness at ${harnessRoot()} — set NEUMA_BENCH_HARNESS_PATH`);
  }
  next();
});

// Map a launch-plane refusal verbatim; coded catalog errors (bad id/artifact)
// are client faults.
const mapPlaneResult = (res, result) => {
  if (!result.ok) return fail(res, result.status, result.code, result.message);
  return res.json(result);
};

const catalogError = (res, err) => {
  if (err.code === 'BENCH_BAD_ID' || err.code === 'BENCH_BAD_ARTIFACT') {
    return fail(res, 400, err.code, err.message);
  }
  log.error('bench read failed', { error: err.message });
  return fail(res, 500, 'BENCH_READ_FAILED', err.message);
};

// ── Read plane ─────────────────────────────────────────────────────────────

// The desk's one-call OVERVIEW: serving, rig lock, last night, daemons,
// incidents, the children THIS plane owns, and the matched chain in flight.
router.get('/status', async (req, res) => {
  try {
    const [status, live] = await Promise.all([getBenchStatus(), liveProgress()]);
    res.json({ ...status, owned: ownedStatus(), chain: chainStates(), live });
  } catch (error) {
    log.error('bench status read failed', { error: error.message });
    fail(res, 500, 'BENCH_READ_FAILED', 'Failed to read bench status');
  }
});

// THE WATCH, light enough to poll from the composer (BenchRunChip): every
// benchmark running on this machine — whoever launched it — with its items
// done of total, and this desk's matched set. No serving, GPU or daemon probes.
router.get('/live', async (req, res) => {
  try {
    res.json({ live: await liveProgress(), chain: chainStates() });
  } catch (error) {
    log.error('bench live read failed', { error: error.message });
    fail(res, 500, 'BENCH_READ_FAILED', 'Failed to read the running benchmarks');
  }
});

// ONE SET'S REPORT (bench-comparison-report.js) — the branded page the chat's
// card opens: pressed when the set settled, pressed now when it was not.
// Answers the paths: the desk opens the HTML in the browser; the PDF is the pressed copy.
router.get('/comparisons/:id/report', async (req, res) => {
  try {
    const pressed = await pressComparisonReport(req.params.id);
    if (!pressed) return fail(res, 404, 'BENCH_NO_COMPARISON', `no receipts for ${String(req.params.id).slice(0, 64)}`);
    res.json(pressed);
  } catch (error) {
    log.error('bench report press failed', { id: req.params.id, error: error.message });
    fail(res, 500, 'BENCH_READ_FAILED', 'Failed to press the report');
  }
});
// The latest night window's parsed status (the queue the window worked).
router.get('/queue', async (req, res) => {
  try {
    res.json({ queue: await readLatestNightStatus() });
  } catch (error) {
    log.error('bench queue read failed', { error: error.message });
    fail(res, 500, 'BENCH_READ_FAILED', 'Failed to read the night queue');
  }
});

router.get('/runs', async (req, res) => {
  try {
    const limit = Number.parseInt(req.query.limit, 10);
    res.json({ runs: await listRuns(harnessRoot(), Number.isInteger(limit) ? limit : undefined) });
  } catch (error) {
    log.error('bench runs read failed', { error: error.message });
    fail(res, 500, 'BENCH_READ_FAILED', 'Failed to list runs');
  }
});

router.get('/reports', async (req, res) => {
  try {
    res.json({ bundles: await listBundles() });
  } catch (error) {
    log.error('bench bundles read failed', { error: error.message });
    fail(res, 500, 'BENCH_READ_FAILED', 'Failed to list report bundles');
  }
});

// One bundle: its metadata plus the REPORT.md text.
router.get('/reports/:bundle', async (req, res) => {
  try {
    const { bundle } = req.params;
    const report = await readBundleArtifact(harnessRoot(), bundle, 'report');
    let mtimeMs = null;
    try {
      mtimeMs = (await stat(resolveInside(harnessRoot(), 'reports', 'bundles', bundle))).mtimeMs;
    } catch { /* no dir — the null report below carries the 404 */ }
    if (report === null && mtimeMs === null) {
      return fail(res, 404, 'BENCH_BUNDLE_NOT_FOUND', `no bundle ${bundle}`);
    }
    res.json({ bundle: { id: bundle, mtimeMs }, report });
  } catch (error) {
    catalogError(res, error);
  }
});

router.get('/reports/:bundle/:artifact', async (req, res) => {
  try {
    const text = await readBundleArtifact(harnessRoot(), req.params.bundle, req.params.artifact);
    if (text === null) {
      return fail(res, 404, 'BENCH_ARTIFACT_NOT_FOUND', `bundle ${req.params.bundle} has no ${req.params.artifact} artifact`);
    }
    res.json({ bundle: req.params.bundle, artifact: req.params.artifact, text });
  } catch (error) {
    catalogError(res, error);
  }
});

router.get('/scoreboard', async (req, res) => {
  try {
    res.json(await readScoreboard());
  } catch (error) {
    log.error('bench scoreboard read failed', { error: error.message });
    fail(res, 500, 'BENCH_READ_FAILED', 'Failed to read the scoreboard');
  }
});

router.get('/catalog', async (req, res) => {
  try {
    res.json({ cells: await listCells() });
  } catch (error) {
    log.error('bench catalog read failed', { error: error.message });
    fail(res, 500, 'BENCH_READ_FAILED', 'Failed to list cells');
  }
});

router.get('/models', async (req, res) => {
  try {
    res.json({ models: await listModels() });
  } catch (error) {
    log.error('bench models read failed', { error: error.message });
    fail(res, 500, 'BENCH_READ_FAILED', 'Failed to list models');
  }
});

// The session wallet's OWN lanes — house neuma plus witness lanes — for the
// identity arms' picker. Empty when none; the launch boundary re-proves
// ownership from disk regardless of what this list showed.
router.get('/lanes', async (req, res) => {
  try {
    res.json({ lanes: await listOwnedLanes(req.walletAddress) });
  } catch (error) {
    log.error('bench lanes read failed', { error: error.message });
    fail(res, 500, 'BENCH_READ_FAILED', 'Failed to list your lanes');
  }
});

router.get('/plans', async (req, res) => {
  try {
    res.json({ plans: await listPlans() });
  } catch (error) {
    log.error('bench plans read failed', { error: error.message });
    fail(res, 500, 'BENCH_READ_FAILED', 'Failed to list plans');
  }
});

// Both incident journals: the harness's serving tail AND this plane's own
// watch journal (the alerter's durable record).
router.get('/incidents', async (req, res) => {
  try {
    res.json({
      serving: await readServingIncidents(),
      watch: await readJsonlTail(benchWatchJournalPath()),
    });
  } catch (error) {
    log.error('bench incidents read failed', { error: error.message });
    fail(res, 500, 'BENCH_READ_FAILED', 'Failed to read incidents');
  }
});

// WHAT HAPPENED in one run: every stage it executed (exit code, signal,
// timeout, abort) and the tail of each log the receipt sealed — stderr first.
router.get('/runs/:runId/evidence', async (req, res) => {
  try {
    const result = await readRunEvidence(req.params.runId);
    if (!result) return fail(res, 404, 'BENCH_NO_RUN', `no receipt for run ${req.params.runId}`);
    res.json(result);
  } catch (error) {
    if (error.code === 'BENCH_BAD_ID') return fail(res, 400, 'BENCH_BAD_ID', 'runId must be letters, digits and dashes');
    log.error('bench run evidence failed', { error: error.message });
    fail(res, 500, 'BENCH_READ_FAILED', 'Failed to read the run evidence');
  }
});

// THE RUN DIAGNOSIS (#557): every missed item of a matched set classified by
// cause and paired against BARE — the JSON plus the copyable markdown.
router.get('/diagnose/:comparisonId', async (req, res) => {
  try {
    const result = await diagnoseComparison(req.params.comparisonId);
    if (!result) return fail(res, 404, 'BENCH_NO_COMPARISON', `no receipts carry comparisonId ${req.params.comparisonId}`);
    res.json(result);
  } catch (error) {
    if (error.code === 'BENCH_BAD_ID') return fail(res, 400, 'BENCH_BAD_ID', 'comparisonId must be lowercase letters, digits and dashes');
    log.error('bench diagnose failed', { error: error.message });
    fail(res, 500, 'BENCH_READ_FAILED', 'Failed to diagnose the matched set');
  }
});

// The matched set's copyable FAILURE REPORT: the chain's facts plus the log
// tail of every arm that did not come back clean. 404 when no set has run.
router.get('/chain/report', async (req, res) => {
  try {
    const report = await readChainReport();
    if (!report) return fail(res, 404, 'BENCH_NO_CHAIN', 'no matched set has run since the backend started');
    res.json(report);
  } catch (error) {
    log.error('bench chain report failed', { error: error.message });
    fail(res, 500, 'BENCH_READ_FAILED', 'Failed to build the failure report');
  }
});

// ── Launch plane ───────────────────────────────────────────────────────────

// Preflight a (cell, arm, model) triple — the harness's own gate, short verb.
// Identity arms carry their --lane/--workspace-root through the same body.
router.post('/preflight', async (req, res) => {
  const { cell, arm, model, lane, workspaceRoot } = req.body ?? {};
  const result = await launch('preflight-cell', { cell, arm, model, lane, workspaceRoot }, req.walletAddress);
  if (!result.ok) return mapPlaneResult(res, result);
  res.json({
    pid: result.pid,
    exitCode: result.exitCode,
    logFile: result.logFile,
    argv: result.argv,
    stdoutTail: (result.stdout ?? '').slice(-4000),
  });
});

// Launch a catalog verb. requireAuth already gates WHO; the catalog validates
// WHAT — validated params only ever reach argv through buildArgs.
router.post('/launch', async (req, res) => {
  const { verb, params } = req.body ?? {};
  log.info('bench launch requested', { verb, wallet: req.walletAddress });
  const result = await launch(verb, params ?? {}, req.walletAddress);
  return mapPlaneResult(res, result);
});

// The recovery console: relight serving by standing the daemons back up.
// 409 BENCH_SERVING_HEALTHY when the endpoint answers, 409 BENCH_DAEMON_RUNNING
// when the watchdog or swapper already stands (relight is their office).
router.post('/relight', async (req, res) => {
  const { model } = req.body ?? {};
  log.info('bench relight requested', { model, wallet: req.walletAddress });
  const result = await launch('relight-serving', { model }, req.walletAddress);
  return mapPlaneResult(res, result);
});

// SIGTERM the plane-owned long children (404 when the plane owns none).
router.post('/stop', async (req, res) => {
  log.info('bench stop requested', { wallet: req.walletAddress });
  const result = await stopOwned();
  return mapPlaneResult(res, result);
});

// ── THE PROOF SUITE — benchmark the loaded model, keep the certificate ───────

// Start a run. 202 with the run id; 409 BENCH_PROOF_RUNNING when one is in
// flight; 409 BENCH_RIG_LOCKED / BENCH_PLANE_BUSY while a benchmark runs;
// 409 BENCH_NOT_SERVING when no model answers (load one first).
router.post('/proof-run', async (req, res) => {
  log.info('bench proof run requested', { wallet: req.walletAddress });
  // The plane's own long child may not have taken the rig lock yet (the
  // spawn precedes the harness's lock), so the plane answers for it here.
  const busy = ownedStatus().find((child) => child.long);
  if (busy) {
    return mapPlaneResult(res, { ok: false, status: 409, code: 'BENCH_PLANE_BUSY',
      message: `the plane owns a running benchmark (${busy.verb}, started ${busy.startedAt}) — run the proof when it finishes` });
  }
  const result = await startProofRun();
  if (!result.ok) return mapPlaneResult(res, result);
  res.status(202).json({ runId: result.runId, total: result.total, run: getProofRunState() });
});

// The in-flight/last run's progress — the desk polls this while it runs.
router.get('/proof-run', async (req, res) => {
  res.json({ run: getProofRunState() });
});

// The sealed certificates, newest first.
router.get('/proofs', async (req, res) => {
  try {
    res.json({ proofs: await listProofs() });
  } catch (error) {
    log.error('bench proofs list failed', { error: error.message });
    fail(res, 500, 'BENCH_READ_FAILED', 'Failed to list proofs');
  }
});

// One certificate: the receipt plus the markdown. 404 when absent (the id is
// basename-validated inside readProof — no traversal surface).
router.get('/proofs/:id', async (req, res) => {
  const proof = await readProof(req.params.id);
  if (!proof) return fail(res, 404, 'BENCH_PROOF_NOT_FOUND', `no proof ${String(req.params.id).slice(0, 64)}`);
  res.json(proof);
});

// Press the certificate into a branded PDF through the platform's own
// doc-press (real Chromium, local — no egress). 409 BENCH_PRESS_UNAVAILABLE
// with the honest reason when this machine cannot press.
router.get('/proofs/:id/pdf', async (req, res) => {
  const proof = await readProof(req.params.id);
  if (!proof) return fail(res, 404, 'BENCH_PROOF_NOT_FOUND', `no proof ${String(req.params.id).slice(0, 64)}`);
  try {
    const { pdf } = await pressDocument({ markdown: proof.certificate, title: `neuma-bench-proof-${req.params.id}` });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="neuma-bench-proof-${req.params.id}.pdf"`);
    res.send(pdf);
  } catch (error) {
    log.error('bench proof press failed', { id: req.params.id, error: error.message });
    fail(res, 409, 'BENCH_PRESS_UNAVAILABLE', `this machine cannot press the certificate: ${error.message}`);
  }
});

// REPORTS → SUMMARY + SHARE: the charts across every benchmark and the cards
// that carry them out to the world.
router.use(benchShareRouter);

export default router;
