/**
 * Terminal routes — the WebSocket connection handler for the integrated
 * terminal. Mirrors the portal's auth-on-connect (`?token=` → verify → close
 * 4001), then binds an owned PTY. Disposal detaches; explicit close kills.
 *
 * The shell's cwd honors the window's focus (`?cwd=`) — an UNTRUSTED client
 * path that must clear resolveFocusPath (the one focus-path containment
 * chokepoint: inside the opened explorer roots, symlinks resolved, an
 * existing directory) before it is used. Anything else degrades server-side:
 * the legacy global active project, else the first opened root. A hostile
 * path is never spawned into; old clients (no `?cwd=`) are unchanged.
 */
import fs from 'fs/promises';
import { Router } from 'express';
import { verifySessionToken, requireAuth } from '../services/auth.js';
import { createLogger } from '../services/logger.js';
import { getRoots, resolveFocusPath } from '../services/user-files.js';
import { getActiveProject } from '../services/user-projects.js';
import { spawnTerminal, writeToTerminal, resizeTerminal, killTerminal, closeOwnedTerminal } from '../services/terminal-manager.js';
import { resolveAgent, binOnPath, availableAgents } from '../services/agent-launch.js';

const log = createLogger('Terminal');

/** REST surface for the terminal's launcher chrome (requireAuth). */
export const terminalAgentsRouter = Router();
terminalAgentsRouter.use(requireAuth);
terminalAgentsRouter.get('/agents', (req, res) => {
  res.json({ agents: availableAgents() });
});
terminalAgentsRouter.delete('/sessions/:id', (req, res) => {
  if (!closeOwnedTerminal(req.params.id, req.walletAddress)) return res.status(404).json({ error: 'Terminal unavailable for this wallet' });
  res.json({ closed: true });
});

// The window's contained focus folder is the preferred cwd; else the active
// project's folder, but only if it still exists — a deleted/renamed project
// folder must degrade, not crash the spawn — else the first opened root.
const resolveCwd = async (requestedCwd, wallet) => {
  const focused = resolveFocusPath(requestedCwd);
  if (focused) return focused;
  const project = await getActiveProject(wallet).catch(() => null);
  if (project?.folder) {
    const st = await fs.stat(project.folder).catch(() => null);
    if (st?.isDirectory()) return project.folder;
  }
  return getRoots()[0];
};

/** Bind the authenticated terminal transport; departures detach unless explicitly closed. */
// impure
export const setupTerminalRoutes = (wss) => {
  wss.on('connection', async (ws, req) => {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const token = params.get('token');
    const session = token ? verifySessionToken(token) : null;
    if (!session) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    // A close during async cwd lookup must never leave a newly spawned orphan.
    ws.on('error', (err) => {
      killTerminal(ws, { code: 1006 });
      log.warn('Terminal transport error', { err: err.message });
    });
    const termId = params.get('term');
    const cwd = termId ? undefined : await resolveCwd(params.get('cwd'), session.address);
    if (ws.readyState !== ws.OPEN) return;
    if (!verifySessionToken(token)) { ws.close(4001, 'Unauthorized'); return; }

    // Agent launch (?launch=<id>) — an UNTRUSTED id resolved ONLY against
    // the closed catalog (agent-launch.js): unknown id or a binary missing
    // from this machine is refused, never sanitized into a spawn.
    let launch = null;
    const launchId = params.get('launch');
    if (launchId && !termId) {
      const agent = resolveAgent(launchId);
      if (!agent || !binOnPath(agent.bin)) {
        ws.send(JSON.stringify({
          type: 'terminal:error',
          message: agent ? `${agent.label} is not installed on this machine` : `Unknown agent '${launchId}'`,
        }));
        ws.close(1008, 'agent unavailable');
        return;
      }
      launch = agent;
    }

    const ok = spawnTerminal(ws, { wallet: session.address, cwd, launch, termId });
    if (!ok.ok) {
      // HR-6: a refused socket must not linger. The error frame is already
      // queued by spawnTerminal; close with a distinct code (1013 Try Again
      // Later) so the client sees a deliberate refusal, not a network drop.
      ws.close(ok.closeCode || 1013, 'terminal refused');
      return;
    }
    log.info('Terminal opened', { wallet: session.address, id: ok.id, attached: Boolean(ok.attached) });

    const expire = () => {
      killTerminal(ws, { code: 4001 });
      ws.close(4001, 'Session expired');
    };
    const expiryTimer = setTimeout(expire, Math.max(1, session.expiresAt - Date.now() + 1));
    expiryTimer.unref?.();

    ws.on('message', (raw) => {
      if (!verifySessionToken(token)) { expire(); return; }
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === 'terminal:data') writeToTerminal(ws, msg.data);
      else if (msg.type === 'terminal:resize') resizeTerminal(ws, msg.cols, msg.rows);
    });

    // The close CODE decides the law (friction-map D3): a deliberate 1000
    // (the operator closed the window) kills the PTY as always; any other
    // departure detaches and the terminal survives for reattach.
    ws.on('close', (code) => {
      clearTimeout(expiryTimer);
      killTerminal(ws, { code });
      log.info('Terminal closed', { code });
    });
  });
};
