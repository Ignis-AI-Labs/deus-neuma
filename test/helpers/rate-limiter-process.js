/* global fetch */
// Fresh-process env ceiling proof through the actual Express middleware.
import process from 'node:process';
import express from 'express';
import http from 'node:http';
import { once } from 'node:events';
import { globalLimiter, authLimiter } from '../../backend/services/rate-limiter.js';
import { requireAuth } from '../../backend/services/auth.js';
import { fullAuth } from './audit-auth.js';

const app = express();
app.use(requireAuth);
app.use('/general', globalLimiter);
app.use('/auth', authLimiter);
app.use((_req, res) => res.sendStatus(204));
const server = http.createServer(app);
try {
  const auth = await fullAuth();
  const writer = await fullAuth(); // a second wallet: the write tier proves on a fresh bucket
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const drive = async (route, count, { method = 'GET', token = auth.token } = {}) => {
    for (let i = 1; i <= count; i++) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/${route}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
        ...(method === 'POST' ? { body: '{}' } : {}),
      });
      await response.text();
      if (response.status === 429) return i;
      if (response.status !== 204) throw new Error(`Unexpected admission status: ${response.status}`);
    }
    return null;
  };
  const general = await drive('general', Number(process.argv[2]));
  const writes = await drive('general', Number(process.argv[3]), { method: 'POST', token: writer.token });
  const authentication = await drive('auth', 11);
  process.stdout.write(`${JSON.stringify({ general, writes, authentication })}\n`);
} finally {
  server.closeAllConnections();
  if (server.listening) await new Promise((resolve) => server.close(resolve));
}
