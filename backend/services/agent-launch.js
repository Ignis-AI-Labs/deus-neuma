/**
 * Agent launch — the CLI coding agents a terminal window may start directly.
 *
 * The operator's terminal law (the VS Code integrated-terminal shape): a
 * terminal opens in the window's focus folder, and an agent can be launched
 * straight into it — `claude`, `kimi`, `grok`, `opencode` — running as the
 * operator's own interactive session under each tool's own license. The
 * platform never wraps, proxies, or re-auths these tools; it spawns them,
 * the way a human types their name.
 *
 * The catalog is a CLOSED allowlist: a launch id maps to a fixed binary name,
 * never to client-supplied argv. A launch param that is not in the catalog is
 * refused, not sanitized — there is no injection surface because no client
 * string ever reaches the spawn.
 */
import fs from 'fs';
import path from 'path';
import { agentTerminalEnvironment } from './agent-terminal-environment.js';

export const AGENT_CATALOG = Object.freeze([
  Object.freeze({ id: 'claude', label: 'CLAUDE CODE', bin: 'claude' }),
  Object.freeze({ id: 'kimi', label: 'KIMI CODE', bin: 'kimi' }),
  Object.freeze({ id: 'grok', label: 'GROK', bin: 'grok' }),
  Object.freeze({ id: 'opencode', label: 'OPENCODE', bin: 'opencode' }),
  Object.freeze({ id: 'codex', label: 'CODEX', bin: 'codex' }),
  Object.freeze({ id: 'gemini', label: 'GEMINI CLI', bin: 'gemini' }),
]);

/** pure — the catalog entry for a launch id, or null. */
export const resolveAgent = (id) =>
  AGENT_CATALOG.find((a) => a.id === id) || null;

// impure — a binary is "present" when it resolves executable on PATH.
// Scanned directly (no shell exec): PATH dirs × exact filename match.
export const binOnPath = (bin) => {
  if (typeof bin !== 'string' || bin.length === 0 || bin.includes('/')) return false;
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat'] : [''];
  for (const dir of agentTerminalEnvironment(process.env, process.platform).PATH.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      try {
        fs.accessSync(path.join(dir, bin + ext), fs.constants.X_OK);
        return true;
      } catch { /* not here */ }
    }
  }
  return false;
};

/** impure — the catalog entries whose binary is actually on this machine. */
export const availableAgents = () =>
  AGENT_CATALOG.filter((a) => binOnPath(a.bin))
    .map((a) => ({ id: a.id, label: a.label }));
