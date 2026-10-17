// Harness UI — the opening banner and the in-harness model/server commands.
//
// The banner is the CLI's introduction (the way every terminal harness opens):
// wordmark, who is signed in, the ground, the substrate line (LIVE serving
// truth, not a name guess), the house census, and the keys. The commands here
// are thin terminal doors over the SAME stores the platform routes use —
// neuma-routes-store (sovereignty-checked writes) and substrate-detector —
// never reimplementations.
//
// Pure composers are exported for tests; IO lives in the command runners.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const uiDir = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(uiDir, '..', '..', 'package.json'), 'utf8'));

/** Shorten a wallet address for display. Pure. */
export const shortWallet = (address) => (typeof address === 'string' && address.length > 18
  ? `${address.slice(0, 8)}…${address.slice(-6)}`
  : String(address || 'unsigned'));

/** The substrate line — LIVE model truth when it can be known. Pure. */
export const substrateLine = ({ provider, model, vision }) => {
  const visionText = vision === true ? 'vision' : vision === false ? 'no vision' : 'vision ?';
  return `${model || provider || 'unknown'} · ${visionText}`;
};

/**
 * The opening banner. Pure — string composition only.
 * @param {{ wallet?: string, ground: string, substrate?: string, house: {neuma: number, witness: number}, seat?: string, session?: string }} p
 */
export const openingBanner = ({ wallet, ground, substrate, house, seat, session }) => {
  const lines = [
    '',
    '  ╔══════════════════════════════════════════════╗',
    `  ║  NEUMA  ·  the crown of the void   v${pkg.version}`.padEnd(49) + '║',
    '  ╚══════════════════════════════════════════════╝',
    '',
    `  signed in: ${shortWallet(wallet)}`,
    `  ground:    ${ground}`,
    `  substrate: ${substrate || 'probing…'}`,
    `  house:     ${house.neuma} member(s) · ${house.witness} witness(es) sealed`,
    ...(seat ? [`  seat:      ${seat}`] : []),
    ...(session ? [`  session:   ${session}`] : []),
    '',
    '  type a thought and press Enter — /help for the keys',
    '',
  ];
  return lines.join('\n');
};

// impure — the machine's substrate line before any seat exists: the config
// default + its live capability report (never a name guess).
export const machineSubstrateLine = async () => {
  const { getConfig, getActiveModelCapabilities } = await import('../../backend/services/llm-provider.js');
  const config = getConfig();
  const caps = await getActiveModelCapabilities().catch(() => null);
  return substrateLine({ provider: config.provider, model: config.model, vision: caps?.vision ?? null });
};

// impure — the effective route for a lane, resolved through the same
// resolver the turn path uses; falls back to the machine config.
const effectiveRouteInfo = async (laneId) => {
  const [{ resolveNeumaRoute }, { getConfig }, { getRouteCapabilities }] = await Promise.all([
    import('../../backend/services/neuma-route-resolver.js'),
    import('../../backend/services/llm-provider.js'),
    import('../../backend/services/llm-provider.js'),
  ]);
  try {
    const route = await resolveNeumaRoute(laneId);
    const caps = await getRouteCapabilities(route).catch(() => null);
    return { provider: route.provider, model: route.model, vision: caps?.vision ?? null };
  } catch {
    const config = getConfig();
    const caps = await getRouteCapabilities(config).catch(() => null);
    return { provider: config.provider, model: config.model, vision: caps?.vision ?? null, overridden: false };
  }
};

/** Render `/model` (no args): natal vs override vs effective. impure (stores). */
export const runModelShow = async ({ laneId, stdout }) => {
  const { getRoute } = await import('../../backend/services/neuma-routes-store.js');
  const override = await getRoute(laneId).catch(() => null);
  const effective = await effectiveRouteInfo(laneId);
  const lines = [
    `  natal:     the machine default (birth route is history, not runtime)`,
    `  override:  ${override ? `${override.provider}/${override.model}` : '(none — riding the machine default)'}`,
    `  effective: ${effective.provider}/${effective.model} · vision: ${effective.vision === true ? 'yes' : effective.vision === false ? 'no' : '?'}`,
    '',
    '  /model set <provider/model>   switch this being\'s route (sovereign doors only)',
    '  /model natal                  clear the override — ride the machine default',
  ];
  stdout.write(`${lines.join('\n')}\n`);
};

/** Render `/model set <provider/model>` / `/model natal`. impure (store write). */
export const runModelChange = async ({ laneId, argText, stdout, stderr }) => {
  const { setRoute, clearRoute } = await import('../../backend/services/neuma-routes-store.js');
  const sub = argText.trim();
  if (sub === 'natal') {
    await clearRoute(laneId);
    stdout.write(`  ${laneId} rides the machine default again\n`);
  } else {
    const slash = sub.indexOf('/');
    if (slash <= 0) {
      stderr.write('  usage: /model set <provider/model>   e.g. /model set lm-studio/local-model\n');
      return;
    }
    const provider = sub.slice(0, slash);
    const model = sub.slice(slash + 1);
    // The store enforces the sovereignty boundary at the WRITE — a non-
    // sovereign provider throws here, before any turn can ride it.
    await setRoute(laneId, { provider, model });
    const effective = await effectiveRouteInfo(laneId);
    stdout.write(`  route locked: ${provider}/${model} · effective now: ${effective.model} · vision: ${effective.vision === true ? 'yes' : effective.vision === false ? 'no' : '?'}\n`);
  }
};

/** Render `/server` — the machine + LLM serving status, live. impure (probes). */
export const runServerStatus = async ({ stdout, stderr }) => {
  const { getSubstrateProfile } = await import('../../backend/services/substrate-detector.js');
  const profile = await getSubstrateProfile();
  const gpu = profile.gpu ? `${profile.gpu.name} · ${profile.gpu.vramGB}GB` : 'none detected';
  let served;
  try {
    const res = await fetch(`${profile.llm.endpoint.replace(/\/$/, '')}/v1/models`, { signal: AbortSignal.timeout(2500) });
    const body = await res.json();
    const models = (body?.data || body?.models || []).map((m) => m.id || m.name).filter(Boolean);
    served = res.ok ? `${models.length} model(s) live: ${models.slice(0, 3).join(', ')}${models.length > 3 ? ' …' : ''}` : `HTTP ${res.status}`;
  } catch (err) {
    served = `unreachable — ${err.message}`;
    stderr.write('  the configured LLM endpoint did not answer; turns will refuse until it does\n');
  }
  stdout.write([
    `  machine:  ${profile.platform.hostname} · ${profile.platform.os} ${profile.platform.version}`,
    `  cpu:      ${profile.cpu.model} (${profile.cpu.cores} cores)`,
    `  gpu:      ${gpu}`,
    `  memory:   ${profile.memory.totalGB}GB`,
    `  llm:      ${profile.llm.provider} @ ${profile.llm.endpoint}`,
    `  serving:  ${served}`,
    '',
  ].join('\n'));
};
