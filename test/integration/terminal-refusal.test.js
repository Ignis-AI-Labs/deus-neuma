/**
 * HR-6 close-on-refusal — REAL stack, no mocks (RULE 0).
 *
 * Boots the real terminal WS route (backend/routes/terminal-routes.js) on a
 * real HTTP + WebSocketServer — the same wiring server.js gives it — with the
 * real auth verifier (challenge → sign → verify → session token) and the real
 * terminal-manager spawning real PTYs (node-pty). Ten live sockets fill the
 * global MAX_TERMINALS budget; the eleventh must receive `terminal:error`
 * […] AND then be CLOSED by the server with code 1013
 * (the refused-socket leak, threat T2 in the wave-0 security analysis).
 *
 * If a PTY cannot spawn in this environment the run fails loudly — a refusal
 * "verified" without ten real shells behind it would prove nothing.
 */

import { createServer } from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { generateChallenge, verifySignature, createSessionToken, verifySessionToken } from '../../backend/services/auth.js';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';
import { setupTerminalRoutes } from '../../backend/routes/terminal-routes.js';

const MAX_TERMINALS = 10; // mirrors terminal-manager.js — the global PTY budget

// Real challenge-sign-verify session token (the repo's integration auth flow).
const makeAuthToken = async () => {
  const keypair = generateKeypair();
  const challenge = generateChallenge(keypair.address);
  const signature = await signMessage(keypair.privateKey, challenge);
  return createSessionToken(verifySignature(keypair.address, challenge, signature));
};

/**
 * Open one terminal socket and wait for its real PTY to speak (the first
 * `terminal:data` frame — the shell prompt). A `terminal:error` here means the
 * PTY could not spawn: reject loudly, never skip.
 */
const openLiveTerminal = (url, timeout = 20000) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('no terminal:data within timeout — PTY did not spawn'));
    }, timeout);
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'terminal:data') {
        clearTimeout(timer);
        resolve(ws);
      } else if (msg.type === 'terminal:error') {
        clearTimeout(timer);
        reject(new Error(`PTY spawn refused/failed: ${msg.message}`));
      }
    });
    ws.on('close', (code) => {
      clearTimeout(timer);
      reject(new Error(`socket closed before its PTY spoke (code ${code})`));
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

/** Open the over-budget socket; record every frame until the SERVER closes it. */
const openRefusedTerminal = (url, timeout = 20000) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const frames = [];
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('server never closed the refused socket (HR-6 regression)'));
    }, timeout);
    ws.on('message', (raw) => frames.push(JSON.parse(raw.toString())));
    ws.on('close', (code, reason) => {
      clearTimeout(timer);
      resolve({ frames, code, reason: reason.toString() });
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

describe('terminal refusal closes the socket (HR-6)', () => {
  let httpServer;
  let wss;
  let wsUrl;

  beforeAll(async () => {
    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer, maxPayload: 1048576 });
    setupTerminalRoutes(wss);
    await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const token = await makeAuthToken();
    // The shell is the install owner's (terminal-routes.js): this wallet owns the test's install.
    await makeInstallOwner(verifySessionToken(token).address);
    wsUrl = `ws://127.0.0.1:${httpServer.address().port}/terminal-ws?token=${encodeURIComponent(token)}`;
  });

  afterAll(async () => {
    // Let the server-side close handlers reap the PTYs before teardown.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => httpServer.close(resolve));
  });

  test('11th socket gets terminal:error then close(1013)', async () => {
    const sockets = [];
    try {
      // Serialized fill: each socket proves its PTY is live before the next.
      for (let i = 0; i < MAX_TERMINALS; i += 1) {
        sockets.push(await openLiveTerminal(wsUrl));
      }

      const refused = await openRefusedTerminal(wsUrl);
      const error = refused.frames.find((f) => f.type === 'terminal:error');
      expect(error).toBeDefined();
      expect(error.message).toBe('Too many terminals open');
      // No PTY ever stood behind the refused socket.
      expect(refused.frames.some((f) => f.type === 'terminal:data')).toBe(false);
      // The server — not the client — closed it, with the refusal code.
      expect(refused.code).toBe(1013);
      expect(refused.reason).toBe('terminal refused');
    } finally {
      for (const ws of sockets) {
        try { ws.close(); } catch { /* already down */ }
      }
    }
  }, 240000);
});
