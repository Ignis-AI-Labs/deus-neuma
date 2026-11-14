/**
 * RUNNING AN EXTENSION — the checked copy, started only when a being first
 * calls it (load on demand), with exactly the keys its catalog entry names.
 *
 * It runs on the app's own Node (process.execPath; under Electron with
 * ELECTRON_RUN_AS_NODE), from the entry file inside the folder the security
 * check read. Its environment is the platform's helper environment (no
 * backend secrets) plus its own keys and fixed settings — nothing else.
 *
 * impure — child processes through the MCP client.
 */
import path from 'node:path';
import { mcpService } from '../mcp.js';
import { extensionById } from './extension-catalog.js';
import { extensionDir, readInstalled, keysFor } from './extension-store.js';

/** The MCP client name an extension runs under. Pure. */
export const serverNameOf = (id) => `ext-${id}`;

/** Why an installed extension cannot run right now, or null when it can. Pure. */
export const notRunnable = (entry, record, keys = {}) => {
  if (!entry) return 'it is not in the catalog';
  if (!record) return 'it is not installed';
  if (record.blocked) return `the daily security check blocked it: ${record.blockedWhy || 'a high or critical flaw'} — update or remove it`;
  if (record.enabled === false) return 'it is turned off';
  const missing = entry.env.filter((k) => k.required && !keys[k.name]).map((k) => k.name);
  if (missing.length) return `it needs ${missing.join(', ')} (neuma extensions key ${entry.id} <NAME>)`;
  return null;
};

/** How to start it: the command, its arguments, its environment. Pure. */
export const launchOf = (entry, dir, keys = {}) => ({
  command: process.execPath,
  args: [path.join(dir, 'node_modules', entry.package, entry.bin), ...entry.args],
  env: {
    ...Object.fromEntries(Object.entries(entry.fixedEnv).map(([k, v]) => [k, String(v).replaceAll('{dir}', dir)])),
    ...Object.fromEntries(entry.env.filter((k) => keys[k.name]).map((k) => [k.name, keys[k.name]])),
    ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
  },
});

/**
 * Start it if it is not running; refuse with the reason when it cannot run.
 * impure.
 * @returns {Promise<string>} its MCP client name
 */
export const ensureRunning = async (id) => {
  const name = serverNameOf(id);
  const entry = extensionById(id);
  const record = (await readInstalled())[id] ?? null;
  const keys = await keysFor(id);
  const why = notRunnable(entry, record, keys);
  if (why) {
    // A blocked or switched-off extension stops at once, not at its next start.
    if (mcpService.clients.has(name)) await mcpService.disconnect(name).catch(() => {});
    throw new Error(`${entry?.name ?? id} cannot run: ${why}`);
  }
  if (!mcpService.clients.has(name)) {
    const { command, args, env } = launchOf(entry, extensionDir(id), keys);
    await mcpService.connectToServer(name, command, args, env);
  }
  return name;
};

/** impure — the tools it offers, read from the running server. */
export const listExtensionTools = async (id) => {
  const name = await ensureRunning(id);
  return (mcpService.activeTools.get(name) ?? []).map((t) => ({ name: t.name, description: t.description ?? '', inputSchema: t.inputSchema ?? { type: 'object' } }));
};

/** impure — one tool call on it. */
export const callExtensionTool = async (id, tool, args) => mcpService.callTool(await ensureRunning(id), tool, args ?? {});

/** impure — stop it if it runs. */
export const stopExtension = async (id) => {
  if (mcpService.clients.has(serverNameOf(id))) await mcpService.disconnect(serverNameOf(id));
};
