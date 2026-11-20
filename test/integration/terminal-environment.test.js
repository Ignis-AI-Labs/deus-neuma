import { createServer } from 'node:http';
import process from 'node:process';
import { setTimeout, clearTimeout } from 'node:timers';
import WebSocket, { WebSocketServer } from 'ws';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { generateChallenge, verifySignature, createSessionToken, verifySessionToken } from '../../backend/services/auth.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';
import { setupTerminalRoutes } from '../../backend/routes/terminal-routes.js';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';
import { ticketedWsUrl } from '../helpers/desk-ticket-kit.js';

const SECRET_KEYS = ['SUPABASE_SERVICE_KEY', 'X_API_KEY', 'NEUMA_SIDECAR_KEY', 'DNA_ENCRYPTION_KEY', 'UNKNOWN_SENTINEL'];
let server;
let wss;
let baseUrl;
const prior = {};

beforeAll(async () => {
  for (const key of SECRET_KEYS) {
    prior[key] = process.env[key];
    process.env[key] = `${key.toLowerCase()}-harmless-sentinel`;
  }
  server = createServer();
  wss = new WebSocketServer({ server });
  setupTerminalRoutes(wss);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const keypair = generateKeypair();
  const challenge = generateChallenge(keypair.address);
  const signature = await signMessage(keypair.privateKey, challenge);
  const token = createSessionToken(verifySignature(keypair.address, challenge, signature));
  await makeInstallOwner(verifySessionToken(token).address);
  baseUrl = ticketedWsUrl(`ws://127.0.0.1:${server.address().port}/terminal-ws`, token, '/terminal-ws');
}, 30_000);

afterAll(async () => {
  for (const key of SECRET_KEYS) {
    if (prior[key] === undefined) delete process.env[key];
    else process.env[key] = prior[key];
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  await new Promise((resolve) => wss.close(resolve));
  await new Promise((resolve) => server.close(resolve));
});

describe('a plain terminal PTY', () => {
  test('starts a real shell without backend or unknown secret environment names', async () => {
    const output = await new Promise((resolve, reject) => {
      const ws = new WebSocket(baseUrl);
      let text = '';
      let asked = false;
      const timer = setTimeout(() => { ws.close(); reject(new Error(`PTY did not answer: ${text}`)); }, 20_000);
      ws.on('message', (raw) => {
        let frame;
        try { frame = JSON.parse(raw.toString()); } catch { return; }
        if (frame.type === 'terminal:error') {
          clearTimeout(timer);
          ws.close();
          reject(new Error(frame.message));
          return;
        }
        if (frame.type === 'terminal:hello' && !asked) {
          asked = true;
          ws.send(JSON.stringify({ type: 'terminal:data', data: "printf '\\n__ENV_BEGIN__\\n'; env; printf '\\n__ENV_END__\\n'\n" }));
        }
        if (frame.type !== 'terminal:data') return;
        text += frame.data;
        if (/\r?\n__ENV_END__\r?\n/.test(text)) {
          clearTimeout(timer);
          ws.close();
          resolve(text);
        }
      });
      ws.on('error', reject);
    });
    expect(output).toContain('__ENV_END__');
    expect(output).toMatch(/HOME=/);
    expect(output).toMatch(/PATH=/);
    expect(output).toMatch(/TERM=xterm-256color/);
    for (const key of SECRET_KEYS) expect(output).not.toContain(`${key}=`);
  }, 30_000);
});
