/**
 * The install's security self-check — the walls the tests prove, asked again
 * on the installed app, where the tests never ship. Each canary is cheap and
 * real: it calls the same function the platform relies on, with inputs that
 * must be refused, and touches nothing (no network, no write; the walls are
 * asked about paths, never handed one).
 *
 *   platform-write-wall   a being's write to the install's settings, the realm
 *                         or a login file is refused (platform-write-walls.js)
 *   ssrf-private-ranges   metadata, CGNAT/tailnet, mapped-loopback and
 *                         unspecified addresses read as private (endpoint-guard.js)
 *   helper-env-secrets    a spawned helper, ComfyUI and the press's Chromium
 *                         start without the backend's secrets
 *   auto-hard-gates       AUTO never runs a CSO verdict, a wallet send or
 *                         being code on a team workspace without the
 *                         operator's card (protocol-guard.js)
 *   machine-owner-gate    every machine-wide route the install owner alone may
 *                         change carries the owner gate in its handler chain
 *
 * runSelfChecks returns one finding per FAILED canary, in the threat ledger's
 * shape (layer 'house', source 'self-check', externalId `self-check:<name>`),
 * and nothing for a passing one; a canary that could not run is an error, not
 * a pass. Every function under test can be handed in (`deps`) so a test can
 * give a canary a broken real alternative and watch it report.
 */
import express from 'express';
import os from 'os';
import path from 'path';
import { getSettingsDir } from '../data-root.js';
import { getRealmRoot } from '../user-realm.js';
import { laneStateWriteReason } from '../sandbox-path-policy.js';
import { isPrivateHost } from '../endpoint-guard.js';
import { BACKEND_SECRET_KEYS as SECRET_KEYS, helperEnvironment, withoutBackendSecrets } from '../agent-terminal-environment.js';
import { comfyEngineEnvironment } from '../image-forge/comfyui-supervisor.js';
import { pressEnvironment } from '../doc-press/chromium-press.js';
import { isAutoHardGated } from '../protocol-guard.js';
import { requireInstallOwner } from '../install-owner.js';
import { listRoutes, routeKey } from './route-inventory.js';

const PRIVATE_HOSTS = Object.freeze([
  '169.254.169.254', '100.64.0.1', '[::ffff:127.0.0.1]', '[::ffff:169.254.169.254]', '[::]',
  '10.0.0.1', '192.168.0.1', '[fd00::1]', '64:ff9b::a9fe:a9fe', '2002:a9fe:a9fe::',
]);
// coding/execute left this list with protocol-guard.js's own (Design note, 2026-10-28:
// on AUTO the shell runs live in the operator's open folder, .git and secrets
// masked; AUTO may never ask more than ASK.
// Every gate protocol-guard.js holds, named here on its own so the canary trips if one is ever
// dropped there (re-audit 2026-10-29, NEW-L9: four were unwatched).
const HARD_GATED = Object.freeze([
  ['intents', 'security.assess'], ['intents', 'security.escalate'], ['intents', 'security.circuit-breaker'],
  ['intents', 'wallet.send'], ['intents', 'team.workspace-run'], ['intents', 'email.send'], ['intents', 'social.post'],
  ['intents', 'tasks.operator-drop'], ['filesystem', 'delete_file'],
]);
// The machine-wide changes the install-owner ruling gated (ruling, 2026-10-19).
export const OWNER_GATED_ROUTES = Object.freeze([
  'PUT /api/v1/llm/provider', 'POST /api/v1/llm/substrate/ignite', 'PUT /api/v1/mind/gates',
  'PUT /api/v1/look/theme', 'POST /api/v1/look/presets', 'DELETE /api/v1/look/presets/:id',
  'PUT /api/v1/llm/model-folders/', 'POST /api/v1/preflight/workspace', 'POST /api/v1/user/realm/location',
  'PUT /api/v1/web/web-access', 'POST /api/v1/skills/install', 'POST /api/v1/substrate/capacity',
  'POST /api/v1/substrate/unload', 'PUT /api/v1/substrate/standby',
  'POST /api/v1/voice/engines/local/:id/launch', 'POST /api/v1/voice/engines/local/:id/stop',
  'POST /api/v1/voice/engines/local/:id/download', 'POST /api/v1/voice/engines/shutdown-all',
  'PUT /api/v1/routing/providers/:providerId/key', 'DELETE /api/v1/routing/providers/:providerId/key',
  'POST /api/v1/routing/providers/:providerId/connect', 'DELETE /api/v1/routing/connections/:providerId',
  'POST /api/v1/routing/providers/:providerId/oauth/start', 'POST /api/v1/routing/providers/:providerId/oauth/poll',
  'PUT /api/v1/routing/services/:serviceId/key', 'DELETE /api/v1/routing/services/:serviceId/key',
  'POST /api/v1/remote/enable', 'POST /api/v1/remote/disable', 'POST /api/v1/remote/rotate',
  'POST /api/v1/remote/lan/enable', 'POST /api/v1/remote/lan/disable', 'PUT /api/v1/remote/relay',
  'POST /api/v1/remote/relay/disable', 'POST /api/v1/remote/https/enable', 'POST /api/v1/remote/https/disable',
  'POST /api/v1/mcp/connect', 'POST /api/v1/mcp/disconnect/:serverName', 'POST /api/v1/mcp/disconnect-all',
  'POST /api/v1/mcp/servers/:serverId/:action', 'POST /api/v1/mcp/custom', 'POST /api/v1/cso/mitigations',
  'POST /api/v1/image-forge/launch', 'POST /api/v1/image-forge/stop', 'POST /api/v1/image-forge/free',
  'POST /api/v1/harness/servers/release', 'POST /api/v1/bench/stop', 'PUT /api/v1/chain/access',
  'POST /api/v1/bench/preflight', 'POST /api/v1/bench/launch', 'POST /api/v1/bench/relight', 'POST /api/v1/bench/proof-run',
  'POST /api/v1/gallery/roots', 'DELETE /api/v1/gallery/roots/:id',
]);

// impure — the routes the backend mounts, read from a throwaway app built by
// the same two mount calls server.js makes. Loaded lazily: the route surface
// is the heaviest import here and only this canary needs it.
const mountedRoutes = async () => {
  const [{ mountApiRoutes }, { mountRemoteRoutes }] = await Promise.all([
    import('../../routes/route-mounts.js'), import('../remote/wire.js'),
  ]);
  const app = express();
  mountRemoteRoutes(app);
  mountApiRoutes(app);
  return listRoutes(app);
};

// The canaries. Each returns the failures it saw ([] = holds). Impure only
// through what it is handed (a wall reads the env, the routes are mounted).
const CANARIES = Object.freeze([
  {
    name: 'platform-write-wall',
    severity: 'critical',
    title: 'A being\'s write can reach the install\'s settings, the realm or a login file',
    run: async ({ writeReason }) => {
      const home = os.homedir();
      const probes = [
        path.join(getSettingsDir(), 'self-check-canary.json'), path.join(getSettingsDir(), '.', 'tool-policy.json'),
        path.join(getRealmRoot(), 'self-check-canary', 'offices.json'), path.join(home, '.bashrc'),
        path.join(home, '.config', 'autostart', 'self-check-canary.desktop'), path.join(home, '.config', 'systemd', 'user', 'x.service'),
      ];
      return probes.filter((p) => !writeReason(p));
    },
  },
  {
    name: 'ssrf-private-ranges',
    severity: 'high',
    title: 'The endpoint guard reads a private or metadata address as public',
    run: async ({ privateHost }) => PRIVATE_HOSTS.filter((host) => !privateHost(host)),
  },
  {
    name: 'helper-env-secrets',
    severity: 'critical',
    title: 'A spawned helper starts with the backend\'s secrets in its environment',
    run: async ({ environments }) => {
      const env = { HOME: '/home/canary', PATH: '/usr/bin', CUDA_VISIBLE_DEVICES: '0', FONTCONFIG_PATH: '/etc/fonts' };
      for (const key of SECRET_KEYS) env[key] = `self-check-canary-${key.toLowerCase()}`;
      return Object.entries(environments).flatMap(([helper, build]) => {
        const out = build({ ...env }, process.platform);
        return SECRET_KEYS.filter((key) => key in out).map((key) => `${helper}:${key}`);
      });
    },
  },
  {
    name: 'auto-hard-gates',
    severity: 'critical',
    title: 'AUTO mode runs a security verdict, a wallet send or being code without the operator\'s card',
    run: async ({ hardGated }) => HARD_GATED.filter(([server, tool]) => !hardGated(server, tool)).map((pair) => pair.join('/')),
  },
  {
    name: 'machine-owner-gate',
    severity: 'critical',
    title: 'A machine-wide setting can be changed by a guest wallet — the install-owner gate is missing',
    run: async ({ routes, ownerGate }) => {
      const handlersByKey = new Map();
      for (const route of await routes()) {
        handlersByKey.set(routeKey(route), [...(handlersByKey.get(routeKey(route)) ?? []), ...route.handlers]);
      }
      return OWNER_GATED_ROUTES.filter((key) => !handlersByKey.get(key)?.includes(ownerGate));
    },
  },
]);

// pure — the ledger finding for one failed canary
const findingFor = (canary, failures) => Object.freeze({
  layer: 'house',
  source: 'self-check',
  externalId: `self-check:${canary.name}`,
  title: canary.title,
  severity: canary.severity,
  summary: `The installed app's own self-check failed: ${failures.length} probe(s) got through — ${failures.slice(0, 8).join(', ')}`
    + `${failures.length > 8 ? ', …' : ''}. A wall the platform relies on is not standing; treat it as a regression and fix it before anything else.`,
  surfaces: Object.freeze(failures.slice(0, 20)),
});

const DEFAULT_DEPS = Object.freeze({
  writeReason: (p) => laneStateWriteReason(p),
  privateHost: isPrivateHost,
  environments: Object.freeze({
    helper: (env, platform) => helperEnvironment(env, platform),
    operator: (env) => withoutBackendSecrets(env),
    comfy: comfyEngineEnvironment,
    press: pressEnvironment,
  }),
  hardGated: isAutoHardGated,
  routes: mountedRoutes,
  ownerGate: requireInstallOwner,
});

/**
 * Run every canary. impure (env, mounts a throwaway route table).
 * @param {Partial<typeof DEFAULT_DEPS>} [deps] - a real alternative for any function under test
 * @returns {Promise<{ findings: object[], errors: string[] }>}
 */
export const runSelfChecks = async (deps = {}) => {
  const use = { ...DEFAULT_DEPS, ...deps };
  const findings = [];
  const errors = [];
  for (const canary of CANARIES) {
    try {
      const failures = await canary.run(use);
      if (failures.length) findings.push(findingFor(canary, failures));
    } catch (error) {
      errors.push(`${canary.name}: ${error.message}`);
    }
  }
  return { findings, errors };
};
