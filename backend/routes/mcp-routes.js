import { Router } from 'express';
import path from 'path';
import { mcpService } from '../services/mcp.js';
import { requireAuth } from '../services/auth.js';
import { requireInstallOwner } from '../services/install-owner.js';
import { resolvePolicy, checkToolAccess, GLOBAL_DEFAULTS } from '../services/tool-policy.js';
import { checkToolArgs } from '../services/rogue-detector.js';
import { createSandboxedCallTool } from '../services/tool-sandbox.js';
import { fsPolicyTarget, withFsRouting } from '../services/fs-primitives.js';
import workspace, { getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

import { createLogger } from '../services/logger.js';
const log = createLogger('MCP');

const router = Router();

// All MCP routes require authentication — these execute filesystem operations
router.use(requireAuth);
// Spawning, adding or dropping an MCP server changes the whole machine — a
// process every house's beings can reach — so it is the install owner's act
// (requireInstallOwner on each mutation below), never a guest house's.

// MCP command allowlist — the ONLY command a client may spawn is `npx`, and only
// to launch an allowlisted MCP package. `node` was removed (SEC-026 hardening):
// as a script runner it accepted any path (write-a-script-then-exec = RCE), and
// no production caller uses it — the live filesystem surface is the platform's
// own in-process organ (native-filesystem.js), never spawned at all, and never
// through these routes.
const ALLOWED_MCP_COMMANDS = Object.freeze([
  'npx',
]);
// Exact package name only — no @version / @url / @file: suffix (SEC-AUDIT-006 / #165). Each one
// runs at the version the app ships (package.json, held equal by a test): the client names the
// package, the server adds the version, so npx never fetches whatever the registry calls latest.
const PINNED_MCP_PACKAGES = Object.freeze({
  '@modelcontextprotocol/server-filesystem': '2026.7.10',
  '@modelcontextprotocol/server-memory': '2026.8.31',
});
const ALLOWED_MCP_PACKAGES = Object.freeze(Object.keys(PINNED_MCP_PACKAGES));

// Platform-managed client keys — client connect cannot steal these (SEC-AUDIT-005 / #164).
const RESERVED_SERVER_NAMES = Object.freeze(['filesystem']);

// Client-supplied env is NOT forwarded to the spawner (SEC-026 hardening). A
// single poisoned env var turns an allowlisted `npx <pkg>` into RCE, and the set
// is unbounded — PATH (attacker's npx/node), NODE_OPTIONS/NODE_PATH (--require),
// npm_config_cache/npm_config_registry (redirect where the package resolves
// from), NODE_EXTRA_CA_CERTS (MITM), LD_PRELOAD/DYLD_* (native lib). A denylist
// can't be proven complete, so no client env is accepted at all; the spawned
// server starts from the helper environment (connectToServer's
// helperEnvironment — never the backend's secrets). Per-server env, if ever needed, belongs in a
// server-side catalog, never on a client request.
const SPAWN_ENV = Object.freeze({});

// --- Helpers ---

/** True when `dir` is base or nested under base (path-aware). */
const isUnderBase = (dir, base) => {
  const rel = path.relative(path.resolve(base), path.resolve(dir));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/**
 * Roots a client may pass as MCP filesystem allowed-directories: project dir
 * and the current workspaces home only (SEC-AUDIT-005 / #164).
 */
const allowedMcpRootBases = () => {
  const bases = [process.cwd()];
  try {
    const house = getWorkspacesRoot();
    if (house) bases.push(house);
  } catch { /* ignore */ }
  return bases.map((b) => path.resolve(b));
};

// Validate a requested process spawn against the command + package allowlists
// (SEC-026 residual) and root confinement (SEC-AUDIT-005). EVERY spawn entry
// point runs this. Returns { ok: true } or { ok: false, error }.
const validateMcpSpawn = (command, args) => {
  if (!command || !ALLOWED_MCP_COMMANDS.includes(command)) {
    return { ok: false, error: `MCP command '${command}' not in allowlist` };
  }
  const argv = Array.isArray(args) ? args.map(String) : [];

  // Strip any leading yes-flags (separate tokens, the conventional npx shape:
  // `['-y', '@…/server-filesystem', …]`), then the
  // FIRST remaining token must be an allowlisted package by EXACT name (no
  // @version / @url strip — SEC-AUDIT-006). This rejects npx's own code-exec
  // flags, bare npx, prefix look-alikes, and content-substitution specs.
  let rest = argv;
  while (rest[0] === '-y' || rest[0] === '--yes') rest = rest.slice(1);
  const pkg = rest[0] ?? '';
  if (!ALLOWED_MCP_PACKAGES.includes(pkg)) {
    return { ok: false, error: `MCP package '${pkg || '(none)'}' not in allowlist` };
  }

  // Filesystem package: remaining argv are allowed directories — confine them.
  if (pkg === '@modelcontextprotocol/server-filesystem') {
    const roots = rest.slice(1);
    if (roots.length === 0) {
      return { ok: false, error: 'Filesystem MCP requires at least one allowed root under project or workspaces home' };
    }
    const bases = allowedMcpRootBases();
    for (const root of roots) {
      if (!path.isAbsolute(root)) {
        return { ok: false, error: 'MCP filesystem root must be an absolute path' };
      }
      const resolved = path.resolve(root);
      if (!bases.some((base) => isUnderBase(resolved, base))) {
        return { ok: false, error: 'MCP filesystem root not under project or workspaces home' };
      }
    }
  }

  return { ok: true };
};

// The argv a VALIDATED spawn runs with: the package token gains its pinned version, every other
// token stays as it was. Pure.
const pinnedMcpArgs = (args) => {
  const argv = (args || []).map(String);
  const at = argv.findIndex((a) => a !== '-y' && a !== '--yes');
  return argv.map((a, i) => (i === at ? `${a}@${PINNED_MCP_PACKAGES[a]}` : a));
};

const rejectReservedServerName = (name, res) => {
  if (name && RESERVED_SERVER_NAMES.includes(String(name))) {
    res.status(403).json({
      error: `Server name '${name}' is reserved for platform-managed connections`,
    });
    return true;
  }
  return false;
};

// Extract text content from MCP result structure
const extractMCPContent = (result) => {
  if (result.content && Array.isArray(result.content)) {
    const textItems = result.content.filter(item => item.type === 'text');
    return textItems.map(item => item.text).join('\n');
  }
  if (typeof result.content === 'string') return result.content;
  if (result.content) return JSON.stringify(result.content, null, 2);
  return '';
};

// Available server catalog (could move to config)
const getServerCatalog = () => [
  { id: 'filesystem', name: 'Filesystem', installed: mcpService.clients.has('filesystem') },
  { id: 'github', name: 'GitHub', installed: mcpService.clients.has('github') },
  { id: 'memory', name: 'Memory', installed: mcpService.clients.has('memory') },
  { id: 'time', name: 'Time', installed: mcpService.clients.has('time') },
  { id: 'fetch', name: 'Web Fetch', installed: mcpService.clients.has('fetch') }
];

// --- Routes ---

/**
 * REST tool policy + ownership + sandbox gate (SEC-AUDIT-004 / #163).
 * Portal stream is the human-approval path; REST is for owned-lane tools only.
 * - denied → 403
 * - approval_required → 403 (no REST approval broker)
 * - requires neumaId + owner match
 * - execution goes through createSandboxedCallTool
 */
const enforceToolPolicy = async (req, res, next) => {
  try {
    const { server, tool, args, neumaId } = req.body || {};
    if (!server || !tool) {
      return res.status(400).json({ error: 'server and tool required' });
    }
    if (!neumaId || !/^[a-zA-Z0-9_-]+$/.test(neumaId)) {
      return res.status(400).json({ error: 'neumaId required for tool execution' });
    }

    const policy = resolvePolicy(GLOBAL_DEFAULTS, null, null);
    // The delete sub-op of fs/edit resolves to the delete row — irreversible
    // acts keep their own tier here as everywhere (fs-primitives.js).
    const target = fsPolicyTarget(server, tool, args || {});
    const access = checkToolAccess(policy, target.server, target.tool);
    if (access === 'denied') {
      return res.status(403).json({ error: `Tool ${server}/${tool} is denied by policy` });
    }
    if (access === 'approval_required') {
      return res.status(403).json({
        error: `Tool ${server}/${tool} requires operator approval and cannot run via REST`,
      });
    }

    const argsCheck = checkToolArgs(server, tool, args || {});
    if (!argsCheck.safe) {
      return res.status(403).json({ error: argsCheck.reason });
    }

    const owner = await workspace.readOwner(neumaId);
    const ownerWallet = typeof owner?.wallet === 'string' ? owner.wallet.toLowerCase() : '';
    const caller = String(req.walletAddress || '').toLowerCase();
    if (!ownerWallet || ownerWallet !== caller) {
      return res.status(403).json({ error: 'Not your workspace' });
    }

    req.toolContext = { neumaId };
    next();
  } catch (err) {
    log.error('enforceToolPolicy', { error: err.message });
    res.status(500).json({ error: 'Tool policy check failed' });
  }
};

const runSandboxedTool = async (req, res, { includeRaw }) => {
  const { server, tool, args } = req.body;
  const { neumaId } = req.toolContext;
  try {
    const connection = { companion: { neumaId }, _writeOps: 0 };
    const sandboxed = withFsRouting(createSandboxedCallTool(mcpService, connection, workspace));
    const result = await sandboxed(server, tool, args || {});
    if (includeRaw) {
      const content = extractMCPContent(result);
      return res.json({ success: true, content, raw: result });
    }
    return res.json({ success: true, result });
  } catch (error) {
    log.error(includeRaw ? 'Tool call error' : 'Test tool error', {
      server, tool, neumaId, error: error.message,
    });
    const status = /denied|not allowed|outside|path/i.test(error.message) ? 403 : 500;
    res.status(status).json({
      error: includeRaw ? 'Tool execution failed' : 'Tool test failed',
      detail: status === 403 ? error.message : undefined,
    });
  }
};

// Test MCP tool execution
router.post('/test-tool', enforceToolPolicy, async (req, res) => {
  await runSandboxedTool(req, res, { includeRaw: false });
});

// Call MCP tool directly
router.post('/call-tool', enforceToolPolicy, async (req, res) => {
  await runSandboxedTool(req, res, { includeRaw: true });
});

// Connect to an MCP server — command restricted to allowlist
router.post('/connect', requireInstallOwner, async (req, res) => {
  const { name, command, args } = req.body;

  if (rejectReservedServerName(name, res)) return;

  // Validate command against allowlist (SEC-026)
  const spawnCheck = validateMcpSpawn(command, args);
  if (!spawnCheck.ok) {
    return res.status(403).json({ error: spawnCheck.error });
  }

  try {
    await mcpService.connectToServer(name, command, pinnedMcpArgs(args), SPAWN_ENV);
    const tools = await mcpService.listAllTools();
    res.json({ success: true, tools });
  } catch (error) {
    log.error('Connect error', { error: error.message });
    res.status(500).json({ error: 'Failed to connect to MCP server' });
  }
});

// List all connected tools
router.get('/tools', async (req, res) => {
  const toolsByServer = await mcpService.listAllTools();
  const servers = toolsByServer.map(server => ({
    name: server.server,
    tools: server.tools
  }));
  const allTools = toolsByServer.flatMap(s => s.tools || []);
  res.json({ servers, tools: allTools });
});

// Disconnect a specific server
router.post('/disconnect/:serverName', requireInstallOwner, async (req, res) => {
  const { serverName } = req.params;
  if (rejectReservedServerName(serverName, res)) return;
  try {
    await mcpService.disconnect(serverName);
    res.json({ success: true });
  } catch (error) {
    log.error('Disconnect error', { server: serverName, error: error.message });
    res.status(500).json({ error: 'Failed to disconnect server' });
  }
});

// Disconnect all servers — refuse to drop platform filesystem (SEC-AUDIT-005 residual)
router.post('/disconnect-all', requireInstallOwner, async (req, res) => {
  const names = [...mcpService.clients.keys()].filter((n) => !RESERVED_SERVER_NAMES.includes(n));
  for (const name of names) {
    try {
      await mcpService.disconnect(name);
    } catch (err) {
      log.error('Disconnect-all partial failure', { server: name, error: err.message });
    }
  }
  res.json({ success: true, retained: [...RESERVED_SERVER_NAMES] });
});

// Get available MCP servers (catalog)
router.get('/available-servers', (req, res) => {
  res.json({ servers: getServerCatalog() });
});

// Alias for /available-servers (frontend uses both paths)
router.get('/servers', (req, res) => {
  res.json({ servers: getServerCatalog() });
});

// MCP server action (connect/disconnect by server ID)
router.post('/servers/:serverId/:action', requireInstallOwner, async (req, res) => {
  const { serverId, action } = req.params;
  try {
    if (action === 'connect') {
      if (rejectReservedServerName(serverId, res)) return;
      const { command, args } = req.body;
      const resolvedCommand = command || 'npx';
      // Same allowlist as /connect (SEC-026 residual): this path spawns a
      // process too, so client-supplied command/args must never bypass it.
      const spawnCheck = validateMcpSpawn(resolvedCommand, args);
      if (!spawnCheck.ok) {
        return res.status(403).json({ error: spawnCheck.error });
      }
      await mcpService.connectToServer(serverId, resolvedCommand, pinnedMcpArgs(args), SPAWN_ENV);
      const tools = await mcpService.listAllTools();
      res.json({ success: true, tools });
    } else if (action === 'disconnect') {
      if (rejectReservedServerName(serverId, res)) return;
      await mcpService.disconnect(serverId);
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Unknown action' });
    }
  } catch (error) {
    log.error('Server action error', { serverId, action, error: error.message });
    res.status(500).json({ error: 'Server action failed' });
  }
});

// Connect a custom MCP server
router.post('/custom', requireInstallOwner, async (req, res) => {
  const { name, command, args } = req.body;
  const serverName = name || 'custom';
  if (rejectReservedServerName(serverName, res)) return;
  const resolvedCommand = command || 'npx';
  // Same allowlist as /connect (SEC-026 residual): a "custom" server is still a
  // spawned process — the client cannot name an arbitrary host command here.
  const spawnCheck = validateMcpSpawn(resolvedCommand, args);
  if (!spawnCheck.ok) {
    return res.status(403).json({ error: spawnCheck.error });
  }
  try {
    await mcpService.connectToServer(serverName, resolvedCommand, pinnedMcpArgs(args), SPAWN_ENV);
    const tools = await mcpService.listAllTools();
    res.json({ success: true, tools });
  } catch (error) {
    log.error('Custom server connect error', { error: error.message });
    res.status(500).json({ error: 'Failed to connect custom server' });
  }
});

export { extractMCPContent, validateMcpSpawn, pinnedMcpArgs, PINNED_MCP_PACKAGES };
export default router;
