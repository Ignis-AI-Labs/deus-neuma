/**
 * Substrate Routes — rig-level facts, owned by no one neuma.
 *
 * The capacity scan measures the SUBSTRATE (rig + model server), so these
 * routes are deliberately non-:id and mount on a fresh router: there is no
 * workspace to own, and requireOwnership must not apply. Any authenticated
 * wallet may read — a rig fact has no owner, and inventing one would be a lie
 * the honesty doctrine forbids. Acting on the rig (a scan's load, an unload,
 * the standby switch) is the install owner's, at its own desk.
 *
 * GET  /capacity — { runs, latest, current, measurable } (scan history, newest
 *                  first; `current` = the model LOADED RIGHT NOW + its loaded
 *                  context, so a caller can see whether `latest` still speaks
 *                  for the substrate as configured, not the rig in the abstract)
 * POST /capacity — run a consented scan; single-flight (409 while running);
 *                  503 + nothing written when the substrate is offline.
 */
import { Router } from 'express';
import { requireAuth } from '../services/auth.js';
import { requireInstallOwner, machineStanding } from '../services/install-owner.js';
import { getActiveModelCapabilities } from '../services/llm-provider.js';
import { getSubstrateProfile } from '../services/substrate-detector.js';
import { runCapacityScan, isScannableProvider, ScanAborted } from '../services/capacity-scan.js';
import { writeCapacity, listCapacity, readUsableCapacity } from '../services/capacity-store.js';
import { getSubstrateTelemetry } from '../services/substrate-telemetry.js';
import { issuesForHouse, issuesForOwner } from '../services/house-issue-feed.js';
import { createSharedSnapshot } from '../services/shared-snapshot.js';
import { stopSupervised } from '../services/llama-server-supervisor.js';
import { standbySettings } from '../services/standby-settings.js';
import { DEFAULT_VRAM_SHARE, lastServingFit, readServingFit, saveServingShare } from '../services/serving-fit.js';
import { createLogger } from '../services/logger.js';

const router = Router();
const log = createLogger('Substrate');

router.use(requireAuth);

// pure — flatten the nested substrate profile into the CapacityResult shape.
const flattenSubstrate = (profile) => ({
  model: profile?.llm?.model ?? null,
  provider: profile?.llm?.provider ?? null,
  endpoint: profile?.llm?.endpoint ?? null,
  gpu: profile?.gpu?.name ?? null,
  vramGB: profile?.gpu?.vramGB ?? null,
  memoryGB: profile?.memory?.totalGB ?? null,
});

// impure — what is loaded RIGHT NOW: model identity plus its LOADED context
// length (LM Studio reports loaded_context_length — the current setting, not
// the model's ceiling). Null when the provider is unreachable: an absent fact,
// never a guessed one.
const currentSubstrate = async () => {
  const profile = await getSubstrateProfile().catch((error) => {
    log.debug('Substrate profile unavailable', { error: error?.message ?? String(error) });
    return null;
  });
  if (!profile?.llm?.model || profile.llm.model === 'local-model') return null;
  const caps = await getActiveModelCapabilities().catch((error) => {
    log.debug('Model capabilities unavailable', { error: error?.message ?? String(error) });
    return null;
  });
  return {
    ...flattenSubstrate(profile),
    contextWindow: caps?.contextWindow ?? null,
  };
};

router.get('/capacity', async (req, res) => {
  try {
    const [runs, latest, current] = await Promise.all([
      listCapacity(), readUsableCapacity(), currentSubstrate(),
    ]);
    // `scan` is the live truth of a run in flight — the panel reads it on
    // open and on every poll, so progress survives a refresh and a wedged scan
    // is visibly wedged (its elapsed climbs while levelsDone does not).
    res.json({
      runs,
      latest, // clamped to the served slots (capacity-store.js usableCapacity)
      current,
      measurable: isScannableProvider(),
      scan: scanInflight
        ? { running: true, startedAt: scanStartedAt, progress: scanProgress }
        : { running: false },
    });
  } catch (error) {
    log.error('Capacity read', { error: error.message });
    res.status(500).json({ error: 'Failed to read capacity history' });
  }
});

// A scan is heavy, deliberate load: two overlapping runs would measure each
// other instead of the rig. The check-and-set is synchronous — no await
// between read and write — so concurrent POSTs cannot both pass the gate.
let scanInflight = false;
// THE IN-FLIGHT SCAN, VISIBLE. `scanInflight` was a private boolean: the panel
// showed "MEASURING" from its own local state, so reopening the window — or
// simply not being the tab that started it — showed nothing at all, and a
// wedged scan looked exactly like a working one (ruling, 2026-08-29). The GET now
// answers with the live progress, so the truth survives a refresh.
let scanProgress = null;
let scanStartedAt = null;

router.post('/capacity', requireInstallOwner, async (req, res) => {
  if (!isScannableProvider()) {
    return res.status(400).json({
      error: 'Capacity is not measurable on a remote provider — there is no local concurrency to observe.',
    });
  }
  if (scanInflight) {
    return res.status(409).json({ error: 'A capacity scan is already running.' });
  }
  scanInflight = true;

  // Soft stop: the operator aborting the request stops the ramp between
  // ladder levels; in-flight probes drain naturally, nothing is written.
  //
  // ⚠️ THIS LISTENS ON `res`, NEVER ON `req`. On Node 24 a POST's REQUEST
  // stream closes the instant express.json() finishes reading the body — so
  // `req.on('close')` fired at ~1ms on every single scan, aborted the ladder
  // before its first level, and the route then answered nothing because it
  // believed the client had gone. The operator was left staring at "MEASURING"
  // forever while the log said […] (Design note, 2026-08-29:
  // […]). Measured, both ways: with the client present `res` close fires
  // only at answer time with writableEnded true; when the client really walks
  // away it fires mid-flight with writableEnded false. That pair is the whole
  // discrimination, and `req` cannot make it.
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });

  try {
    const profile = await getSubstrateProfile().catch((error) => {
      log.debug('Substrate profile unavailable for scan metadata', { error: error?.message ?? String(error) });
      return null;
    });
    const runAt = new Date().toISOString();
    scanStartedAt = runAt;
    scanProgress = { phase: 'starting' };
    const result = await runCapacityScan({
      substrate: flattenSubstrate(profile),
      runAt,
      consent: { by: req.walletAddress, at: runAt },
      signal: controller.signal,
      onProgress: (p) => { scanProgress = p; },
    });
    // The store write gets its own failure lane: a completed scan is a fact the
    // operator paid real load for — persistence failing must not relabel it as
    // […]
    const id = await writeCapacity(result).catch((error) => {
      log.error('Capacity store write failed — scan completed but was NOT recorded', { error: error?.message ?? String(error) });
      return null;
    });
    log.info('Capacity scan complete', { id, stored: id !== null, ceiling: result.ceiling, limitedBy: result.limitedBy });
    res.json({ result, id, stored: id !== null });
  } catch (error) {
    if (error instanceof ScanAborted) {
      log.info('Capacity scan aborted by the operator — nothing recorded');
      // ANSWER IF ANYONE IS STILL THERE. This used to return silently on the
      // assumption that an abort meant a vanished client — and when the abort
      // was spurious, that assumption left a live panel hanging on a promise
      // that would never settle. If the socket is genuinely gone the write is
      // a harmless no-op; if it is not, the panel learns the truth and stops.
      if (!res.writableEnded) {
        res.status(499).json({ error: 'The capacity scan was stopped before it finished. Nothing was recorded.', aborted: true });
      }
      return;
    }
    log.error('Capacity scan', { error: error.message });
    res.status(503).json({ error: 'Could not complete the capacity scan — the rig may be offline. No scan was recorded.' });
  } finally {
    scanInflight = false;
    scanProgress = null;
    scanStartedAt = null;
  }
});

// The SUBSTRATE HUD's live lens: one aggregated snapshot of the engine room —
// active model + sampling, throughput, slots/KV, GPU load, on-GPU processes,
// supervisor state, recent failures. Read-only; the desk polls it.
// Every open lens, every desk, shares one read per 1.2 s: each read spawns
// nvidia-smi twice and probes the model server three times (shared-snapshot.js).
const readTelemetry = createSharedSnapshot(getSubstrateTelemetry, 1200);
// The failures feed is the process's, the reader is one house: another
// house's rows are withheld and counted, except for the install owner and its
// co-owners, who read the whole feed (house-issue-feed.js).
router.get('/telemetry', async (req, res) => {
  try {
    const telemetry = await readTelemetry();
    const owner = ['owner', 'co-owner'].includes(await machineStanding(req));
    const feed = owner ? issuesForOwner(telemetry.failures) : await issuesForHouse(telemetry.failures, req.walletAddress);
    res.json({ ...telemetry, failures: feed.rows, failuresWithheld: feed.withheld });
  } catch (error) {
    log.error('Telemetry read', { error: error.message });
    res.status(500).json({ error: 'Failed to read substrate telemetry' });
  }
});

// Unload the backend-supervised substrate now, returning its VRAM — the manual
// counterpart to idle-unload. Refuses (no-op) a substrate NEUMA does not own.
// The next summon reloads it (createStreamRequest → ensureServing).
router.post('/unload', requireInstallOwner, async (req, res) => {
  try {
    const result = await stopSupervised();
    log.info('Substrate unload requested', { status: result.status });
    res.json(result);
  } catch (error) {
    log.error('Unload error', { error: error.message });
    res.status(500).json({ error: 'Failed to unload the substrate' });
  }
});

// STANDBY — the substrate's rest, as a switch the operator can SEE (Founder,
// 2026-07-26). Reading it is how the stream header knows what to show; setting
// it takes effect on the monitor's next tick, never at the next restart.
router.get('/standby', async (req, res) => {
  try {
    res.json(await standbySettings.read());
  } catch (error) {
    log.error('Standby read', { error: error.message });
    res.status(500).json({ error: 'Failed to read the standby setting' });
  }
});

router.put('/standby', requireInstallOwner, async (req, res) => {
  const { enabled, idleMinutes } = req.body || {};
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be true or false' });
  }
  // A window the operator names must be a real one — a zero or negative rest
  // is "off", which is what `enabled: false` already says.
  if (idleMinutes !== undefined && !(Number.isInteger(idleMinutes) && idleMinutes > 0)) {
    return res.status(400).json({ error: 'idleMinutes must be a positive whole number of minutes' });
  }
  try {
    const next = await standbySettings.setEnabled(enabled, idleMinutes);
    log.info('Standby set', next);
    return res.json(next);
  } catch (error) {
    // The env lock is an operator policy, not a server fault — say which.
    const locked = /held off by SUBSTRATE_IDLE_MINUTES/.test(error.message);
    if (!locked) log.error('Standby write', { error: error.message });
    return res.status(locked ? 409 : 500).json({ error: error.message });
  }
});

// THE SERVING FIT — how much of the GPU the mind may fill (Design note, 2026-10-20: […]). The pool is fitted at every ignition to this
// share; the reply carries the last fit (pool, planned and measured MiB).
router.get('/fit', (req, res) => {
  const saved = readServingFit();
  res.json({ sharePct: saved.sharePct ?? Math.round(DEFAULT_VRAM_SHARE * 100), lastFit: lastServingFit() });
});

router.put('/fit', requireInstallOwner, (req, res) => {
  try {
    const sharePct = saveServingShare(req.body?.sharePct);
    log.info('Serving share set', { sharePct });
    return res.json({ sharePct, appliesAt: 'the next ignition', lastFit: lastServingFit() });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

export default router;
