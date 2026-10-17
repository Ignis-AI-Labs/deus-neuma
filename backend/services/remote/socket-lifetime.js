/** Device authority belongs to the whole connection, not just its handshake. */
import { remoteStore } from './remote-store.js';
import { accessDecision } from './access-guard.js';
import { DEVICE_TTL_MS } from './pairing.js';

/**
 * Bind a remote portal to its admitted device; local portals need no lease.
 * Recheck both directions because a close handshake can race buffered frames.
 *
 * Road B (native): the tunnel marker rides `req.socket`, and the re-check
 * carries it so a revoked device's next frame fails the SPKI lookup. The
 * `origin` freeze — […] —
 * applies only to tailnet-scope sockets; otherwise enabling the tailnet
 * road later would spuriously cut every native phone, and disabling it
 * would cut them while their own road is still on.
 *
 * impure (socket events, timers, store subscription).
 * @param {import('ws').WebSocket} ws
 * @param {import('http').IncomingMessage} req
 * @param {object} admission
 * @param {object} [store]
 */
export const bindRemoteSocket = (ws, req, admission, store = remoteStore) => {
  if (admission.scope !== 'remote') return;
  const device = admission.device;
  const tunnel = req.socket?.neumaTunnel ?? null;
  const isTailnet = !tunnel?.spki;
  const remoteAddress = req.socket?.remoteAddress;
  const origin = store.get().origin;
  const emit = ws.emit.bind(ws);
  const send = ws.send.bind(ws);
  let timer;
  let unsubscribe = () => {};
  const revoke = () => {
    if (ws.remoteRevoked) return false;
    ws.remoteRevoked = true;
    clearTimeout(timer);
    unsubscribe();
    emit('remote:revoked');
    ws.close(4003, 'Device access revoked; pair again');
    return false;
  };
  const valid = () => {
    if (ws.remoteRevoked) return false;
    const state = store.get();
    const current = accessDecision({
      headers: req.headers, remoteAddress,
      method: req.method, path: '/ws', state, tunnel,
    });
    const sameDevice = current.device?.id === device?.id
      && (tunnel?.spki
        ? current.device?.spki === device?.spki
        : current.device?.hash === device?.hash);
    return ((isTailnet ? state.origin === origin : true)
      && current.allow && current.scope === 'remote' && sameDevice)
      || revoke();
  };
  // EventEmitter listeners cannot cancel later listeners. Gate emission itself
  // so neither the portal dispatcher nor sibling-follow sees a revoked frame.
  ws.emit = (event, ...args) => {
    if (event === 'message' && !valid()) return false;
    return emit(event, ...args);
  };
  ws.send = (...args) => {
    if (!valid()) return;
    return send(...args);
  };
  const schedule = () => {
    if (!valid()) return;
    const remaining = Date.parse(device.createdAt) + DEVICE_TTL_MS - Date.now();
    timer = setTimeout(schedule, Math.min(Math.max(remaining, 1), 2 ** 31 - 1));
    timer.unref?.();
  };
  unsubscribe = store.subscribe(valid);
  ws.once('close', () => { clearTimeout(timer); unsubscribe(); });
  schedule();
};
