// A sealed witness's lane, on its own ground beside the house, is on its
// operator's permissions panel and its grants can be taken back — and another
// wallet's witness lane is never listed or touched. Real signed wallets, the
// real permissions routes, real lanes opened by the real witness-lane service
// on a temp ground. No mock.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import express from 'express';
import { afterAll, beforeAll, expect, test } from 'vitest';
import workspace, {
  getWorkspacesRoot, setWorkspacesRoot, setWitnessesRoot,
} from '../../core/workspace/neuma-workspace.js';
import { getAIWitnessesRoot, setAIWitnessesRoot } from '../../core/identity/ai-witness/ai-witness-service.js';
import { resetWorkspaceCryptoKey } from '../../core/workspace/workspace-crypto.js';
import permissionsRoutes from '../../backend/routes/permissions-routes.js';
import { ensureWitnessLane } from '../../backend/services/witness-lane.js';
import { fullAuth } from '../helpers/audit-auth.js';

const ENV_DOORS = ['NEUMA_DATA_ROOT', 'DNA_ENCRYPTION_KEY'];
const GRANT = Object.freeze({ kind: 'act', server: 'web', tool: 'web_search' });

let root; let savedEnv; let savedHouse; let savedAiWitnesses; let server; let url;
let mine; let theirs; let myLane; let theirLane;

const call = (method, route, bearer, body) => fetch(`${url}${route}`, {
  method, headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
});

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-permissions-witness-'));
  savedEnv = Object.fromEntries(ENV_DOORS.map((k) => [k, process.env[k]]));
  savedHouse = getWorkspacesRoot();
  savedAiWitnesses = getAIWitnessesRoot();
  process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
  process.env.DNA_ENCRYPTION_KEY = randomBytes(32).toString('hex');
  resetWorkspaceCryptoKey();
  setWorkspacesRoot(path.join(root, 'lanes'));
  setWitnessesRoot(path.join(root, 'witnesses'));
  setAIWitnessesRoot(path.join(root, 'ai-witnesses'));
  mine = await fullAuth();
  theirs = await fullAuth();
  myLane = (await ensureWitnessLane({ vendorSlug: 'fixture-vendor', chosenName: 'Mine' }, mine.address, { summoning: true })).laneId;
  theirLane = (await ensureWitnessLane({ vendorSlug: 'fixture-vendor', chosenName: 'Theirs' }, theirs.address, { summoning: true })).laneId;
  await workspace.writeToolPolicy(myLane, { web: { allowed: ['web_search'] } });
  await workspace.writeToolPolicy(theirLane, { web: { allowed: ['web_search'] } });
  const app = express();
  app.use(express.json());
  app.use('/permissions', permissionsRoutes);
  server = await new Promise((resolve) => { const live = app.listen(0, '127.0.0.1', () => resolve(live)); });
  url = `http://127.0.0.1:${server.address().port}/permissions`;
});

afterAll(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  setAIWitnessesRoot(savedAiWitnesses);
  setWitnessesRoot(null);
  setWorkspacesRoot(savedHouse);
  for (const [k, v] of Object.entries(savedEnv || {})) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  resetWorkspaceCryptoKey();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

test('each wallet sees its own witness lane, as a witness, and never the other\'s', async () => {
  expect(path.dirname(workspace.pathFor(myLane))).toBe(path.join(root, 'witnesses'));
  for (const [who, lane, other] of [[mine, myLane, theirLane], [theirs, theirLane, myLane]]) {
    const response = await call('GET', '/', who.token);
    expect(response.status).toBe(200);
    const house = await response.json();
    expect(house.beings.map((b) => b.neumaId)).toEqual([lane]);
    expect(house.beings[0]).toMatchObject({ kind: 'witness', total: 1 });
    expect((await call('GET', `/${lane}`, who.token)).status).toBe(200);
    expect((await call('GET', `/${other}`, who.token)).status).toBe(404);
  }
});

test('the revoke route takes my witness lane\'s grant back; another wallet\'s stays whole', async () => {
  expect((await call('POST', `/${theirLane}/revoke`, mine.token, GRANT)).status).toBe(404);
  const response = await call('POST', `/${myLane}/revoke`, mine.token, GRANT);
  expect(response.status).toBe(200);
  const out = await response.json();
  expect(out).toMatchObject({ held: true, record: { neumaId: myLane, kind: 'witness', total: 0 } });
  expect((await workspace.readToolPolicy(myLane)).web.allowed).toEqual([]);
  expect((await workspace.readToolPolicy(theirLane)).web.allowed).toEqual(['web_search']);
});
