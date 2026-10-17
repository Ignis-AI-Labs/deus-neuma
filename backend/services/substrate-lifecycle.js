/**
 * Substrate lifecycle — provider-aware orchestration over the two local-serving
 * backends, so ignite / status / launch-preflight behave the same to the desk
 * whether the substrate is a backend-supervised llama-server or LM Studio's lms.
 *
 *   llama-server  → NEUMA-owned process (llama-server-supervisor.js)
 *   lm-studio     → LM Studio CLI ignition (substrate-ignition.js)
 *
 * Pure decisions (preflightDecision, toIgnitionStatus) are separated from the
 * exec boundary (RULE 0). The impure runners take the resolved config + launch
 * config as arguments so they are provable against a real smoke server on a
 * test port without touching the machine's real config.
 */
import { getConfig, setConfig, expireRuntimeModelCaches } from './llm-provider.js';
import { activeLaunchConfig, supervisorStatus, startSupervised, stopSupervised, reloadSupervised, selectSubstrateModel, isServing, readClaim } from './llama-server-supervisor.js';
import { liveServedKey } from './served-model-truth.js';
import { readSelection } from './substrate-claim-registry.js';
import { listCatalog } from './model-catalog.js';
import { matchCatalogModel } from './substrate-model-view.js';
import { getIgnitionStatus, igniteSubstrate } from './substrate-ignition.js';
import { startIdleMonitor, markActivity } from './substrate-idle.js';
import { standbySettings } from './standby-settings.js';
import { createLogger } from './logger.js';

const log = createLogger('SubstrateLifecycle');

/**
 * Decide what a launch-time preflight should do for a local substrate. Pure.
 * Only the backend-supervised provider (llama-server) is auto-booted; remote
 * and lms-managed providers report their state but are never spawned here.
 * @param {{provider: string, serving: boolean, ready: boolean}} state
 * @returns {{action: 'serving'|'boot'|'not-ready'|'skip', reason: string}}
 */
export const preflightDecision = ({ provider, serving, ready }) => {
  if (provider !== 'llama-server') return { action: 'skip', reason: `provider ${provider} is not backend-supervised` };
  if (serving) return { action: 'serving', reason: 'substrate already serving' };
  if (!ready) return { action: 'not-ready', reason: 'llama-server binary/model/adapters not all present' };
  return { action: 'boot', reason: 'substrate down — booting' };
};

/**
 * Map supervisor status to the ignition-status shape the desk already consumes
 * ({ targetLoaded, igniting, lastError, available, target }). Pure — so the
 * llama-server path and the lms path speak one contract to the frontend.
 * @param {Awaited<ReturnType<typeof supervisorStatus>>} st
 * @param {string} targetModel
 */
export const toIgnitionStatus = (st, targetModel) => ({
  available: st.launch.ready,
  target: targetModel,
  targetLoaded: st.serving,
  // "igniting" = we own a process that isn't healthy yet (a boot in flight)
  igniting: st.owned && !st.serving ? { startedAt: st.startedAt } : null,
  lastError: st.lastError,
  loaded: st.serving ? [{ modelKey: targetModel, status: 'loaded' }] : [],
});

// The substrate surface addresses the LOCAL serving lane: only lm-studio has
// its own CLI ignition; every other machine provider (including a restored
// cloud choice) supervises llama-server — a substrate ignite must never land
// on the lms lane just because the boot restored openai (2026-08-20). Pure.
const isSupervised = (cfg) => cfg.provider !== 'lm-studio';

/**
 * THE FOCUS LAW (Design note, 2026-08-21: the model the operator loaded LAST is the
 * standing focus — it stays the focus until HE changes it, and no relight may
 * fall past it to an env default. The selection marker already outranked env
 * at launch; what was missing was the other direction: a model loaded on the
 * LIVE server through any door but the desk picker never became the marker,
 * so the next relight landed back on the default over the operator's head.
 * This adopts the live truth as the standing selection. Only a healthy
 * server's own answer, matched onto a real catalog row, ever adopts — a
 * resting fallback can never launder the very default this law outranks.
 * Impure. @returns {Promise<string|null>} the adopted catalog id, or null
 */
export const adoptLiveSelection = async (env = process.env) => {
  const key = await liveServedKey(env);
  if (!key) return null;
  const row = matchCatalogModel(listCatalog(env), key);
  if (!row?.path || readSelection()?.path === row.path) return null;
  selectSubstrateModel(row.path, row.id);
  log.info('live server truth adopted as the standing focus', { model: row.id });
  return row.id;
};

// impure — provider-aware ignition status for the desk's poll
export const ignitionStatus = async (cfg, launchCfg, lmsTargetKey) => {
  if (isSupervised(cfg)) {
    const st = await supervisorStatus(launchCfg);
    return toIgnitionStatus(st, launchCfg.model);
  }
  return getIgnitionStatus(lmsTargetKey);
};

// impure — lock the active connection to the supervised substrate. Ignite is
// the authoritative act: after it, NEUMA is pointed at what was just lit, so
// the […] split cannot happen.
const lockConnection = (launchCfg) => {
  setConfig({ provider: 'llama-server', endpoint: `http://${launchCfg.host}:${launchCfg.port}` });
};

/**
 * Provider-aware ignition. For llama-server: lock the connection, then spawn
 * fire-and-observe (the desk polls ignitionStatus for completion — a 31GB load
 * must never block the request). A `selection` ({path, key} from the model
 * catalog) points the supervised substrate at a different model: the selection
 * is recorded (one truth for every later caller), then the server reloads.
 * A switch refuses while a being is mid-generation, and refuses to touch a
 * server NEUMA does not own. For lm-studio: the existing lms load. Impure.
 * @param {{path: string, key: string}|null} [selection]
 * @returns {Promise<{status: string}>}
 */
export const igniteConfigured = async (cfg, launchCfg, lmsTarget, selection = null) => {
  if (isSupervised(cfg)) {
    const servingNow = await isServing(launchCfg.port, launchCfg.host);
    // Refusal gates precede the selection commit: a refused ignite leaves no
    // trace in the runtime or persisted selection (a poisoned selection made
    // the next summon boot a model nobody successfully launched).
    if (servingNow && selection && selection.path !== readClaim()?.model) {
      const st = await supervisorStatus(launchCfg);
      if (!st.owned) return { status: 'unowned' };
      if (await substrateBusy(launchCfg)) return { status: 'busy' };
    }
    if (selection) {
      selectSubstrateModel(selection.path, selection.key);
      // A deliberate switch lands on the very next turn: the caps TTL and
      // think-behavior cache describe the model that WAS serving (friction-map
      // B2 — the expiry seam existed and was never wired).
      expireRuntimeModelCaches();
    }
    const bootCfg = selection ? activeLaunchConfig(process.env) : launchCfg;
    lockConnection(bootCfg);
    if (servingNow && (!selection || selection.path === readClaim()?.model)) {
      return { status: 'already-loaded' };
    }
    markActivity();
    // A selection always rides the reload lane: it drains an in-flight boot
    // and stops any live child before spawning — a mid-boot switch that
    // JOINED the dying boot let the OLD model win (the 2026-07-19 race).
    const boot = selection ? reloadSupervised(bootCfg) : startSupervised(bootCfg);
    boot.catch((err) => log.error('llama-server ignition failed', { err: err.message }));
    return { status: 'igniting' };
  }
  return igniteSubstrate(lmsTarget);
};

// impure — is any slot mid-generation right now? Safe default: an unknown
// answer (unreachable / bad response) reads as BUSY, so the idle monitor never
// yanks VRAM from a substrate it can't confirm is quiet.
/**
 * Is the substrate mid-generation right now? Fail-closed: an unreadable
 * /slots reads as busy, so callers that would STOP the server (idle-unload,
 * the verify reload lane) never yank a turn out from under a being.
 * @param {{host: string, port: number}} launchCfg
 */
export const substrateBusy = async (launchCfg) => {
  try {
    const res = await fetch(`http://${launchCfg.host}:${launchCfg.port}/slots`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return true;
    const slots = await res.json();
    return Array.isArray(slots) && slots.some((s) => s.is_processing);
  } catch {
    return true;
  }
};

/**
 * Arm the idle-unload monitor: after `idleMinutes` with no inference and no
 * in-flight generation, stop the supervised substrate to return VRAM (reloaded
 * on the next summon by createStreamRequest → ensureServing). Impure; returns a
 * stop function. 0 disables.
 * @param {{idleMinutes: number}} opts
 */
export const startSubstrateIdleMonitor = ({ idleMinutes, standby = standbySettings }) => {
  return startIdleMonitor({
    idleMs: (idleMinutes || 0) * 60000,
    intervalMs: 60000,
    // The live STANDBY window — re-read every tick so the header switch takes
    // effect within the minute, never at the next restart.
    resolveIdleMs: () => standby.idleMs(),
    check: async () => {
      // The focus law's standing heartbeat: within a tick of the operator
      // loading a model on the live server, it IS the selection — so every
      // later relight lands on it, never back on a default. Guarded: a
      // failed adoption must never stop the idle guard itself.
      await adoptLiveSelection(process.env).catch(() => {});
      // resolved per tick so the monitor follows a runtime model selection
      const launchCfg = activeLaunchConfig(process.env);
      const st = await supervisorStatus(launchCfg);
      const busy = st.serving ? await substrateBusy(launchCfg) : false;
      return { serving: st.serving, owned: st.owned, busy };
    },
    unload: () => stopSupervised(),
  });
};

/**
 * Launch-time preflight: every app launch, if the supervised substrate is down
 * and can boot, boot it fire-and-observe. Never throws — a preflight must not
 * stop the server from listening (mirrors server.js's guarded boot steps).
 * @returns {Promise<{action: string, reason: string}>}
 */
export const runPreflight = async () => {
  try {
    const cfg = getConfig();
    // Focus law first: a live server's model becomes the standing selection
    // BEFORE the launch target resolves, so a preflight can never read a
    // stale default past what the operator actually has loaded.
    await adoptLiveSelection(process.env).catch(() => {});
    const launchCfg = activeLaunchConfig(process.env);
    const st = await supervisorStatus(launchCfg);
    const decision = preflightDecision({ provider: cfg.provider, serving: st.serving, ready: st.launch.ready });
    log.info('substrate preflight', decision);
    if (decision.action === 'boot') {
      lockConnection(launchCfg);
      markActivity(); // a preflight boot is activity — same reap-at-birth guard as ignite
      startSupervised(launchCfg).catch((err) => log.error('preflight boot failed', { err: err.message }));
    }
    return decision;
  } catch (err) {
    log.error('substrate preflight errored — continuing', { err: err.message });
    return { action: 'skip', reason: `preflight error: ${err.message}` };
  }
};
