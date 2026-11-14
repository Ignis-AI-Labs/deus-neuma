/**
 * Terminal routes — the WebSocket connection handler for the integrated
 * terminal. Mirrors the portal's auth-on-connect (`?token=` → verify → close
 * 4001), admits only the install owner or a co-owner (else close 4003), then
 * binds an owned PTY. Disposal detaches; explicit close kills.
 *
 * The shell's cwd honors the window's focus (`?cwd=`) — an UNTRUSTED client
 * path that must clear resolveFocusPath (the one focus-path containment
 * chokepoint: inside the opened explorer roots, symlinks resolved, an
 * existing directory) before it is used. Anything else degrades server-side:
 * the legacy global active project, else the first opened root. A hostile
 * path is never spawned into; old clients (no `?cwd=`) are unchanged.
 */
import os from 'node:os';
import { Router } from 'express';
import { verifySessionToken, requireAuth } from '../services/auth.js';
import { passesInstallOwner } from '../services/install-owner.js';
import { createLogger } from '../services/logger.js';
import { resolveFocusPath } from '../services/user-files.js';
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

// The shell opens in the folder in focus (contained: resolveFocusPath), and with
// nothing in focus, in the home folder, where any terminal starts (Founder,
// 2026-11-10: […]).
const resolveCwd = (requestedCwd) => resolveFocusPath(requestedCwd) || os.homedir();

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
    // The shell runs as this computer's OS user, so it is the machine's, not a
    // house's: any wallet can sign in, but only the install owner or a co-owner
    // at this computer's own desk opens one. An unreadable owner record refuses.
    req.walletAddress = session.address;
    const mayOpen = await passesInstallOwner(req).catch((err) => {
      log.error('Terminal owner check failed', { err: err.message });
      return false;
    });
    if (ws.readyState !== ws.OPEN) return;
    if (!mayOpen) {
      log.info('Terminal refused to a guest', { wallet: session.address });
      ws.close(4003, 'owner only');
      return;
    }
    const termId = params.get('term');
    const cwd = termId ? undefined : resolveCwd(params.get('cwd'));
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
