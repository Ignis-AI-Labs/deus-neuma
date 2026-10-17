import { resolvePolicy, checkToolAccess, applyToolMode, GLOBAL_DEFAULTS } from '../tool-policy.js';
import { refusalResult, gateAct } from '../act-gate.js';
import { threatLedgerFor, threatCounts } from './threat-ledger.js';
import { watchStoreFor } from './watch-store.js';
import { readScanState } from './security-scheduler.js';
import { mapThreatAttackSurface, readArchitectureSurface, selectWatchedRepo } from './attack-surface.js';
import { readSecurityTelemetry } from './traffic-monitor.js';
import { circuitBreaker } from './circuit-breaker.js';

const emptySchema = Object.freeze({ type: 'object', properties: Object.freeze({}) });
const tool = (name, description, properties = {}, required = []) => Object.freeze({
  name,
  server: 'security',
  description,
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze(properties),
    ...(required.length ? { required: Object.freeze(required) } : {}),
  }),
});

const SECURITY_POSTURE_TOOL = Object.freeze({
  name: 'security_posture',
  server: 'security',
  description: 'Read the house security posture — no args. Returns threat counts, last scan, watched repos, and measured host inventory. Reading is open to every bound being; settling threats is the CSO office.',
  inputSchema: emptySchema,
});
const SECURITY_THREATS_LIST_TOOL = tool('security_threats_list', 'List the threat ledger. Optional {status, layer, repo, limit}; status is new | not_affected | confirmed | mitigated | needs_operator. Read before assessing.', {
  status: { type: 'string' }, layer: { type: 'string' }, repo: { type: 'string' }, limit: { type: 'number' },
});
const SECURITY_THREAT_GET_TOOL = tool('security_threat_get', 'Read one threat whole by full or unambiguous prefix id.', {
  id: { type: 'string', description: 'Threat id or unambiguous prefix' },
}, ['id']);
const SECURITY_ATTACK_SURFACE_TOOL = tool('security_attack_surface', 'Read the deployment-specific structural map, or map one software threat to its exact package-lock chains, static source importers, reachable Express routes, and detected requireAuth layers. Optional {id, repo}; id maps one threat. Static evidence narrows exposure but never proves exploitability.', {
  id: { type: 'string', description: 'Optional software threat id or prefix' },
  repo: { type: 'string', description: 'Optional watched repo id for the general map' },
});
const SECURITY_TELEMETRY_TOOL = tool('security_telemetry', 'Read the live process pulse: bounded redacted HTTP/portal traffic, path/source patterns, deterministic anomaly signals, application-firewall state, and recent redacted warn/error logs. Optional {windowSeconds, limit, logLimit}. No headers, bodies, query strings, cookies, or tokens are collected.', {
  windowSeconds: { type: 'number', description: '1..900 seconds (default 60)' },
  limit: { type: 'number', description: '0..200 recent redacted request events' },
  logLimit: { type: 'number', description: '1..50 recent redacted warn/error entries' },
});

// The office's ACTS (assess / scan-now / escalate / circuit-breaker) became
// INTENTS (Stage 3 — intents/security-acts.js): filed as files, settled by
// the sweep, the CSO seat verified at validate time. What remains here is the
// read surface, open to every bound being.
const SECURITY_READ_TOOLS = Object.freeze([
  SECURITY_POSTURE_TOOL, SECURITY_THREATS_LIST_TOOL, SECURITY_THREAT_GET_TOOL,
  SECURITY_ATTACK_SURFACE_TOOL, SECURITY_TELEMETRY_TOOL,
]);
export const SECURITY_TOOLS = Object.freeze([...SECURITY_READ_TOOLS]);
const TOOL_NAMES = new Set(SECURITY_TOOLS.map((entry) => entry.name));

/** Does a parsed call target the security office? Pure. */
export const isSecurityTool = (match) => TOOL_NAMES.has(match?.toolName)
  || TOOL_NAMES.has(String(match?.tool || '').replace(/^security\//, ''));

/** The reads are house-visible — every bound being sees the whole catalog. */
export const securityToolsFor = async (connection) =>
  (connection.companion?.neumaId ? [...SECURITY_READ_TOOLS] : []);

const watchedRepo = async (wallet, repoId = null) => {
  const watch = await (await watchStoreFor(wallet)).load();
  return { watch, repo: selectWatchedRepo(watch, repoId) };
};

const formatArchitecture = (repo, surface) => {
  const unverified = surface.routes.filter((route) => route.protection === 'public_or_unverified').slice(0, 40);
  return [
    `Architecture surface for ${repo.id} (${surface.measuredAt}).`,
    `Direct bind: ${surface.deployment.host}:${surface.deployment.port} · network exposure ${surface.deployment.directNetworkExposure ? 'POSSIBLE' : 'loopback-only by direct bind'}.`,
    `Scanned ${surface.summary.scannedFiles} files · ${surface.summary.routes} routes (${surface.summary.authenticatedRoutes} authenticated, ${surface.summary.publicOrUnverifiedRoutes} public-or-unverified) · ${surface.summary.externalEgressSites} egress sites · ${surface.summary.storageSites} storage sites.`,
    `Direct packages imported by source: ${surface.packageImports.map((entry) => `${entry.name}[${entry.kind}]→${entry.files.length} file(s)`).join(', ') || 'none'}.`,
    unverified.length ? `Public-or-unverified route evidence (first ${unverified.length}):\n${unverified.map((route) => `- ${route.method.toUpperCase()} ${route.path} — ${route.file}:${route.protection}`).join('\n')}` : 'Every detected route carries static requireAuth evidence.',
    `Caveat: ${surface.deployment.caveat}`,
  ].join('\n');
};

const formatTelemetry = (telemetry) => {
  const { traffic, circuitBreakers, systemIssues } = telemetry;
  return [
    `Live pulse at ${traffic.measuredAt}; window ${traffic.windowSeconds}s.`,
    `Traffic: ${traffic.totals.requests} total · ${traffic.totals.remote} remote · ${traffic.totals.denied} denied · ${traffic.totals.serverErrors} 5xx · ${traffic.totals.portalMessages} portal.`,
    `Application firewall: auto-containment ${circuitBreakers.autoContain ? 'ON' : 'OFF'} · ${circuitBreakers.blockedSources.length} source block(s)${circuitBreakers.lockdown ? ` · remote lockdown until ${circuitBreakers.lockdown.until}` : ''}.`,
    traffic.anomalies.length ? `Anomalies:\n${traffic.anomalies.map((entry) => `- ${entry.severity} ${entry.type} from ${entry.source}: ${entry.detail}`).join('\n')}` : 'Anomalies: none at the current thresholds.',
    traffic.byPath.length ? `Top paths:\n${traffic.byPath.slice(0, 20).map((entry) => `- ${entry.key}: ${entry.requests} requests, ${entry.denied} denied, ${entry.errors} errors, avg ${entry.averageDurationMs}ms`).join('\n')}` : 'Top paths: no traffic in this window.',
    systemIssues.length ? `Recent redacted warnings/errors:\n${systemIssues.map((entry) => `- ${entry.ts} ${entry.level} [${entry.context}] ${entry.msg}${entry.data ? ` ${JSON.stringify(entry.data)}` : ''}`).join('\n')}` : 'Recent redacted warnings/errors: none.',
    traffic.recent.length ? `Recent events:\n${traffic.recent.map((entry) => `- ${entry.at} ${entry.source || 'unknown'} ${entry.method} ${entry.path} → ${entry.status} (${Math.round(entry.durationMs)}ms)`).join('\n')}` : null,
  ].filter(Boolean).join('\n');
};

/**
 * Execute a security READ through policy, mode, and the real stores of the
 * being's OWN house (the connection's wallet) — never another house's ledger.
 * impure.
 */
export const handleSecurityTool = async (ws, connection, neumaPolicy, toolMode, match, args, ports = {}) => {
  const toolName = TOOL_NAMES.has(match?.toolName) ? match.toolName : String(match?.tool || '').replace(/^security\//, '');
  const toolId = `security/${toolName}`;
  const { companion } = connection;
  const wallet = connection.walletAddress;
  const send = (event) => ports.sendToolEvent?.(ws, companion, event);

  const policy = resolvePolicy(GLOBAL_DEFAULTS, neumaPolicy, connection._sessionToolPolicy || null);
  const baseAccess = checkToolAccess(policy, 'security', toolName);
  if (applyToolMode(baseAccess, toolMode, toolName) === 'denied') {
    const refusal = refusalResult(toolId, baseAccess !== 'denied' ? 'held' : 'policyDenied');
    send({ tool: toolId, status: 'denied', summary: `${toolName} — ${refusal.summary}` });
    return { tool: toolId, status: 'denied', error: refusal.error };
  }
  const gate = await gateAct(connection, {
    server: 'security', tool: toolName, args,
    lanePolicy: neumaPolicy, mode: toolMode,
    emit: send,
  });
  if (!gate.ok) return gate.result;

  try {
    if (toolName === 'security_posture') {
      const [entries, scan, watch, breakers] = await Promise.all([
        threatLedgerFor(wallet).then((ledger) => ledger.load()), readScanState(wallet).catch(() => null),
        watchStoreFor(wallet).then((store) => store.load()).catch(() => null), circuitBreaker.load(),
      ]);
      const counts = threatCounts(entries);
      const content = [
        `Threats: ${counts.total} total — ${Object.entries(counts.byStatus).map(([status, count]) => `${status}: ${count}`).join(', ') || 'none'}`,
        `By layer: ${Object.entries(counts.byLayer).map(([layer, count]) => `${layer}: ${count}`).join(', ') || 'none'}`,
        scan?.lastRunAt ? `Last scan: ${scan.lastRunAt}` : 'Last scan: never run on this install',
        scan?.host ? `Host: kernel ${scan.host.kernel || '?'} · NVIDIA ${scan.host.nvidiaDriver || 'n/a'}` : null,
        watch ? `Watched repos: ${watch.repos.map((repo) => repo.id).join(', ') || 'none'}` : null,
        `Application firewall: auto-containment ${breakers.autoContain ? 'ON' : 'OFF'} · ${breakers.blockedSources.length} source block(s)${breakers.lockdown ? ' · REMOTE LOCKDOWN ACTIVE' : ''}`,
      ].filter(Boolean).join('\n');
      send({ tool: toolId, status: 'ok', summary: `${counts.total} threats on the ledger` });
      return { tool: toolId, status: 'ok', content };
    }
    if (toolName === 'security_threats_list') {
      let entries = await (await threatLedgerFor(wallet)).load();
      if (args?.status) entries = entries.filter((entry) => entry.status === args.status);
      if (args?.layer) entries = entries.filter((entry) => entry.layer === args.layer);
      if (args?.repo) entries = entries.filter((entry) => entry.repo === args.repo);
      const limit = Math.min(Math.max(Number(args?.limit) || 40, 1), 200);
      const shown = entries.slice(-limit);
      const content = shown.length ? shown.map((entry) => `[${entry.id.slice(0, 10)}] ${entry.severity} · ${entry.status} · ${entry.layer}${entry.repo ? `/${entry.repo}` : ''} — ${entry.externalId}: ${entry.title}`).join('\n') : 'No threats match — the ledger holds nothing under those filters.';
      send({ tool: toolId, status: 'ok', summary: `${shown.length} of ${entries.length} threats` });
      return { tool: toolId, status: 'ok', content };
    }
    if (toolName === 'security_threat_get') {
      const threat = await (await threatLedgerFor(wallet)).get(String(args?.id || ''));
      if (!threat) throw new Error('no such threat (or the id is ambiguous)');
      send({ tool: toolId, status: 'ok', summary: threat.title.slice(0, 80) });
      return { tool: toolId, status: 'ok', content: JSON.stringify(threat, null, 2) };
    }
    if (toolName === 'security_attack_surface') {
      const threat = args?.id ? await (await threatLedgerFor(wallet)).get(String(args.id)) : null;
      if (args?.id && !threat) throw new Error('no such threat (or the id is ambiguous)');
      const { repo } = await watchedRepo(wallet, threat?.repo || args?.repo || null);
      const content = threat
        ? JSON.stringify(await mapThreatAttackSurface(threat, repo.path), null, 2)
        : formatArchitecture(repo, await readArchitectureSurface(repo.path));
      send({ tool: toolId, status: 'ok', summary: threat ? `mapped ${threat.externalId}` : `mapped ${repo.id}` });
      return { tool: toolId, status: 'ok', content };
    }
    if (toolName === 'security_telemetry') {
      const telemetry = await readSecurityTelemetry(args || {});
      send({ tool: toolId, status: 'ok', summary: `${telemetry.traffic.totals.requests} requests / ${telemetry.traffic.windowSeconds}s` });
      return { tool: toolId, status: 'ok', content: formatTelemetry(telemetry) };
    }
  } catch (error) {
    send({ tool: toolId, status: 'error', summary: `${toolName} — failed` });
    return { tool: toolId, status: 'error', error: error.message };
  }
  return { tool: toolId, status: 'error', error: `unknown security tool ${toolName}` };
};
