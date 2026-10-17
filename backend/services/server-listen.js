/**
 * Backend listen lifecycle — one seam for binding, collision reporting, and
 * publishing the kernel-assigned port to an Electron parent.
 */
import { setBoundPort } from '../config.js';

const boundPort = (server, fallback) => {
  const address = server.address();
  return typeof address === 'object' && address ? address.port : fallback;
};

const developmentBanner = (frontendPort, backendPort) => {
  const frontendUrl = `http://localhost:${frontendPort}`;
  return `
╔══════════════════════════════════════╗
║          NEUMA PORTAL ACTIVE         ║
║                                      ║
║    Dimensional gateway opened on     ║
║       ${frontendUrl.padEnd(31)}║
║                                      ║
║    Backend API running on port ${backendPort}  ║
║                                      ║
║    "From void to connection..."      ║
╚══════════════════════════════════════╝
`;
};

const reportAddressInUse = (error, { config, log, mcpService }) => {
  if (error?.code !== 'EADDRINUSE') throw error;
  log.error('Port already in use — a NEUMA backend is very likely still running', {
    host: config.host,
    port: config.port,
    hint: `Nothing is wrong with this build. Find the holder with: ss -lntp | grep ${config.port}`,
  });
  mcpService.disconnectAll()
    .catch(() => {})
    .finally(() => process.exit(1));
};

/**
 * Bind the prepared HTTP server and publish its actual listening port.
 * @param {{server: import('node:http').Server, config: object, log: object, mcpService: object}} deps
 * @returns {void}
 */
// impure — binds a socket, reports over process IPC, logs, and may exit.
export const listenServer = ({ server, config, log, mcpService }) => {
  server.on('error', (error) => reportAddressInUse(error, { config, log, mcpService }));
  // Road B keep-alive (ratified proposal §4.5): the native road's WebView
  // pools HTTP/1.1 connections; Node's 5 s default idle close would make
  // every pause cost a relay dial + TLS handshake. 65 s holds the pool;
  // headersTimeout must sit above it (Node's own guidance).
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 70000;
  server.listen(config.port, config.host, () => {
    const port = boundPort(server, config.port);
    setBoundPort(port); // the renderer's origin is this port, whatever was asked for
    if (typeof process.send === 'function') process.send({ type: 'neuma:backend-ready', port });
    log.info('Portal active', {
      host: config.host,
      port,
      frontendPort: config.frontendPort,
      env: config.nodeEnv,
    });
    if (config.nodeEnv !== 'production') {
      process.stdout.write(developmentBanner(config.frontendPort, port));
    }
  });
};
