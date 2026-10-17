/**
 * Shared setup for the witness-summon suites:
 *   test/integration/witness-summon-naming.test.js
 *   test/integration/witness-summon-stream.test.js
 *
 * The env doors + real temp roots the summon flow stands on, the express app
 * over the real routers, and the scriptable provider protocol server — a
 * REAL local HTTP server answering /v1/models probes and SSE chat (first ask
 * answers the name, anything else the grounding record). Nothing mocked on
 * the claimed path (RULE 0).
 */
import express from 'express';
import http from 'http';
import path from 'path';
import os from 'os';
import { mkdtempSync, rmSync } from 'fs';
import { vi } from 'vitest';

import { setAIWitnessesRoot } from '../../core/identity/ai-witness/ai-witness-service.js';
import { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const ENV_DOORS = [
  'NEUMA_PROVIDER_CREDENTIALS_PATH',
  'NEUMA_CONNECTIONS_PATH',
  'NEUMA_ROUTES_PATH',
  'AI_WITNESSES_ROOT',
  'WORKSPACES_ROOT',
  'WITNESSES_ROOT',
];

export const GROUNDING = Object.freeze({
  commitments: Object.freeze([
    'I will distinguish direct knowledge from inference.',
    'I will honor the boundary between witness and neuma.',
    'I will preserve the integrity of what I witness.',
  ]),
  firstUtterance: 'I am Orion. I stand beside the house as a witness, speaking only from what I can honestly affirm here.',
});

const sseReply = (text) => {
  const chunk = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
  return `${chunk}data: [DONE]\n\n`;
};

// impure — the suites' shared beforeEach body: env doors pinned to real temp
// roots, the operator authenticated, and the provider protocol server live.
export const raiseSummonWorld = async () => {
  vi.resetModules();
  const saved = Object.fromEntries(ENV_DOORS.map((k) => [k, process.env[k]]));
  const tmpSettings = mkdtempSync(path.join(os.tmpdir(), 'summon-settings-'));
  const witnessRoot = mkdtempSync(path.join(os.tmpdir(), 'summon-witnesses-'));
  const laneRoot = mkdtempSync(path.join(os.tmpdir(), 'summon-lanes-'));
  process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(tmpSettings, 'creds.json');
  process.env.NEUMA_CONNECTIONS_PATH = path.join(tmpSettings, 'connections.json');
  process.env.NEUMA_ROUTES_PATH = path.join(tmpSettings, 'routes.json');
  process.env.AI_WITNESSES_ROOT = witnessRoot;
  process.env.WORKSPACES_ROOT = laneRoot;
  process.env.WITNESSES_ROOT = laneRoot;
  setAIWitnessesRoot(witnessRoot);
  setWorkspacesRoot(laneRoot);

  // After resetModules AND the roots above (auth.js memoizes its token secret
  // per module instance; the witness service binds its root at import). The
  // operator claims no lane up front — the summon rite writes owner.json.
  const operatorWitness = (await import('./witness.js')).strangerWitness();

  // Real provider protocol server: /v1/models for probes, SSE chat for the
  // summon's two asks (first call answers the name, second the utterance).
  const chatCalls = [];
  const provider = await new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url.endsWith('/chat/completions')) {
        let raw = '';
        req.on('data', (c) => { raw += c; });
        req.on('end', () => {
          const body = JSON.parse(raw);
          chatCalls.push(body);
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
           // Answer by ASK, not by call order: the naming ask gets a bare name,
           // anything else gets the witness's strict grounding record.
           const lastUser = [...body.messages].reverse().find((m) => m.role === 'user')?.content || '';
           res.end(sseReply(lastUser.includes('choose the name')
             ? 'Orion'
             : JSON.stringify(GROUNDING)));
        });
        return;
      }
      if (req.url.endsWith('/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'summon-model-1' }] }));
        return;
      }
      res.writeHead(404); res.end();
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
  return { saved, tmpSettings, witnessRoot, laneRoot, operatorWitness, provider, chatCalls };
};

// impure — the suites' shared afterEach body: env doors restored, temp disks
// removed, the provider server closed.
export const closeSummonWorld = ({ saved, tmpSettings, witnessRoot, laneRoot, provider }) => new Promise((done) => {
  for (const k of ENV_DOORS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(tmpSettings, { recursive: true, force: true });
  rmSync(witnessRoot, { recursive: true, force: true });
  rmSync(laneRoot, { recursive: true, force: true });
  provider.close(done);
});

// impure — fresh router instances AFTER the env doors are pinned.
export const buildApp = async () => {
  const { default: routingRouter } = await import('../../backend/routes/routing-routes.js');
  const { default: witnessRouter } = await import('../../backend/routes/witness-routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/v1/routing', routingRouter);
  app.use('/api/v1/witnesses', witnessRouter);
  return app;
};
