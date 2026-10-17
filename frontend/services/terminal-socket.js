// terminal-socket.js — the integrated terminal's own WebSocket.
//
// impure — opens a dedicated socket to /terminal-ws (NOT the portal),
// carrying the session token and, when this window is focused on a folder,
// the cwd HINT (`&cwd=`). The server re-validates the hint against the
// opened roots (resolveFocusPath) and degrades server-side — the client
// never decides where a shell actually spawns. Frames are JSON: data both
// ways, resize up, exit down. Returns a small handle the xterm stage wires to.

import { apiCall } from '../utils/http.js';

/** impure — which CLI agents this machine can spawn into a terminal. */
export const listTerminalAgents = () =>
  apiCall('GET', '/api/v1/terminal/agents', { errorPrefix: 'Could not list agents' });

/**
 * @param {{token?: string, cwd?: string|null, launch?: string|null, termId?: string|null,
 *          onHello?: (info:{id:string, attached:boolean})=>void,
 *          onData?: (s:string)=>void, onExit?: (code:number)=>void, onError?: (message:string, code?:string)=>void, onOpen?: ()=>void, onClose?: (info:{code?:number})=>void}} h
 *   `launch` is an agent catalog id (claude/kimi/grok/opencode…) — the server
 *   resolves it against the closed allowlist and spawns that binary instead
 *   of a shell; unknown/uninstalled ids are refused server-side. `termId`
 *   asks to REATTACH to a detached-but-alive terminal (friction-map D3) —
 *   the server answers with `terminal:hello {id, attached}` and replay, or
 *   refuses an unavailable ID. A refusal never silently spawns a replacement.
 */
// impure
export const openTerminalSocket = ({ token = sessionStorage.getItem('authToken') || '', cwd = null, launch = null, termId = null, onHello, onData, onExit, onError, onOpen, onClose } = {}) => {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const cwdParam = cwd ? `&cwd=${encodeURIComponent(cwd)}` : '';
  const launchParam = launch ? `&launch=${encodeURIComponent(launch)}` : '';
  const termParam = termId !== null ? `&term=${encodeURIComponent(termId)}` : '';
  const ws = new WebSocket(`${proto}//${window.location.host}/terminal-ws?token=${encodeURIComponent(token)}${cwdParam}${launchParam}${termParam}`);

  ws.onopen = () => onOpen?.();
  ws.onmessage = (e) => {
    if (!sameIdentity()) return;
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === 'terminal:data') onData?.(msg.data);
    else if (msg.type === 'terminal:hello') onHello?.({ id: msg.id, attached: Boolean(msg.attached) });
    else if (msg.type === 'terminal:exit') onExit?.(msg.code);
    else if (msg.type === 'terminal:error') onError?.(msg.message, msg.code);
  };
  ws.onclose = (e) => onClose?.({ code: e?.code });

  let departing = false;
  const depart = (code, reason) => {
    if (departing) return;
    departing = true;
    ws.onmessage = null;
    ws.onclose = null;
    if (ws.readyState === WebSocket.CONNECTING) {
      ws.onopen = () => ws.close(code, reason);
    } else if (ws.readyState === WebSocket.OPEN) ws.close(code, reason);
  };
  const sameIdentity = () => {
    if (departing) return false;
    if (sessionStorage.getItem('authToken') === token) return true;
    onError?.('Terminal authentication changed; sign in again to recover', 'auth_changed');
    depart(4000, 'terminal identity replaced');
    return false;
  };

  return {
    send: (data) => { if (sameIdentity() && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'terminal:data', data })); },
    resize: (cols, rows) => { if (sameIdentity() && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'terminal:resize', cols, rows })); },
    detach: () => depart(4000, 'terminal view detached'),
    close: () => depart(1000, 'terminal closed by operator'),
  };
};
