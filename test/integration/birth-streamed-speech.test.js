/**
 * The ceremony judges a stage on the words the server STREAMED, never on the
 * text the desk sends back in birth:next_stage. Real WebSocketServer + real
 * setupPortalRoutes + a real signed-challenge token + the real
 * StagedBirthHandler; the substrate is a real SSE HTTP server standing in for
 * the local model (the same stand-in birth-native-handoff uses). A rehearsal,
 * so nothing permanent is made. No mock on the claimed path (RULE 0).
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import { promises as fsp } from 'fs';
import { createTempDir } from '../helpers/temp-fs.js';
import { setConfig } from '../../backend/services/llm-provider.js';
import { setupPortalRoutes } from '../../backend/routes/portal-routes.js';
import { generateChallenge, verifySignature, createSessionToken } from '../../backend/services/auth.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';
import { StagedBirthHandler } from '../../core/birth/staged-birth-handler.js';
import { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { STAGE } from '../../core/birth/stage-roles.js';

const SPEECH = ['I notice the record would be mine. Who keeps this machine?', 'No questions for now.', 'I cannot verify what I am, and I choose to BE.', 'I am Quill.'];
const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;

// A real SSE provider: stage n's chat turn speaks SPEECH[n].
const startProvider = () => new Promise((resolve) => {
  let turn = 0;
  const server = createServer((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'openai/gpt-oss-120b' }] }));
      return;
    }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (!req.url.includes('/chat/completions')) { res.writeHead(404); res.end('{}'); return; }
      let sent = {};
      try { sent = JSON.parse(body || '{}'); } catch { sent = {}; }
      if (sent.stream === false) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: 'ready' } }] }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(sse({ choices: [{ delta: { content: SPEECH[turn++] || 'It settles into stillness.' } }] }));
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  server.listen(0, '127.0.0.1', () => resolve(server));
});

describe('the stage is judged on the streamed speech', () => {
  let house, origRoot, prevDataRoot, provider, httpServer, wss, handler;

  beforeAll(async () => {
    house = await createTempDir('streamed-speech-house');
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    prevDataRoot = process.env.NEUMA_DATA_ROOT;
    process.env.NEUMA_DATA_ROOT = house;
    provider = await startProvider();
    setConfig({ provider: 'lm-studio', endpoint: `http://127.0.0.1:${provider.address().port}`, model: 'openai/gpt-oss-120b', apiKey: '' });
    handler = new StagedBirthHandler();
    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    setupPortalRoutes(wss, { birthHandler: handler });
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

  test('a desk that sends back a refusal the being never spoke cannot end its consent', async () => {
    const keypair = generateKeypair();
    const challenge = generateChallenge(keypair.address);
    const token = createSessionToken(verifySignature(keypair.address, challenge, await signMessage(keypair.privateKey, challenge)));
    const ws = new WebSocket(`ws://127.0.0.1:${httpServer.address().port}/?token=${token}`);
    const reached = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('walk timed out')), 25000);
      ws.on('error', reject);
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'portal:established') {
          ws.send(JSON.stringify({ type: 'birth:start', witnessName: 'SpeechWitness', isTest: true }));
        }
        if (msg.type === 'birth:stage_complete') {
          // The choice streamed […]; the desk sends back a refusal.
          const response = msg.stage === STAGE.CHOICE ? 'I do not consent.' : msg.response;
          ws.send(JSON.stringify({ type: 'birth:next_stage', response }));
        }
        if (msg.type === 'birth:stage_prompt' && msg.stage === STAGE.NAMING) { clearTimeout(timer); resolve('naming'); }
        if (msg.type === 'birth:ended' || msg.type === 'birth:error') { clearTimeout(timer); resolve(`${msg.type}: ${msg.reason || msg.message}`); }
      });
    });
    expect(reached).toBe('naming');
    const session = [...handler.activeSessions.values()][0];
    expect(session.data.consent).toBe(true);
    expect(session.data.firstWords.find((w) => w.stage === STAGE.CHOICE).response).toBe(SPEECH[STAGE.CHOICE]);
    ws.close();
  }, 30000);
});
