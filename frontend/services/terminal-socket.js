// terminal-socket.js — the integrated terminal's own WebSocket.
// impure — a short-lived exact-lane ticket authorizes the upgrade; the captured
// session identity still guards input, reattach and explicit close.

import { apiCall } from '../utils/http.js';
import { deskSocketUrl } from './desk-tickets.js';

/** impure — which CLI agents this machine can spawn into a terminal. */
export const listTerminalAgents = () =>
  apiCall('GET', '/api/v1/terminal/agents', { errorPrefix: 'Could not list agents' });

/**
 * @param {{token?: string, cwd?: string|null, launch?: string|null, termId?: string|null,
 *          onHello?: (info:{id:string, attached:boolean, cwd?:string})=>void,
 *          onData?: (s:string)=>void, onExit?: (code:number)=>void, onError?: (message:string, code?:string)=>void, onOpen?: ()=>void, onClose?: (info:{code?:number})=>void}} h
 */
// impure
export const openTerminalSocket = ({ token = sessionStorage.getItem('authToken') || '', cwd = null, launch = null, termId = null, onHello, onData, onExit, onError, onOpen, onClose } = {}) => {
  let ws = null;
  let departing = false;
  const pendingInput = [];
  let pendingResize = null;

  const sameIdentity = () => {
    if (departing) return false;
    if (sessionStorage.getItem('authToken') === token) return true;
    onError?.('Terminal authentication changed; sign in again to recover', 'auth_changed');
    depart(4000, 'terminal identity replaced');
    return false;
  };
  const depart = (code, reason) => {
    if (departing) return;
    departing = true;
    if (ws) {
      ws.onmessage = null;
      ws.onclose = null;
      if (ws.readyState === WebSocket.CONNECTING) ws.onopen = () => ws.close(code, reason);
      else if (ws.readyState === WebSocket.OPEN) ws.close(code, reason);
    }
  };

  const ready = deskSocketUrl('/terminal-ws', { cwd, launch, term: termId }).then((url) => {
    if (departing) return;
    ws = new WebSocket(url);
    ws.onopen = () => {
      for (const data of pendingInput.splice(0)) ws.send(JSON.stringify({ type: 'terminal:data', data }));
      if (pendingResize) {
        ws.send(JSON.stringify({ type: 'terminal:resize', ...pendingResize }));
        pendingResize = null;
      }
      onOpen?.();
    };
    ws.onmessage = (e) => {
      if (!sameIdentity()) return;
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'terminal:data') onData?.(msg.data);
      else if (msg.type === 'terminal:hello') onHello?.({ id: msg.id, attached: Boolean(msg.attached), cwd: msg.cwd });
      else if (msg.type === 'terminal:exit') onExit?.(msg.code);
      else if (msg.type === 'terminal:error') onError?.(msg.message, msg.code);
    };
    ws.onclose = (e) => onClose?.({ code: e?.code });
  }).catch((error) => {
    if (departing) return;
    onError?.(error.message);
    onClose?.({ code: 4001 });
  });

  return {
    send: (data) => {
      if (!sameIdentity()) return;
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'terminal:data', data }));
      else if (!departing) pendingInput.push(data);
    },
    resize: (cols, rows) => {
      if (!sameIdentity()) return;
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'terminal:resize', cols, rows }));
      else if (!departing) pendingResize = { cols, rows };
    },
    detach: () => depart(4000, 'terminal view detached'),
    close: () => {
      const code = 1000;
      const reason = 'terminal closed by operator';
      if (!ws) {
        departing = true;
        ready.finally(() => { if (ws) ws.close(code, reason); });
        return;
      }
      depart(code, reason);
    },
  };
};
