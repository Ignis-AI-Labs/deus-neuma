/**
 * served-model-truth — the canonical channel for WHAT IS SERVING RIGHT NOW.
 *
 * Split out of llama-server-supervisor.js (frozen at its size ratchet) along
 * the CQ-036 seam: the supervisor COMMANDS the process; this module only ever
 * READS the truth of it. The supervisor re-exports everything here, so its
 * importers see zero change and the one-channel law keeps a single home.
 */
import { pidAlive, readClaim, readSelection } from './substrate-claim-registry.js';
import { getActiveModel, getConfig } from './llm-selection.js';
import { servedModelIdentity, servedKeyFromLive } from './serving-identity.js';
import { resolveServingLaunchConfig } from './serving-launch-config.js';

import { isServing } from './served-health-cache.js';
export { isServing, expireServedTruth } from './served-health-cache.js';

// The served truth after a backend restart: the spawn's persisted claim —
// the llama-server outlives us, and the claim names what it ACTUALLY serves.
// A dead claim names nothing (the env's resting declaration stands).
export const claimedLaunch = (cfg) => {
  const claim = readClaim();
  return claim?.model && pidAlive(claim.pid)
    ? { ...cfg, model: claim.model, servingModel: claim.servingModel ?? cfg.servingModel }
    : cfg;
};

/**
 * The LIVE half of the channel alone: what a healthy server itself answers,
 * mapped to a public identity (fd descriptors resolved via claim/kernel) —
 * null when no server answers or the answer carries no nameable identity.
 * NO resting fallback lives here: the focus-adoption law (substrate-
 * lifecycle) may only ever adopt a live answer, never a fallback echoing the
 * very default it exists to outrank. Impure.
 * @param {NodeJS.ProcessEnv} env
 * @param {ReturnType<typeof resolveServingLaunchConfig>} [launch]
 */
export const liveServedKey = async (env, launch = null) => {
  const cfg = launch || resolveServingLaunchConfig(env);
  try {
    if (!(await isServing(cfg.port, cfg.host))) return null;
    const live = await getActiveModel().catch(() => null);
    const mapped = await servedModelIdentity(live?.id).catch(() => null)
      || await servedModelIdentity(live?.name).catch(() => null);
    return servedKeyFromLive(live, mapped);
  } catch {
    return null;
  }
};

/**
 * The canonical, single source of truth for the model the (supervised or
 * externally) running server is actually serving right now.
 *
 * Priority (the "exact same channel"):
 * 1. If the port is currently serving, query the live server (/v1/models)
 *    to get what it is *actually* loaded with — this works even for servers
 *    started outside NEUMA.
 * 2. Live persisted claim (from when NEUMA last started it).
 * 3. The resting target: persisted selection, then env/config — the
 *    server's truth always outranks intent.
 *
 * This must be used everywhere: route resolution, telemetry, status writer,
 * substrate detector, frontend defaults, etc. No duplicated logic.
 */
export const activeServedModelKey = async (env) => {
  const launch = resolveServingLaunchConfig(env);

  // 1. Live server query when serving (even external).
  const liveKey = await liveServedKey(env, launch);
  if (liveKey) return liveKey;

  // 2. Claim.
  const claimed = claimedLaunch(launch);
  if (claimed.servingModel && claimed.servingModel !== launch.servingModel) {
    return claimed.servingModel;
  }

  // 3. Resting target (persisted selection, then env or config).
  const cfg = getConfig();
  return readSelection()?.key || launch.servingModel || launch.model || cfg.model || 'local-model';
};
