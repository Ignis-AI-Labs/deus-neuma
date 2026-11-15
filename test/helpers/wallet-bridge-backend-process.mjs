import express from 'express';
import http from 'node:http';
import { createBridgeRouter } from '../../backend/services/auth-bridge.js';
import { createAuthRouter } from '../../backend/services/auth.js';
import { installWalletBridgeIpc } from '../../backend/services/auth-bridge-ipc.js';

installWalletBridgeIpc();
const app = express();
app.use(express.json());
app.use('/api/v1/auth/bridge', createBridgeRouter(express));
app.use('/api/v1/auth', createAuthRouter(express));
const server = http.createServer(app);
server.listen(0, '127.0.0.1', () => {
  process.send({ type: 'wallet-bridge-test-ready', port: server.address().port });
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
