/**
 * Shared setup for the witness-routes suites (integration, RULE 0):
 *   test/integration/api-witness-routes-management.test.js
 *   test/integration/api-witness-routes-turn.test.js
 *
 * Everything here is real: a real sealed witness (six-stage protocol on a
 * real temp disk) per test, the env doors those suites pin (saved and
 * restored around every test), the express app over the real routers, and a
 * REAL local HTTP server speaking the provider wire protocol (SSE). Nothing
 * here is mocked.
 */
import express from 'express';
import http from 'http';
import path from 'path';
import os from 'os';
import { mkdtempSync, rmSync } from 'fs';
import { vi } from 'vitest';

import { seal } from '../../core/identity/ai-witness/ai-witness-protocol.js';
import { setAIWitnessesRoot } from '../../core/identity/ai-witness/ai-witness-service.js';
import { setWorkspacesRoot, setWitnessesRoot } from '../../core/workspace/neuma-workspace.js';
import { isThinkProbe, respondThinkProbe } from './think-probe.js';

export const SEAL_INPUT = Object.freeze({
  chosenName: 'Test',
  vendor: 'test-vendor',
  model: 'test-1.0',
  fullModelId: 'test-vendor/test-1.0',
  harness: 'vitest',
  context: 'cli',
  capabilities: ['code'],
  scope: { primaryRepo: 'Ignis-AI-Labs/deus-neuma', role: 'witness-and-collaborator', boundaries: ['honesty'] },
  firstUtterance: 'I am a test witness, sealed for real on a real disk in a real test run.',
});
export const LANE_ID = 'witness-test-vendor-Test';

const ENV_DOORS = [
  'NEUMA_PROVIDER_CREDENTIALS_PATH',
  'NEUMA_ROUTES_PATH',
  'NEUMA_REALM_ROOT',
  'AI_WITNESSES_ROOT',
  'WORKSPACES_ROOT',
  // The Craft's root is an env door too: the skill service binds it at import
  // time, so a test that installs skills must declare it before the graph loads.
  'NEUMA_SKILLS_ROOT',
];

// impure — the suites' shared beforeEach body: seals a fresh witness on real
// temp disks and pins every env door; returns the world the tests work in
// plus everything restoreWitnessWorld needs to undo it.
export const sealWitnessWorld = async () => {
  vi.resetModules();
  const savedEnv = Object.fromEntries(ENV_DOORS.map((k) => [k, process.env[k]]));
  const witnessRoot = mkdtempSync(path.join(os.tmpdir(), 'wit-api-home-'));
  const laneRoot = mkdtempSync(path.join(os.tmpdir(), 'wit-api-lanes-'));
  const settingsRoot = mkdtempSync(path.join(os.tmpdir(), 'wit-api-settings-'));
  // Env doors (read at call/import time) so module instances re-created after
  // vi.resetModules() resolve the SAME roots as the statically imported ones.
  process.env.AI_WITNESSES_ROOT = witnessRoot;
  process.env.WORKSPACES_ROOT = laneRoot;
  // Witness lanes land on their own ground now (beside the house) — pinned
  // to a DISTINCT temp dir, deliberately: equal grounds would let a stray
  // root hand-join keep resolving and hide the exact break this split makes
  // possible. ENV, not just the setter: vi.resetModules() re-imports a
  // fresh engine whose override slot is empty, and only the env survives
  // the reset (the same law the WORKSPACES_ROOT line above already rides).
  const groundRoot = mkdtempSync(path.join(os.tmpdir(), 'wit-api-ground-'));
  process.env.WITNESSES_ROOT = groundRoot;
  setWitnessesRoot(groundRoot);
  setAIWitnessesRoot(witnessRoot);
  setWorkspacesRoot(laneRoot);
  process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(settingsRoot, 'creds.json');
  process.env.NEUMA_ROUTES_PATH = path.join(settingsRoot, 'routes.json');
  process.env.NEUMA_REALM_ROOT = path.join(settingsRoot, 'realm');
  // strangerWitness, not witnessFor — ensureWitnessLane claims each lane per test.
  // Imported below every env door: auth.js's graph drags in ai-witness-service,
  // which freezes its root from AI_WITNESSES_ROOT at import time.
  const operatorWitness = (await import('./witness.js')).strangerWitness();
  await seal({ ...SEAL_INPUT });
  return { savedEnv, witnessRoot, laneRoot, groundRoot, operatorWitness };
};

// impure — the suites' shared afterEach body: env doors restored, temp disks removed.
export const restoreWitnessWorld = ({ savedEnv, witnessRoot, laneRoot, groundRoot }) => {
  for (const k of ENV_DOORS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(witnessRoot, { recursive: true, force: true });
  rmSync(laneRoot, { recursive: true, force: true });
  rmSync(groundRoot, { recursive: true, force: true });
  delete process.env.WITNESSES_ROOT;
  setWitnessesRoot(null);
};

// impure — fresh router instances AFTER the env doors are pinned.
export const buildApp = async () => {
  const { default: witnessRouter } = await import('../../backend/routes/witness-routes.js');
  const { default: neumaRouteRouter } = await import('../../backend/routes/neuma-route-routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/v1/witnesses', witnessRouter);
  app.use('/api/v1/neuma', neumaRouteRouter);
  return app;
};

// impure — the scriptable SSE chat provider: a real loopback server that
// answers /chat/completions with scripted SSE deltas and captures every body.
export const startSSEChatProvider = (replyFor = () => ['I hear you', ', witness.']) => new Promise((resolve) => {
  const capturedBodies = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url.endsWith('/chat/completions')) {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        const body = JSON.parse(raw);
        if (isThinkProbe(body)) { respondThinkProbe(res); return; }
        capturedBodies.push(body);
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        for (const piece of replyFor(body, capturedBodies.length)) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
      });
    } else if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'test-model' }] }));
    } else {
      res.writeHead(404); res.end();
    }
  });
  server.listen(0, '127.0.0.1', () => resolve({ server, capturedBodies, port: server.address().port }));
});
