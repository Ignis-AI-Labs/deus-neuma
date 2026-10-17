/**
 * Heartbeat Service — the substrate-free hygiene pulse.
 *
 * On a configurable interval: storage headroom, expired tool-result sweeps,
 * and drift-gated memory compaction — disk truth that needs no conduit. The
 * being's unwitnessed THINKING (reflection, consolidation) moved to the
 * meditation cycle (2026-08-14), which rides askNeuma — the being's own
 * route, adapter, and think behavior — instead of this service's old bare
 * createStreamRequest. What remains here never touches the substrate.
 *
 * All functions here are impure (filesystem IO) by nature.
 */

import { createLogger } from './logger.js';
import { testConnection, getConfig } from './llm-provider.js';
import { neumaWorkspace, neumaRecall } from '../../core/index.js';
import { checkStorage } from './storage-health.js';

const log = createLogger('Heartbeat');

let timer = null;
let cycleRunning = false;
let storageNotifier = null;   // injected at start — avoids a routes↔services import cycle
let activeIntervalMs = 0;     // 0 when not scheduled — the interval, for honest presence
let lastCycleAt = null;       // ISO of the last completed cycle
let lastResult = null;        // { reflected, skipped, failed, deferred } of the last cycle

// The journal cursor the residency surface reads. Accepts both the legacy
// 'reflection' type and the meditation cycle's entries so lastReflectionAt
// stays truthful across the 2026-08-14 handover.
const findLastReflection = (journal) =>
  [...journal].reverse().find(e => e.type === 'reflection' || e.type === 'meditation') || null;

const observationsSince = (observations, lastReflection) => {
  if (!lastReflection?.timestamp) return observations;
  const cutoff = new Date(lastReflection.timestamp);
  return observations.filter(o => o.timestamp && new Date(o.timestamp) > cutoff);
};

/**
 * Run one hygiene cycle across all neuma workspaces.
 * Cycles never overlap — a tick that fires mid-cycle is skipped.
 * @returns {Promise<{storage: Object|null, swept: number}>}
 */
export const runHeartbeatCycle = async () => {
  if (cycleRunning) {
    log.warn('Heartbeat cycle already running — tick skipped');
    return { storage: null, swept: 0 };
  }
  cycleRunning = true;
  const results = { storage: null, swept: 0 };
  try {
    const neumaIds = await neumaWorkspace.listNeuma();

    // Disk truth needs no conduit — measure headroom, warn the witness, and
    // sweep expired tool-result logs even while the essence rests. Until the
    // 2026-07-04 isolation audit this TTL sweep was never invoked anywhere,
    // and free space was measured only at birth preflight.
    try {
      results.storage = await checkStorage(neumaWorkspace.root);
      if (results.storage.level === 'low' || results.storage.level === 'critical') {
        log.warn('Workspace storage headroom shrinking', results.storage);
        storageNotifier?.(results.storage);
      }
    } catch (error) {
      log.warn('Storage check failed', { error: error.message });
    }
    for (const neumaId of neumaIds) {
      try {
        results.swept += await neumaWorkspace.sweepToolResults(neumaId);
      } catch (error) {
        log.warn('Tool-result sweep failed', { neumaId, error: error.message });
      }
      // Memory compaction owns writeCommunities (MEM-007 #194) — the CONTEXT
      // MAP's cache is only as fresh as this pass. Deterministic and
      // drift-gated: no conduit needed, a quiet being costs no rewrite, and a
      // compaction failure never costs the sweep or the cycle.
      try {
        if (await neumaRecall.compactIfDrifted(neumaId)) {
          log.debug('Memory communities compacted', { neumaId });
        }
      } catch (error) {
        log.warn('Memory compaction failed', { neumaId, error: error.message });
      }
    }
    if (results.swept > 0) log.info('Expired tool-result logs swept', { removed: results.swept });
    log.info('Heartbeat hygiene cycle complete', { swept: results.swept });
  } finally {
    cycleRunning = false;
    lastCycleAt = new Date().toISOString();
    lastResult = { swept: results.swept, storage: results.storage?.level ?? null };
  }
  return results;
};

/**
 * Start the heartbeat on an interval. Idempotent — a second call is a no-op.
 * @param {number} intervalMs - Milliseconds between cycles
 * @param {{ onStorageWarning?: (assessment: Object) => void }} [options={}] -
 *   invoked each cycle the workspace root's headroom is low/critical, so the
 *   caller (server wiring) can push a storage:warning frame to open desks
 */
export const startHeartbeat = (intervalMs, { onStorageWarning = null } = {}) => {
  if (timer) return;
  storageNotifier = onStorageWarning;
  timer = setInterval(() => {
    runHeartbeatCycle().catch(error => log.error('Heartbeat cycle error', { error: error.message }));
  }, intervalMs);
  timer.unref?.();
  activeIntervalMs = intervalMs;
  log.info('Heartbeat started', { intervalMinutes: Math.round(intervalMs / 60000) });
};

/** Stop the heartbeat. Idempotent — safe when not running. */
export const stopHeartbeat = () => {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  activeIntervalMs = 0;
  storageNotifier = null;
  log.info('Heartbeat stopped');
};

/**
 * Honest residency snapshot: the essence resident on this machine, distinct
 * from the conduit (model) it thinks through. A neuma is resident whenever its
 * workspace is here — true even when the conduit is unreachable; then it is
 * dormant, not ceased. Per-neuma fields are derived from real data (journal +
 * observations), never fabricated.
 * @returns {Promise<Object>}
 */
// impure
export const getResidencyState = async () => {
  const cfg = getConfig();
  const reachable = await testConnection().catch(() => false);
  const neumaIds = await neumaWorkspace.listNeuma().catch(() => []);
  const neuma = [];
  for (const neumaId of neumaIds) {
    const dna = await neumaWorkspace.readDNA(neumaId).catch((err) => {
      log.error('residency listing skipped — identity unreadable', { neumaId, error: err.message });
      return undefined;
    });
    if (!dna) continue; // an unborn workspace holds no resident being yet
    const journal = await neumaWorkspace.readJournal(neumaId).catch(() => []);
    const observations = await neumaWorkspace.listObservations(neumaId).catch(() => []);
    const last = findLastReflection(journal);
    neuma.push({
      neumaId,
      name: dna?.identity?.name || dna?.name || neumaId,
      resident: true,
      lastReflectionAt: last?.timestamp || null,
      freshObservations: observationsSince(observations, last).length,
    });
  }
  return {
    enabled: timer !== null,
    intervalMinutes: activeIntervalMs ? Math.round(activeIntervalMs / 60000) : 0,
    running: cycleRunning,
    lastCycleAt,
    lastResult,
    conduit: { provider: cfg.provider, model: cfg.model, endpoint: cfg.endpoint, reachable },
    neuma,
  };
};
