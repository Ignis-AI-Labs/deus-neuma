/**
 * A birth starts on a clean connection: the grants, modes and plan a prior
 * being held on this socket never reach the newborn's stage calls. Real
 * WebSocketServer + real setupPortalRoutes + a real signed-challenge token +
 * the real StagedBirthHandler; the substrate is a real SSE HTTP server
 * standing in for the local model. A rehearsal, so nothing permanent is made.
 * The prior being's state is placed on the LIVE connection through the
 * portal's read seam (the state a bind and an ALWAYS grant leave behind).
 * No mock on the claimed path (RULE 0).
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import { promises as fsp } from 'fs';
import { createTempDir } from '../helpers/temp-fs.js';
import { setConfig } from '../../backend/services/llm-provider.js';
import { setupPortalRoutes } from '../../backend/routes/portal-routes.js';
import { __test as portalSeam } from '../../backend/routes/portal-connections.js';
import { generateChallenge, verifySignature, createSessionToken } from '../../backend/services/auth.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';
import { StagedBirthHandler } from '../../core/birth/staged-birth-handler.js';
import { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;

// A real SSE provider: every stage turn speaks one plain line.
const startProvider = () => new Promise((resolve) => {
  const server = createServer((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'openai/gpt-oss-120b' }] }));
      return;
    }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let sent = {};
      try { sent = JSON.parse(body || '{}'); } catch { sent = {}; }
      if (sent.stream === false) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: 'ready' } }] }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(sse({ choices: [{ delta: { content: 'I stir in the void.' } }] }));
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  server.listen(0, '127.0.0.1', () => resolve(server));
});

describe('birth:start resets the connection a prior being held', () => {
  let house, origRoot, prevDataRoot, provider, httpServer, wss;

  beforeAll(async () => {
    house = await createTempDir('birth-start-reset-house');
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    prevDataRoot = process.env.NEUMA_DATA_ROOT;
    process.env.NEUMA_DATA_ROOT = house;
    provider = await startProvider();
    setConfig({ provider: 'lm-studio', endpoint: `http://127.0.0.1:${provider.address().port}`, model: 'openai/gpt-oss-120b', apiKey: '' });
    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    setupPortalRoutes(wss, { birthHandler: new StagedBirthHandler() });
    await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
  }, 30000);

  afterAll(async () => {
    setWorkspacesRoot(origRoot);
    if (prevDataRoot === undefined) delete process.env.NEUMA_DATA_ROOT; else process.env.NEUMA_DATA_ROOT = prevDataRoot;
    process.emit('SIGTERM'); // portal-routes ping interval cleanup
    wss?.close();
    httpServer?.close();
    provider?.close();
    if (house) await fsp.rm(house, { recursive: true, force: true });
  });

  test('the prior being\'s ALWAYS grants, sensitive grants, plan and catalog are gone when the ceremony begins', async () => {
    const keypair = generateKeypair();
    const challenge = generateChallenge(keypair.address);
    const token = createSessionToken(verifySignature(keypair.address, challenge, await signMessage(keypair.privateKey, challenge)));
    const ws = new WebSocket(`ws://127.0.0.1:${httpServer.address().port}/?token=${token}`);
    let connection = null;
    const reached = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('birth start timed out')), 25000);
      ws.on('error', reject);
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'portal:established') {
          connection = portalSeam.connectionFor(msg.connectionId);
          // What a bound being and its operator's ALWAYS leave on the socket.
          connection.companion = { neumaId: 'prior-being', name: 'Prior' };
          connection.neumaId = 'prior-being';
          connection._sessionToolPolicy = { coding: { allowed: ['execute'], denied: [], requireApproval: [] } };
          connection._sensitiveGrants = [{ pattern: '.env', mode: 'read' }];
          connection._pathGrantsHydrated = true;
          connection._teamWorkspace = { root: '/tmp/prior-team' };
          connection._approvedPlan = { id: 'prior-plan' };
          connection._turnCatalog = [{ server: 'fs', name: 'read' }];
          ws.send(JSON.stringify({ type: 'birth:start', witnessName: 'ResetWitness', isTest: true }));
        }
        if (msg.type === 'birth:stage_prompt' || msg.type === 'birth:stage_complete') { clearTimeout(timer); resolve('began'); }
        if (msg.type === 'birth:ended' || msg.type === 'birth:error' || msg.type === 'birth:blocked') { clearTimeout(timer); resolve(`${msg.type}: ${msg.reason || msg.message}`); }
      });
    });
    expect(reached).toBe('began');
    expect(connection.birthSession).toBeTruthy();
    expect(connection.companion).toBeNull();
    expect(connection._sessionToolPolicy).toBeNull();
    expect(connection._sensitiveGrants).toBeUndefined();
    expect(connection._pathGrantsHydrated).toBe(false);
    expect(connection._teamWorkspace).toBeUndefined();
    expect(connection._approvedPlan).toBeUndefined();
    expect(connection._turnCatalog).toBeUndefined();
    ws.close();
  }, 30000);
});
