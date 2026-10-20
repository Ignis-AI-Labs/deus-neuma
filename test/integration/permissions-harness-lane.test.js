// A harness lane's standing grants are on the operator's permissions panel
// and can be taken back: real signed wallets, the real permissions routes,
// real lanes opened by the real harness service on a temp data root. No mock.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import express from 'express';
import { afterAll, beforeAll, expect, test } from 'vitest';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { setHarnessRoot } from '../../core/workspace/lane-grounds.js';
import { resetWorkspaceCryptoKey } from '../../core/workspace/workspace-crypto.js';
import permissionsRoutes from '../../backend/routes/permissions-routes.js';
import { ensureHarnessLane } from '../../backend/services/harness-lane.js';
import { fullAuth } from '../helpers/audit-auth.js';

const ENV_DOORS = ['NEUMA_DATA_ROOT', 'NEUMA_ROUTES_PATH', 'DNA_ENCRYPTION_KEY'];
const CHOICE = Object.freeze({ providerId: 'lm-studio', model: 'fixture-model' });
const GRANT = Object.freeze({ kind: 'act', server: 'web', tool: 'web_search' });

let root; let savedEnv; let savedHouse; let server; let url;
let mine; let theirs; let myLane; let theirLane;

const call = (method, route, bearer, body) => fetch(`${url}${route}`, {
  method, headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
});

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-permissions-harness-'));
  savedEnv = Object.fromEntries(ENV_DOORS.map((k) => [k, process.env[k]]));
  savedHouse = getWorkspacesRoot();
  process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
  process.env.NEUMA_ROUTES_PATH = path.join(root, 'routes.json');
  process.env.DNA_ENCRYPTION_KEY = randomBytes(32).toString('hex');
  resetWorkspaceCryptoKey();
  setWorkspacesRoot(path.join(root, 'lanes'));
  setHarnessRoot(path.join(root, 'harness'));
  mine = await fullAuth();
  theirs = await fullAuth();
  myLane = (await ensureHarnessLane(mine.address, CHOICE)).laneId;
  theirLane = (await ensureHarnessLane(theirs.address, CHOICE)).laneId;
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
  setHarnessRoot(null);
  setWorkspacesRoot(savedHouse);
  for (const [k, v] of Object.entries(savedEnv || {})) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  resetWorkspaceCryptoKey();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

test('the listing shows my harness lane, named as the harness, and never another wallet\'s', async () => {
  const response = await call('GET', '/', mine.token);
  expect(response.status).toBe(200);
  const house = await response.json();
  expect(house.beings.map((b) => b.neumaId)).toEqual([myLane]);
  const [lane] = house.beings;
  expect(lane).toMatchObject({ kind: 'harness', name: 'HARNESS', total: 1 });
  expect(lane.grants.act).toEqual([expect.objectContaining({ server: 'web', tool: 'web_search' })]);
  expect((await call('GET', `/${myLane}`, mine.token)).status).toBe(200);
  expect((await call('GET', `/${theirLane}`, mine.token)).status).toBe(404);
});

test('the revoke route takes the harness lane\'s grant back; another wallet cannot', async () => {
  expect((await call('POST', `/${theirLane}/revoke`, mine.token, GRANT)).status).toBe(404);
  expect((await workspace.readToolPolicy(theirLane)).web.allowed).toEqual(['web_search']);
  const response = await call('POST', `/${myLane}/revoke`, mine.token, GRANT);
  expect(response.status).toBe(200);
  const out = await response.json();
  expect(out.held).toBe(true);
  expect(out.record).toMatchObject({ neumaId: myLane, kind: 'harness', total: 0 });
  expect((await workspace.readToolPolicy(myLane)).web.allowed).toEqual([]);
  expect((await workspace.readToolPolicy(theirLane)).web.allowed).toEqual(['web_search']);
});
