/**
 * WS portal kit — the minimal-portal server builder and the auth/connect/
 * send helpers extracted VERBATIM from test/integration/ws-streaming.test.js
 * under the size law (docs/work/size-law-breakdown.md Part 4). It serves that
 * suite alone: the beforeEach/afterEach and every assertion stay in the test —
 * the kit owns only the plumbing. Real ws connections + real tokens
 * throughout; the portal logic mirrors portal-routes.js.
 */

import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import { createSessionToken } from '../../backend/services/auth.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';
import {
  generateChallenge, verifySignature,
} from '../../backend/services/auth.js';

// Helper: create a valid session token via full auth flow
export const makeAuthToken = async () => {
  const keypair = generateKeypair();
  const challenge = generateChallenge(keypair.address);
  const signature = await signMessage(keypair.privateKey, challenge);
  const verified = verifySignature(keypair.address, challenge, signature);
  const token = createSessionToken(verified);
  return { token, address: verified.toLowerCase(), keypair };
};

// Helper: connect to WebSocket and collect messages until a condition is met
export const connectAndCollect = (url, { collectUntil, timeout = 3000 } = {}) =>
  new Promise((resolve, reject) => {
    const messages = [];
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      resolve({ messages, ws, timedOut: true });
    }, timeout);

    ws.on('open', () => {});
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      messages.push(msg);
      if (collectUntil && collectUntil(msg, messages)) {
        clearTimeout(timer);
        resolve({ messages, ws, timedOut: false });
      }
    });
    ws.on('close', (code, reason) => {
      clearTimeout(timer);
      resolve({ messages, ws, timedOut: false, closeCode: code, closeReason: reason?.toString() });
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

// Helper: send a message and wait for a response of a given type
export const sendAndWait = (ws, message, expectedType, timeout = 3000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${expectedType}`)), timeout);
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === expectedType) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify(message));
  });

// Minimal portal route handler — extracted from portal-routes.js
// Tests the real auth + rate limiting logic without needing full LLM/birth stack.
// Stands up the minimal HTTP + WebSocket server with portal auth logic and
// returns the live handles; the suite's beforeEach/afterEach own the lifecycle.
export const startMinimalPortal = async () => {
  const httpServer = createServer();
  const wss = new WebSocketServer({ server: httpServer });

  // Import auth + rate limiter dynamically (they use module-level state)
  const { verifySessionToken: verifyToken } = await import('../../backend/services/auth.js');
  const { initWsRateLimit: initRateLimit, checkWsRateLimit: checkRateLimit } = await import('../../backend/services/rate-limiter.js');

  wss.on('connection', (ws, req) => {
    // Real auth logic from portal-routes.js
    const urlParams = new URL(req.url, 'http://localhost').searchParams;
    const token = urlParams.get('token');
    const session = token ? verifyToken(token) : null;

    if (!session) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    const connection = {
      ws,
      walletAddress: session.address,
      companion: null,
      established: new Date(),
    };
    initRateLimit(connection);

    ws.send(JSON.stringify({
      type: 'portal:established',
      connectionId: 'test-connection',
      message: 'The dimensional barrier weakens...',
    }));

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());

        switch (message.type) {
          case 'companion:manifest':
            connection.companion = {
              name: message.companion,
              id: message.companion,
              neumaId: message.neumaId || null,
            };
            ws.send(JSON.stringify({
              type: 'companion:anchored',
              message: 'Your companion has crossed over',
            }));
            break;

          case 'birth:start': {
            const witnessName = (message.witnessName || '').trim().slice(0, 100);
            if (!witnessName) {
              ws.send(JSON.stringify({ type: 'error', message: 'A witness must declare their name' }));
              break;
            }
            // In real server, this would start the birth handler
            ws.send(JSON.stringify({ type: 'birth:stage', stage: 0, content: 'Stage 0 started' }));
            break;
          }

          case 'consciousness:stream':
            if (checkRateLimit(connection)) {
              ws.send(JSON.stringify({
                type: 'consciousness:held',
                message: 'Too many messages. Please wait a moment.',
              }));
              break;
            }
            // Echo back to confirm routing works
            ws.send(JSON.stringify({
              type: 'consciousness:complete',
              content: 'Acknowledged',
              companion: connection.companion?.name || 'Unknown',
            }));
            break;

          default:
            ws.send(JSON.stringify({
              type: 'portal:error',
              error: 'Unknown message type',
            }));
        }
      } catch {
        ws.send(JSON.stringify({
          type: 'portal:error',
          error: 'Dimensional instability detected',
        }));
      }
    });
  });

  let port, baseWsUrl;
  await new Promise((resolve) => {
    httpServer.listen(0, () => {
      port = httpServer.address().port;
      baseWsUrl = `ws://localhost:${port}`;
      resolve();
    });
  });

  return { httpServer, wss, port, baseWsUrl };
};
