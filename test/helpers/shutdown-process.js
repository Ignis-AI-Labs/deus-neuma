// Real child host for gracefulShutdown, independent of the full daemon boot.
import process from 'node:process';
import http from 'node:http';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { gracefulShutdown } from '../../backend/services/shutdown.js';
import { startHeartbeat, stopHeartbeat } from '../../backend/services/heartbeat.js';
import { createLogger } from '../../backend/services/logger.js';
import { verifySessionToken } from '../../backend/services/auth.js';
import { fullAuth } from './audit-auth.js';

const auth = await fullAuth();
const server = http.createServer((req, res) => {
  if (req.url === '/hold') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.write('response still open');
    return;
  }
  res.end('ready');
});
const sockets = [new WebSocketServer({ noServer: true }), new WebSocketServer({ noServer: true })];
server.on('upgrade', (req, socket, head) => {
  const target = req.url === '/portal' ? sockets[0] : req.url === '/terminal' ? sockets[1] : null;
  if (!target || !verifySessionToken(req.headers.authorization?.slice(7))) {
    socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    return;
  }
  target.handleUpgrade(req, socket, head, (peer) => target.emit('connection', peer, req));
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
// Arm the real hygiene timer; the test stops it before its first cycle.
startHeartbeat(60_000);
process.once('SIGTERM', () => gracefulShutdown({
  server, sockets, stopHeartbeat, log: createLogger('ShutdownProof'),
  exit: (code) => process.exit(code), timeoutMs: 500,
}));
process.send({ port: server.address().port, token: auth.token });
