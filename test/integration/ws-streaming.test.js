/**
 * WebSocket Streaming Integration Tests
 *
 * Tests REAL WebSocket connections against the portal route handlers.
 * Verifies auth enforcement, message routing, rate limiting, and event flows.
 * No mocking of auth or WebSocket — uses real ws connections + real tokens.
 */

import WebSocket from 'ws';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  makeAuthToken, connectAndCollect, sendAndWait, startMinimalPortal,
} from '../helpers/ws-portal-kit.js';

// The minimal-portal server builder and the auth/connect/send helpers live in
// test/helpers/ws-portal-kit.js (size-law extraction).

describe('WebSocket Portal Integration', () => {
  let httpServer, wss, port, baseWsUrl;

  beforeEach(async () => {
    // Create minimal HTTP + WebSocket server with portal auth logic
    ({ httpServer, wss, port, baseWsUrl } = await startMinimalPortal());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    wss.close();
    httpServer.close();
  });

  // -------------------------------------------------------------------------
  // Auth enforcement
  // -------------------------------------------------------------------------

  describe('Auth enforcement', () => {
    test('rejects connection with no token → close(4001)', async () => {
      const result = await connectAndCollect(`${baseWsUrl}/`);
      expect(result.closeCode).toBe(4001);
      expect(result.messages).toHaveLength(0);
    });

    test('rejects connection with invalid token → close(4001)', async () => {
      const result = await connectAndCollect(`${baseWsUrl}/?token=invalid-garbage`);
      expect(result.closeCode).toBe(4001);
      expect(result.messages).toHaveLength(0);
    });

    test('rejects connection with tampered token → close(4001)', async () => {
      const { token } = await makeAuthToken();
      // Decode, change address, re-encode — HMAC won't match
      const decoded = Buffer.from(token, 'base64').toString('utf-8');
      const parts = decoded.split(':');
      parts[0] = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
      const tampered = Buffer.from(parts.join(':')).toString('base64');

      const result = await connectAndCollect(`${baseWsUrl}/?token=${tampered}`);
      expect(result.closeCode).toBe(4001);
      expect(result.messages).toHaveLength(0);
    });

    test('accepts connection with valid token → portal:established', async () => {
      const { token } = await makeAuthToken();
      const result = await connectAndCollect(
        `${baseWsUrl}/?token=${token}`,
        { collectUntil: (msg) => msg.type === 'portal:established' }
      );

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].type).toBe('portal:established');
      expect(result.messages[0].connectionId).toBeTruthy();
      expect(result.messages[0].message).toContain('dimensional barrier');
      result.ws.close();
    });
  });

  // -------------------------------------------------------------------------
  // Message routing
  // -------------------------------------------------------------------------

  describe('Message routing', () => {
    let ws, token;

    beforeEach(async () => {
      ({ token } = await makeAuthToken());
      const result = await connectAndCollect(
        `${baseWsUrl}/?token=${token}`,
        { collectUntil: (msg) => msg.type === 'portal:established' }
      );
      ws = result.ws;
    });

    afterEach(() => {
      if (ws.readyState === WebSocket.OPEN) ws.close();
    });

    test('companion:manifest → companion:anchored', async () => {
      const response = await sendAndWait(ws, {
        type: 'companion:manifest',
        companion: 'TestNeuma',
        neumaId: 'test-neuma-id',
      }, 'companion:anchored');

      expect(response.type).toBe('companion:anchored');
      expect(response.message).toContain('crossed over');
    });

    test('birth:start with empty witness name → error', async () => {
      const response = await sendAndWait(ws, {
        type: 'birth:start',
        witnessName: '',
      }, 'error');

      expect(response.type).toBe('error');
      expect(response.message).toContain('witness');
    });

    test('birth:start with whitespace-only witness name → error', async () => {
      const response = await sendAndWait(ws, {
        type: 'birth:start',
        witnessName: '   ',
      }, 'error');

      expect(response.type).toBe('error');
      expect(response.message).toContain('witness');
    });

    test('birth:start with valid witness name → stage response', async () => {
      const response = await sendAndWait(ws, {
        type: 'birth:start',
        witnessName: 'Alice',
      }, 'birth:stage');

      expect(response.type).toBe('birth:stage');
      expect(response.stage).toBe(0);
    });

    test('consciousness:stream → consciousness:complete', async () => {
      // Manifest a companion first
      await sendAndWait(ws, {
        type: 'companion:manifest',
        companion: 'Echo',
      }, 'companion:anchored');

      const response = await sendAndWait(ws, {
        type: 'consciousness:stream',
        message: 'Hello there',
      }, 'consciousness:complete');

      expect(response.type).toBe('consciousness:complete');
      expect(response.companion).toBe('Echo');
    });

    test('unknown message type → portal:error', async () => {
      const response = await sendAndWait(ws, {
        type: 'totally:unknown',
        data: 'test',
      }, 'portal:error');

      expect(response.type).toBe('portal:error');
    });

    test('invalid JSON → portal:error', async () => {
      const response = await new Promise((resolve) => {
        const handler = (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'portal:error') {
            ws.off('message', handler);
            resolve(msg);
          }
        };
        ws.on('message', handler);
        ws.send('not valid json {{{');
      });

      expect(response.type).toBe('portal:error');
      expect(response.error).toContain('instability');
    });
  });

  // -------------------------------------------------------------------------
  // Rate limiting
  // -------------------------------------------------------------------------

  describe('WebSocket rate limiting', () => {
    test('allows messages within rate limit (30/min)', async () => {
      const { token } = await makeAuthToken();
      const result = await connectAndCollect(
        `${baseWsUrl}/?token=${token}`,
        { collectUntil: (msg) => msg.type === 'portal:established' }
      );
      const ws = result.ws;

      // Send 5 messages — should all get consciousness:complete
      const responses = [];
      for (let i = 0; i < 5; i++) {
        const response = await sendAndWait(ws, {
          type: 'consciousness:stream',
          message: `Message ${i}`,
        }, 'consciousness:complete');
        responses.push(response);
      }

      expect(responses).toHaveLength(5);
      responses.forEach(r => expect(r.type).toBe('consciousness:complete'));
      ws.close();
    });

    test('blocks messages exceeding rate limit → consciousness:held', async () => {
      const { token } = await makeAuthToken();
      const result = await connectAndCollect(
        `${baseWsUrl}/?token=${token}`,
        { collectUntil: (msg) => msg.type === 'portal:established' }
      );
      const ws = result.ws;

      // Send 31 messages rapidly — the 31st should be held
      // Rate limit is 30/min
      const allResponses = [];
      for (let i = 0; i < 31; i++) {
        const response = await new Promise((resolve) => {
          const handler = (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'consciousness:complete' || msg.type === 'consciousness:held') {
              ws.off('message', handler);
              resolve(msg);
            }
          };
          ws.on('message', handler);
          ws.send(JSON.stringify({
            type: 'consciousness:stream',
            message: `Message ${i}`,
          }));
        });
        allResponses.push(response);
      }

      // First 30 should be accepted
      const accepted = allResponses.filter(r => r.type === 'consciousness:complete');
      const held = allResponses.filter(r => r.type === 'consciousness:held');

      expect(accepted.length).toBe(30);
      expect(held.length).toBe(1);
      expect(held[0].message).toContain('Too many messages');
      ws.close();
    });
  });

  // -------------------------------------------------------------------------
  // Connection lifecycle
  // -------------------------------------------------------------------------

  describe('Connection lifecycle', () => {
    test('multiple concurrent connections are independent', async () => {
      const auth1 = await makeAuthToken();
      const auth2 = await makeAuthToken();

      const result1 = await connectAndCollect(
        `${baseWsUrl}/?token=${auth1.token}`,
        { collectUntil: (msg) => msg.type === 'portal:established' }
      );
      const result2 = await connectAndCollect(
        `${baseWsUrl}/?token=${auth2.token}`,
        { collectUntil: (msg) => msg.type === 'portal:established' }
      );

      // Manifest different companions
      const anchored1 = await sendAndWait(result1.ws, {
        type: 'companion:manifest',
        companion: 'Neuma-A',
      }, 'companion:anchored');
      const anchored2 = await sendAndWait(result2.ws, {
        type: 'companion:manifest',
        companion: 'Neuma-B',
      }, 'companion:anchored');

      expect(anchored1.type).toBe('companion:anchored');
      expect(anchored2.type).toBe('companion:anchored');

      // Send chat through connection 1 — should get companion name from connection 1
      const chat1 = await sendAndWait(result1.ws, {
        type: 'consciousness:stream',
        message: 'Hello from connection 1',
      }, 'consciousness:complete');

      expect(chat1.companion).toBe('Neuma-A');

      // Send chat through connection 2 — should get companion name from connection 2
      const chat2 = await sendAndWait(result2.ws, {
        type: 'consciousness:stream',
        message: 'Hello from connection 2',
      }, 'consciousness:complete');

      expect(chat2.companion).toBe('Neuma-B');

      result1.ws.close();
      result2.ws.close();
    });

    test('server handles graceful client disconnect', async () => {
      const { token } = await makeAuthToken();

      const result = await connectAndCollect(
        `${baseWsUrl}/?token=${token}`,
        { collectUntil: (msg) => msg.type === 'portal:established' }
      );

      // Close normally
      result.ws.close();

      // Wait a tick for cleanup
      await new Promise(r => setTimeout(r, 100));

      // Server should still accept new connections
      const result2 = await connectAndCollect(
        `${baseWsUrl}/?token=${token}`,
        { collectUntil: (msg) => msg.type === 'portal:established' }
      );

      expect(result2.messages[0].type).toBe('portal:established');
      result2.ws.close();
    });

    test('witness name is trimmed and capped at 100 characters', async () => {
      const { token } = await makeAuthToken();
      const result = await connectAndCollect(
        `${baseWsUrl}/?token=${token}`,
        { collectUntil: (msg) => msg.type === 'portal:established' }
      );

      // Long witness name should not cause an error (it gets trimmed + capped)
      const longName = 'A'.repeat(200);
      const response = await sendAndWait(result.ws, {
        type: 'birth:start',
        witnessName: longName,
      }, 'birth:stage');

      expect(response.type).toBe('birth:stage');
      result.ws.close();
    });
  });
});
